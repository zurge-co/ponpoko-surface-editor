use std::collections::HashSet;
use std::sync::OnceLock;
use regex::Regex;

use super::*;

pub fn ts_symbol_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s*(?:(?:export|declare)\s+)*(?:(?:default)\s+)*(?:(?:async|abstract)\s+)*(?P<kind>function|class|interface|type|enum|const|let|var|namespace|module)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)",
        )
        .expect("the TypeScript symbol pattern is valid")
    })
}

pub fn ts_method_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s+(?:(?:public|private|protected|static|async|readonly|override|get|set|abstract)\s+)*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(",
        )
        .expect("the TypeScript method pattern is valid")
    })
}

pub fn rust_symbol_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s*(?P<vis>pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const)\s+)*(?P<kind>fn|struct|enum|trait|type|union|mod|const|static)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)",
        )
        .expect("the Rust symbol pattern is valid")
    })
}

pub fn rust_macro_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^\s*macro_rules!\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)")
            .expect("the Rust macro pattern is valid")
    })
}

pub fn rust_impl_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s*(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:[A-Za-z_][A-Za-z0-9_:<>,\s]*?\s+for\s+)?(?P<ty>[A-Za-z_][A-Za-z0-9_:<>]*)",
        )
        .expect("the Rust impl pattern is valid")
    })
}

pub fn python_symbol_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s*(?:(?:async)\s+)?(?P<kind>def|class)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)",
        )
        .expect("the Python symbol pattern is valid")
    })
}

pub fn go_symbol_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s*(?P<kind>func|type|var|const)\s+(?:\([^)]*\)\s*)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)",
        )
        .expect("the Go symbol pattern is valid")
    })
}

pub fn c_symbol_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|virtual|inline|constexpr|extern|typedef|struct|class|enum|interface|union|namespace)\s+)*(?P<kind>struct|class|enum|interface|union|namespace)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)",
        )
        .expect("the C-family symbol pattern is valid")
    })
}

pub fn markdown_heading_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^(?P<hashes>#{1,6})\s+(?P<name>\S.*)$")
            .expect("the Markdown heading pattern is valid")
    })
}

pub fn key_value_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"^\s*(?P<name>"[^"]+"|[A-Za-z_$][A-Za-z0-9_$.-]*)\s*[:=]"#,
        )
        .expect("the key/value pattern is valid")
    })
}

pub fn toml_table_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^\s*\[(?P<name>[^\]]+)\]\s*$").expect("the TOML table pattern is valid")
    })
}

