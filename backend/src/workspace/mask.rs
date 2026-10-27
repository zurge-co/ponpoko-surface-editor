use std::collections::HashSet;

use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaskState {
    Normal,
    LineComment,
    BlockComment,
    String(char),
    RawString(usize),
}

pub(crate) fn mask_noncode(text: &str, language: Language) -> String {
    let hash_comments = matches!(
        language,
        Language::Python | Language::Shell | Language::Yaml | Language::Toml
    );
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut state = MaskState::Normal;
    let mut index = 0usize;

    while index < chars.len() {
        let current = chars[index];
        match state {
            MaskState::Normal => {
                let next = chars.get(index + 1).copied();
                if current == '/' && next == Some('/') {
                    out.push(' ');
                    out.push(' ');
                    index += 2;
                    state = MaskState::LineComment;
                    continue;
                }
                if current == '/' && next == Some('*') {
                    out.push(' ');
                    out.push(' ');
                    index += 2;
                    state = MaskState::BlockComment;
                    continue;
                }
                if hash_comments && current == '#' {
                    out.push(' ');
                    index += 1;
                    state = MaskState::LineComment;
                    continue;
                }
                if current == '"' || current == '`' {
                    out.push(' ');
                    index += 1;
                    state = MaskState::String(current);
                    continue;
                }
                if current == '\'' {
                    if language == Language::Rust {
                        if let Some(end) = char_literal_end(&chars, index) {
                            for _ in index..=end {
                                out.push(' ');
                            }
                            index = end + 1;
                            continue;
                        }
                        out.push(current);
                        index += 1;
                        continue;
                    }
                    out.push(' ');
                    index += 1;
                    state = MaskState::String('\'');
                    continue;
                }
                if language == Language::Rust && current == 'r' {
                    if let Some((end, hashes)) = raw_string_start(&chars, index) {
                        for _ in index..=end {
                            out.push(' ');
                        }
                        index = end + 1;
                        state = MaskState::RawString(hashes);
                        continue;
                    }
                }
                out.push(current);
                index += 1;
            }
            MaskState::LineComment => {
                out.push(if current == '\n' { '\n' } else { ' ' });
                if current == '\n' {
                    state = MaskState::Normal;
                }
                index += 1;
            }
            MaskState::BlockComment => {
                if current == '*' && chars.get(index + 1) == Some(&'/') {
                    out.push(' ');
                    out.push(' ');
                    index += 2;
                    state = MaskState::Normal;
                } else {
                    out.push(if current == '\n' { '\n' } else { ' ' });
                    index += 1;
                }
            }
            MaskState::String(quote) => {
                if current == '\\' {
                    out.push(' ');
                    if let Some(next) = chars.get(index + 1) {
                        out.push(if *next == '\n' { '\n' } else { ' ' });
                    }
                    index += 2;
                    continue;
                }
                if current == quote {
                    out.push(' ');
                    index += 1;
                    state = MaskState::Normal;
                    continue;
                }
                out.push(if current == '\n' { '\n' } else { ' ' });
                index += 1;
            }
            MaskState::RawString(hashes) => {
                if current == '"' {
                    let mut end = index + 1;
                    let mut found = 0usize;
                    while found < hashes && chars.get(end) == Some(&'#') {
                        found += 1;
                        end += 1;
                    }
                    if found == hashes {
                        for _ in index..end {
                            out.push(' ');
                        }
                        index = end;
                        state = MaskState::Normal;
                        continue;
                    }
                }
                out.push(if current == '\n' { '\n' } else { ' ' });
                index += 1;
            }
        }
    }
    out
}

pub fn char_literal_end(chars: &[char], start: usize) -> Option<usize> {
    let mut index = start + 1;
    if chars.get(index) == Some(&'\\') {
        index += 2;
    } else {
        index += 1;
    }
    if chars.get(index) == Some(&'\'') {
        Some(index)
    } else {
        None
    }
}

pub fn raw_string_start(chars: &[char], start: usize) -> Option<(usize, usize)> {
    let mut index = start + 1;
    let mut hashes = 0usize;
    while chars.get(index) == Some(&'#') {
        hashes += 1;
        index += 1;
    }
    if chars.get(index) == Some(&'"') {
        Some((index, hashes))
    } else {
        None
    }
}

pub fn brace_delta(line: &str) -> i32 {
    let mut delta = 0i32;
    for c in line.chars() {
        if c == '{' {
            delta += 1;
        } else if c == '}' {
            delta -= 1;
        }
    }
    delta
}

pub fn column_of(line: &str, name: &str) -> usize {
    line.find(name)
        .map(|byte| line[..byte].encode_utf16().count())
        .unwrap_or(0)
}

pub fn push_symbol(
    out: &mut Vec<Symbol>,
    seen: &mut HashSet<(String, usize, String)>,
    name: &str,
    kind: &str,
    line: usize,
    column: usize,
    container: Option<&str>,
    exported: bool,
) {
    if name.is_empty() {
        return;
    }
    let key = (name.to_string(), line, kind.to_string());
    if !seen.insert(key) {
        return;
    }
    out.push(Symbol {
        name: name.to_string(),
        kind: kind.to_string(),
        line,
        column,
        container: container.map(str::to_string),
        exported,
    });
}
