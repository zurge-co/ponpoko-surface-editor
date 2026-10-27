use std::path::Path;
use crate::workspace::Language;

use super::*;

pub fn local_receiver_type(
    current: &IndexedFile,
    current_text: &str,
    receiver: &str,
) -> Option<String> {
    let declaration = current.declarations.iter().find(|declaration| {
        declaration.name == receiver && matches!(declaration.kind.as_str(), "const" | "let" | "var")
    })?;
    let line = current_text
        .split('\n')
        .nth(declaration.line.checked_sub(1)?)?;
    let marker = line.find(receiver)? + receiver.len();
    let mut rest = line[marker..].trim_start();
    if let Some(after_type) = rest.strip_prefix(':') {
        rest = after_type.trim_start();
        let name: String = rest
            .chars()
            .take_while(|c| is_word_char(*c) || *c == '.')
            .collect();
        let last = name.split('.').next_back().unwrap_or("");
        if !last.is_empty() {
            return Some(last.to_string());
        }
    }
    let rest = rest.strip_prefix('=').unwrap_or(rest).trim_start();
    let rest = rest.strip_prefix("new ").unwrap_or(rest).trim_start();
    let name: String = rest
        .chars()
        .take_while(|c| is_word_char(*c) || *c == '.')
        .collect();
    let last = name.split('.').next_back().unwrap_or("");
    (!last.is_empty() && last.chars().next().is_some_and(|c| c.is_uppercase()))
        .then(|| last.to_string())
}

pub fn resolve_rust(
    index: &Index,
    current: &IndexedFile,
    current_text: &str,
    root: &Path,
    word: &str,
    context: Option<&PathContext>,
    cursor_line: usize,
) -> (Vec<Located>, Vec<String>) {
    let mut notes = Vec::new();
    let mut found = Vec::new();

    if let Some((_, line)) = current.rust_mods.iter().find(|(name, _)| name == word) {
        let info = rust_module_info(&current.path, root);
        if let Some((module_file, _)) = rust_module_file(&info.children_dir, word) {
            found.push(module_start(
                &module_file,
                root,
                format!("mod {word} (line {line})"),
            ));
        }
    }

    if found.is_empty() {
        if let Some(declaration) = current
            .declarations
            .iter()
            .find(|declaration| declaration.line == cursor_line && declaration.name == word)
        {
            return (
                vec![located_from_declaration(
                    current,
                    declaration,
                    "this file".to_string(),
                    Some(current_text),
                )],
                notes,
            );
        }
    }

    if found.is_empty() {
        if let Some(context) = context {
            let in_use = in_use_statement(current_text, cursor_line);
            if context.index + 1 == context.segments.len() {
                found = resolve_rust_path_item(
                    index,
                    current,
                    root,
                    &context.segments,
                    in_use,
                    current_text,
                    &mut notes,
                );
            } else {
                let prefix: Vec<String> = context
                    .segments
                    .iter()
                    .take(context.index + 1)
                    .cloned()
                    .collect();
                if let Some(resolution) = resolve_rust_path(&current.path, root, &prefix, in_use) {
                    if resolution.item_index.is_none() {
                        if let Some(module_file) = &resolution.module_file {
                            found.push(module_start(
                                module_file,
                                root,
                                format!("module {}", prefix.join("::")),
                            ));
                        }
                    }
                }
            }
        }
    }

    if found.is_empty() {
        if let Some(use_path) = current
            .rust_uses
            .iter()
            .find(|use_path| use_path.local == word)
        {
            let resolved = resolve_rust_path_item(
                index,
                current,
                root,
                &use_path.segments,
                true,
                current_text,
                &mut notes,
            );
            if !resolved.is_empty() {
                notes.clear();
            }
            return (resolved, notes);
        }
    }

    if found.is_empty() {
        found = current
            .declarations
            .iter()
            .filter(|declaration| declaration.name == word)
            .map(|declaration| {
                located_from_declaration(
                    current,
                    declaration,
                    "this file".to_string(),
                    Some(current_text),
                )
            })
            .collect();
    }

    if found.is_empty() {
        for file in &index.files {
            if file.language != Language::Rust || path_key(&file.path) == path_key(&current.path) {
                continue;
            }
            for declaration in &file.declarations {
                if declaration.name != word || !declaration.exported || declaration.kind == "method"
                {
                    continue;
                }
                found.push(located_from_declaration(
                    file,
                    declaration,
                    format!("declared in {}", file.relative),
                    None,
                ));
                if found.len() >= MAX_DEFINITIONS {
                    return (found, notes);
                }
            }
        }
    }

    if !found.is_empty() {
        notes.clear();
    }
    (found, notes)
}

pub fn resolve_rust_path_item(
    index: &Index,
    current: &IndexedFile,
    root: &Path,
    segments: &[String],
    in_use: bool,
    current_text: &str,
    notes: &mut Vec<String>,
) -> Vec<Located> {
    let Some(resolution) = resolve_rust_path(&current.path, root, segments, in_use) else {
        notes.push(format!(
            "The path “{}” could not be resolved from this file.",
            segments.join("::")
        ));
        return Vec::new();
    };
    let source = format!("path {}", segments.join("::"));
    let Some(item_index) = resolution.item_index else {
        return resolution
            .module_file
            .map(|module_file| vec![module_start(&module_file, root, source)])
            .unwrap_or_default();
    };
    let item = &segments[item_index];

    if item_index + 1 == segments.len() {
        if let Some(module_file) = &resolution.module_file {
            if let Some(found) = declaration_in_file(
                index,
                current,
                module_file,
                item,
                None,
                current_text,
                source.clone(),
            ) {
                return vec![found];
            }
            if let Some((nested_module, _)) = rust_module_file(&resolution.module_dir, item) {
                return vec![module_start(&nested_module, root, source)];
            }
            notes.push(format!(
                "“{item}” resolved to {}, but no declaration of it was found there.",
                module_file.to_string_lossy()
            ));
        }
        return Vec::new();
    }

    let container = item.clone();
    let name = segments.last().cloned().unwrap_or_default();
    if let Some(module_file) = &resolution.module_file {
        if let Some(found) = declaration_in_file(
            index,
            current,
            module_file,
            &name,
            Some(&container),
            current_text,
            source.clone(),
        ) {
            return vec![found];
        }
    }
    notes.push(format!(
        "“{name}” is an associated item of “{container}”; this editor could not find it in the module the path resolved to."
    ));
    Vec::new()
}