pub(crate) fn parse_symbols(language: Language, text: &str) -> Vec<Symbol> {
    let masked = mask_noncode(text, language);
    let original: Vec<&str> = text.lines().collect();
    let masked_lines: Vec<&str> = masked.lines().collect();
    let mut symbols = Vec::new();
    let mut seen: HashSet<(String, usize, String)> = HashSet::new();
    let mut depth = 0i32;

    let mut class_stack: Vec<(String, i32)> = Vec::new();
    let mut impl_stack: Vec<(String, i32)> = Vec::new();

    for (index, masked_line) in masked_lines.iter().enumerate() {
        let line_number = index + 1;
        let line = original.get(index).copied().unwrap_or("");
        let line_depth = depth;
        depth += brace_delta(masked_line);

        class_stack.retain(|(_, body_depth)| depth >= *body_depth);
        impl_stack.retain(|(_, body_depth)| depth >= *body_depth);

        match language {
            Language::TypeScript | Language::JavaScript => {
                if let Some(captures) = ts_symbol_regex().captures(masked_line) {
                    let kind = captures.name("kind").map(|m| m.as_str()).unwrap_or("symbol");
                    if let Some(name) = captures.name("name").map(|m| m.as_str()) {
                        let exported = masked_line
                            .split_whitespace()
                            .take(3)
                            .any(|word| word == "export" || word == "declare");
                        let container = class_stack.last().map(|(name, _)| name.as_str());
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            kind,
                            line_number,
                            column_of(line, name),
                            container,
                            exported,
                        );
                        if kind == "class" || kind == "interface" || kind == "namespace" {
                            let body_depth = depth.max(line_depth + 1);
                            class_stack.push((name.to_string(), body_depth));
                        }
                    }
                } else if let Some((container, _)) = class_stack.last() {
                    if let Some(captures) = ts_method_regex().captures(masked_line) {
                        if let Some(name) = captures.name("name").map(|m| m.as_str()) {
                            const NOT_METHODS: [&str; 14] = [
                                "if", "for", "while", "switch", "catch", "return", "throw", "new",
                                "typeof", "await", "yield", "else", "do", "with",
                            ];
                            if !NOT_METHODS.contains(&name) {
                                push_symbol(
                                    &mut symbols,
                                    &mut seen,
                                    name,
                                    "method",
                                    line_number,
                                    column_of(line, name),
                                    Some(container),
                                    false,
                                );
                            }
                        }
                    }
                }
            }
            Language::Rust => {
                if let Some(captures) = rust_impl_regex().captures(masked_line) {
                    if let Some(ty) = captures.name("ty").map(|m| m.as_str()) {
                        let ty = ty.split('<').next().unwrap_or(ty);
                        let body_depth = depth.max(line_depth + 1);
                        impl_stack.push((ty.to_string(), body_depth));
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            ty,
                            "impl",
                            line_number,
                            column_of(line, ty),
                            None,
                            false,
                        );
                    }
                }
                if let Some(captures) = rust_symbol_regex().captures(masked_line) {
                    if let Some(name) = captures.name("name").map(|m| m.as_str()) {
                        let kind = captures.name("kind").map(|m| m.as_str()).unwrap_or("symbol");
                        let exported = captures.name("vis").is_some();
                        let container = impl_stack.last().map(|(name, _)| name.as_str());
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            kind,
                            line_number,
                            column_of(line, name),
                            container,
                            exported,
                        );
                    }
                } else if let Some(captures) = rust_macro_regex().captures(masked_line) {
                    if let Some(name) = captures.name("name").map(|m| m.as_str()) {
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            "macro",
                            line_number,
                            column_of(line, name),
                            None,
                            masked_line.trim_start().starts_with("pub"),
                        );
                    }
                }
            }
            Language::Python => {
                if let Some(captures) = python_symbol_regex().captures(masked_line) {
                    if let (Some(kind), Some(name)) = (
                        captures.name("kind").map(|m| m.as_str()),
                        captures.name("name").map(|m| m.as_str()),
                    ) {
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            kind,
                            line_number,
                            column_of(line, name),
                            None,
                            !masked_line.starts_with(' ') && !masked_line.starts_with('\t'),
                        );
                    }
                }
            }
            Language::Go => {
                if let Some(captures) = go_symbol_regex().captures(masked_line) {
                    if let (Some(kind), Some(name)) = (
                        captures.name("kind").map(|m| m.as_str()),
                        captures.name("name").map(|m| m.as_str()),
                    ) {
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            kind,
                            line_number,
                            column_of(line, name),
                            None,
                            name.chars().next().is_some_and(char::is_uppercase),
                        );
                    }
                }
            }
            Language::Java | Language::C | Language::Cpp => {
                if let Some(captures) = c_symbol_regex().captures(masked_line) {
                    if let (Some(kind), Some(name)) = (
                        captures.name("kind").map(|m| m.as_str()),
                        captures.name("name").map(|m| m.as_str()),
                    ) {
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            kind,
                            line_number,
                            column_of(line, name),
                            None,
                            masked_line.contains("public"),
                        );
                    }
                }
            }
            Language::Markdown => {
                if let Some(captures) = markdown_heading_regex().captures(line) {
                    if let Some(name) = captures.name("name").map(|m| m.as_str().trim()) {
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            "heading",
                            line_number,
                            column_of(line, name),
                            None,
                            true,
                        );
                    }
                }
            }
            Language::Json | Language::Yaml => {
                if let Some(captures) = key_value_regex().captures(line) {
                    if let Some(name) = captures.name("name").map(|m| m.as_str()) {
                        let name = name.trim_matches('"');
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            "key",
                            line_number,
                            column_of(line, name),
                            None,
                            true,
                        );
                    }
                }
            }
            Language::Toml => {
                if let Some(captures) = toml_table_regex().captures(line) {
                    if let Some(name) = captures.name("name").map(|m| m.as_str().trim()) {
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            "table",
                            line_number,
                            column_of(line, name),
                            None,
                            true,
                        );
                    }
                } else if let Some(captures) = key_value_regex().captures(line) {
                    if let Some(name) = captures.name("name").map(|m| m.as_str()) {
                        let name = name.trim_matches('"');
                        push_symbol(
                            &mut symbols,
                            &mut seen,
                            name,
                            "key",
                            line_number,
                            column_of(line, name),
                            None,
                            true,
                        );
                    }
                }
            }
            Language::Html | Language::Css | Language::Shell | Language::Other => {}
        }
    }

    symbols.sort_by_key(|symbol| (symbol.line, symbol.column));
    symbols
}
