use std::sync::OnceLock;
use regex::Regex;
use crate::workspace::{mask_noncode, Language};

use super::*;

pub fn ts_import_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?s)^\s*import\s+(?:(?P<clause>.*?)\s+from\s+)?["'](?P<spec>[^"']+)["']"#)
            .expect("the import pattern is valid")
    })
}

pub fn ts_export_from_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?s)^\s*export\s+(?:type\s+)?(?P<clause>\{[^}]*\}|\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'](?P<spec>[^"']+)["']"#,
        )
        .expect("the export-from pattern is valid")
    })
}

pub fn ts_require_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?:const|let|var)\s+(?P<target>[A-Za-z_$][A-Za-z0-9_$]*|\{[^}]*\})\s*=\s*require\(\s*["'](?P<spec>[^"']+)["']"#,
        )
        .expect("the require pattern is valid")
    })
}

pub fn starts_keyword(line: &str, keyword: &str) -> bool {
    match line.strip_prefix(keyword) {
        Some(rest) => {
            rest.is_empty() || rest.starts_with(|c: char| c.is_whitespace() || c == '{' || c == '*')
        }
        None => false,
    }
}

pub fn scan_ts_imports(text: &str) -> Vec<ImportBinding> {
    let original: Vec<&str> = text.split('\n').collect();
    let masked = mask_noncode(text, Language::TypeScript);
    let masked_lines: Vec<&str> = masked.split('\n').collect();
    let mut imports = Vec::new();
    let mut line = 0usize;
    while line < masked_lines.len() {
        let trimmed = masked_lines[line].trim_start();
        if starts_keyword(trimmed, "import") {
            let mut end = line;
            let mut statement = String::new();
            let mut complete = false;
            while end < masked_lines.len() && end - line < 40 {
                statement.push_str(original.get(end).copied().unwrap_or(""));
                statement.push('\n');
                let masked_statement = masked_lines[end].trim();
                if masked_statement.contains(" from ") || masked_statement.ends_with(';') {
                    complete = true;
                    break;
                }
                end += 1;
            }
            if complete {
                if let Some(captures) = ts_import_regex().captures(&statement) {
                    let specifier = captures
                        .name("spec")
                        .map(|found| found.as_str().to_string())
                        .unwrap_or_default();
                    if let Some(clause) = captures.name("clause") {
                        for (local, imported, kind) in parse_import_clause(clause.as_str()) {
                            imports.push(ImportBinding {
                                local,
                                imported,
                                kind,
                                specifier: specifier.clone(),
                            });
                        }
                    }
                }
                line = end + 1;
                continue;
            }
        }
        line += 1;
    }

    for raw in original.iter() {
        if let Some(captures) = ts_export_from_regex().captures(raw) {
            let specifier = captures
                .name("spec")
                .map(|found| found.as_str().to_string())
                .unwrap_or_default();
            if let Some(clause) = captures.name("clause") {
                for (local, imported, kind) in parse_import_clause(clause.as_str()) {
                    imports.push(ImportBinding {
                        local,
                        imported,
                        kind,
                        specifier: specifier.clone(),
                    });
                }
            }
        }
        if let Some(captures) = ts_require_regex().captures(raw) {
            let specifier = captures
                .name("spec")
                .map(|found| found.as_str().to_string())
                .unwrap_or_default();
            if let Some(target) = captures.name("target") {
                for (local, imported, kind) in parse_require_target(target.as_str()) {
                    imports.push(ImportBinding {
                        local,
                        imported,
                        kind,
                        specifier: specifier.clone(),
                    });
                }
            }
        }
    }

    imports
}

pub fn split_top_level(input: &str, separator: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut current = String::new();
    for c in input.chars() {
        match c {
            '{' | '(' | '[' => {
                depth += 1;
                current.push(c);
            }
            '}' | ')' | ']' => {
                depth -= 1;
                current.push(c);
            }
            _ if c == separator && depth == 0 => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(c),
        }
    }
    parts.push(current);
    parts
}

pub fn parse_import_clause(clause: &str) -> Vec<(String, String, ImportKind)> {
    let mut clause = clause.trim();
    if let Some(rest) = clause.strip_prefix("type ") {
        clause = rest.trim();
    }
    if let Some(rest) = clause.strip_prefix("type") {
        if rest.starts_with('{') {
            clause = rest.trim();
        }
    }
    let mut bindings = Vec::new();
    for part in split_top_level(clause, ',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some(rest) = part.strip_prefix('*') {
            let local = rest.trim().strip_prefix("as").unwrap_or(rest).trim();
            if !local.is_empty() {
                bindings.push((local.to_string(), String::new(), ImportKind::Namespace));
            }
            continue;
        }
        if part.starts_with('{') {
            let inner = part.trim_start_matches('{').trim_end_matches('}');
            for item in split_top_level(inner, ',') {
                let item = item.trim().trim_start_matches("type ").trim();
                if item.is_empty() {
                    continue;
                }
                let (imported, local) = match item.split_once(" as ") {
                    Some((imported, local)) => (
                        imported.trim().to_string(),
                        local.trim().trim_start_matches("type ").trim().to_string(),
                    ),
                    None => (item.to_string(), item.to_string()),
                };
                if imported == "default" {
                    bindings.push((local, String::new(), ImportKind::Default));
                } else {
                    bindings.push((local, imported, ImportKind::Named));
                }
            }
            continue;
        }
        let local = part.split_whitespace().next().unwrap_or("");
        if !local.is_empty() {
            bindings.push((local.to_string(), String::new(), ImportKind::Default));
        }
    }
    bindings
}

pub fn parse_require_target(target: &str) -> Vec<(String, String, ImportKind)> {
    let target = target.trim();
    if let Some(inner) = target.strip_prefix('{') {
        let mut bindings = Vec::new();
        for item in split_top_level(inner.trim_end_matches('}'), ',') {
            let item = item.trim();
            if item.is_empty() {
                continue;
            }
            let (imported, local) = match item.split_once(':') {
                Some((imported, local)) => (imported.trim().to_string(), local.trim().to_string()),
                None => (item.to_string(), item.to_string()),
            };
            bindings.push((local, imported, ImportKind::Named));
        }
        return bindings;
    }
    vec![(target.to_string(), String::new(), ImportKind::Namespace)]
}
