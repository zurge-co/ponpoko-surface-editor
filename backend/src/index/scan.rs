use std::path::{Path, PathBuf};
use serde_json::Value;
use crate::workspace::Language;

use super::*;

pub fn is_indexed_language(language: Language) -> bool {
    matches!(
        language,
        Language::TypeScript | Language::JavaScript | Language::Rust
    )
}

pub fn is_js_like(language: Language) -> bool {
    matches!(language, Language::TypeScript | Language::JavaScript)
}

pub fn is_searchable_language(language: Language) -> bool {
    matches!(
        language,
        Language::TypeScript
            | Language::JavaScript
            | Language::Rust
            | Language::Python
            | Language::Go
            | Language::Java
            | Language::C
            | Language::Cpp
            | Language::Shell
    )
}

pub fn root_for(params: &Value, path: &Path) -> PathBuf {
    params
        .get("root")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .map(PathBuf::from)
        .filter(|root| root.is_dir())
        .or_else(|| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn path_key(path: &Path) -> String {
    let text = normalized(path).to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        text.to_ascii_lowercase()
    } else {
        text
    }
}

pub fn relative_path(root: &Path, path: &Path) -> String {
    let path = normalized(path);
    let root = normalized(root);
    path.strip_prefix(&root)
        .unwrap_or(&path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn read_code(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_INDEX_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub fn read_line(path: &Path, line: usize) -> Option<String> {
    let text = read_code(path)?;
    text.split('\n')
        .nth(line.checked_sub(1)?)
        .map(str::to_string)
}

pub fn truncate(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX_EXCERPT {
        return trimmed.to_string();
    }
    let mut short: String = trimmed.chars().take(MAX_EXCERPT).collect();
    short.push('…');
    short
}

pub fn excerpt_of(path: &Path, line: usize, current_text: Option<&str>) -> String {
    let text = match current_text {
        Some(text) => text.to_string(),
        None => read_code(path).unwrap_or_default(),
    };
    text.split('\n')
        .nth(line.saturating_sub(1))
        .map(truncate)
        .unwrap_or_default()
}


pub fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

pub fn utf16_to_char(chars: &[char], offset: usize) -> usize {
    let mut seen = 0usize;
    for (index, c) in chars.iter().enumerate() {
        if seen >= offset {
            return index;
        }
        seen += c.len_utf16();
    }
    chars.len()
}

pub fn char_to_utf16(chars: &[char], index: usize) -> usize {
    chars
        .iter()
        .take(index.min(chars.len()))
        .map(|c| c.len_utf16())
        .sum()
}

pub struct FoundWord {
    pub word: String,
    pub start_column: usize,
}

pub fn word_at(text: &str, line: usize, column: usize) -> Option<FoundWord> {
    let line_text = text.split('\n').nth(line.checked_sub(1)?)?;
    let chars: Vec<char> = line_text.chars().collect();
    if chars.is_empty() {
        return None;
    }
    let mut offset = utf16_to_char(&chars, column.saturating_sub(1));
    if offset >= chars.len() || !is_word_char(chars[offset]) {
        offset = offset.saturating_sub(1);
        if !chars.get(offset).copied().is_some_and(is_word_char) {
            return None;
        }
    }
    let mut start = offset;
    while start > 0 && is_word_char(chars[start - 1]) {
        start -= 1;
    }
    let mut end = offset + 1;
    while end < chars.len() && is_word_char(chars[end]) {
        end += 1;
    }
    let word: String = chars[start..end].iter().collect();
    Some(FoundWord {
        word,
        start_column: char_to_utf16(&chars, start) + 1,
    })
}

pub struct PathContext {
    pub segments: Vec<String>,
    pub index: usize,
}

pub fn path_context(
    text: &str,
    line: usize,
    word_start_column: usize,
    language: Language,
) -> Option<PathContext> {
    let line_text = text.split('\n').nth(line.checked_sub(1)?)?;
    let chars: Vec<char> = line_text.chars().collect();
    let offset = utf16_to_char(&chars, word_start_column.saturating_sub(1));
    if !chars.get(offset).copied().is_some_and(is_word_char) {
        return None;
    }
    let mut segment_start = offset;
    while segment_start > 0 && is_word_char(chars[segment_start - 1]) {
        segment_start -= 1;
    }
    let mut segment_end = offset + 1;
    while segment_end < chars.len() && is_word_char(chars[segment_end]) {
        segment_end += 1;
    }
    let mut segments = vec![chars[segment_start..segment_end].iter().collect::<String>()];
    let mut index = 0usize;

    let mut cursor = segment_start;
    while let Some(previous_end) = separator_before(&chars, cursor, language) {
        let mut previous_start = previous_end;
        while previous_start > 0 && is_word_char(chars[previous_start - 1]) {
            previous_start -= 1;
        }
        if previous_start == previous_end {
            break;
        }
        segments.insert(0, chars[previous_start..previous_end].iter().collect());
        index += 1;
        cursor = previous_start;
    }

    let mut cursor = segment_end;
    while let Some(next_start) = separator_after(&chars, cursor, language) {
        let mut next_end = next_start;
        while next_end < chars.len() && is_word_char(chars[next_end]) {
            next_end += 1;
        }
        if next_end == next_start {
            break;
        }
        segments.push(chars[next_start..next_end].iter().collect());
        cursor = next_end;
    }

    Some(PathContext { segments, index })
}

pub fn separator_before(chars: &[char], cursor: usize, language: Language) -> Option<usize> {
    let mut index = cursor;
    while index > 0 && chars[index - 1].is_whitespace() {
        index -= 1;
    }
    match language {
        Language::TypeScript | Language::JavaScript => {
            if index > 0 && chars[index - 1] == '.' {
                let mut end = index - 1;
                while end > 0 && chars[end - 1].is_whitespace() {
                    end -= 1;
                }
                Some(end)
            } else {
                None
            }
        }
        Language::Rust => {
            if index >= 2 && chars[index - 1] == ':' && chars[index - 2] == ':' {
                let mut end = index - 2;
                while end > 0 && chars[end - 1].is_whitespace() {
                    end -= 1;
                }
                Some(end)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn separator_after(chars: &[char], cursor: usize, language: Language) -> Option<usize> {
    let mut index = cursor;
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    match language {
        Language::TypeScript | Language::JavaScript => {
            if chars.get(index) == Some(&'.') {
                let mut start = index + 1;
                while start < chars.len() && chars[start].is_whitespace() {
                    start += 1;
                }
                Some(start)
            } else {
                None
            }
        }
        Language::Rust => {
            if chars.get(index) == Some(&':') && chars.get(index + 1) == Some(&':') {
                let mut start = index + 2;
                while start < chars.len() && chars[start].is_whitespace() {
                    start += 1;
                }
                Some(start)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn specifier_at(text: &str, line: usize, column: usize) -> Option<String> {
    let line_text = text.split('\n').nth(line.checked_sub(1)?)?;
    let trimmed = line_text.trim_start();
    let looks_like_import = trimmed.starts_with("import")
        || trimmed.starts_with("export")
        || trimmed.contains("require(")
        || trimmed.contains(" from ");
    if !looks_like_import {
        return None;
    }
    let chars: Vec<char> = line_text.chars().collect();
    let position = utf16_to_char(&chars, column.saturating_sub(1));
    let mut start = position.min(chars.len().saturating_sub(1));
    while start > 0 && !matches!(chars[start], '"' | '\'' | '`') {
        start -= 1;
    }
    let quote = *chars.get(start)?;
    if !matches!(quote, '"' | '\'' | '`') {
        return None;
    }
    let mut end = start + 1;
    while end < chars.len() && chars[end] != quote {
        end += 1;
    }
    if end >= chars.len() || position <= start || position >= end {
        return None;
    }
    Some(chars[start + 1..end].iter().collect())
}

pub fn declaration_at(file: &IndexedFile, line: usize, column: usize) -> Option<&Declaration> {
    file.declarations.iter().find(|declaration| {
        let length = declaration
            .name
            .chars()
            .map(|c| c.len_utf16())
            .sum::<usize>();
        declaration.line == line
            && column >= declaration.column
            && column <= declaration.column + length
    })
}
