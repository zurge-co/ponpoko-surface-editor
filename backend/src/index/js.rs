use std::path::Path;

use super::*;

pub fn resolve_js(
    index: &Index,
    current: &IndexedFile,
    current_text: &str,
    root: &Path,
    word: &str,
    context: Option<&PathContext>,
    cursor_line: usize,
    cursor_column: usize,
) -> (Vec<Located>, Vec<String>) {
    let notes = Vec::new();
    let config = discover_ts_config(&current.path, root);

    if let Some(declaration) = declaration_at(current, cursor_line, cursor_column) {
        if declaration.name == word {
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

    if let Some(specifier) = specifier_at(current_text, cursor_line, cursor_column) {
        if let Some(target) = resolve_ts_module(&specifier, &current.path, config.as_ref()) {
            return (
                vec![module_start(
                    &target,
                    root,
                    format!("import \"{specifier}\""),
                )],
                notes,
            );
        }
    }

    if let Some(context) = context.filter(|context| context.index > 0) {
        let (found, member_notes) =
            resolve_js_member(index, current, current_text, word, context, config.as_ref());
        return (found, member_notes);
    }

    if let Some(binding) = current.imports.iter().find(|binding| binding.local == word) {
        return resolve_js_binding(index, current, binding, root, config.as_ref(), current_text);
    }

    let local: Vec<Located> = current
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
    if !local.is_empty() {
        return (local, notes);
    }

    let mut found = Vec::new();
    for file in &index.files {
        if !is_js_like(file.language) || path_key(&file.path) == path_key(&current.path) {
            continue;
        }
        for declaration in &file.declarations {
            if declaration.name != word || declaration.kind == "method" || !declaration.exported {
                continue;
            }
            found.push(located_from_declaration(
                file,
                declaration,
                format!("exported from {}", file.relative),
                None,
            ));
            if found.len() >= MAX_DEFINITIONS {
                return (found, notes);
            }
        }
    }
    (found, notes)
}

pub fn resolve_js_binding(
    index: &Index,
    current: &IndexedFile,
    binding: &ImportBinding,
    root: &Path,
    config: Option<&TsConfig>,
    current_text: &str,
) -> (Vec<Located>, Vec<String>) {
    let mut notes = Vec::new();
    let Some(target) = resolve_ts_module(&binding.specifier, &current.path, config) else {
        notes.push(format!(
            "“{}” comes from \"{}\", and that module could not be resolved from this file.",
            binding.local, binding.specifier
        ));
        return (Vec::new(), notes);
    };
    let source = format!("import \"{}\"", binding.specifier);
    match binding.kind {
        ImportKind::Named => {
            if let Some(found) = declaration_in_file(
                index,
                current,
                &target,
                &binding.imported,
                None,
                current_text,
                source.clone(),
            ) {
                return (vec![found], notes);
            }
            notes.push(format!(
                "“{}” is imported from \"{}\", but that module declares no “{}”.",
                binding.local, binding.specifier, binding.imported
            ));
        }
        ImportKind::Default => {
            let found = default_export(index, current, &target, root, current_text);
            if let Some(found) = found {
                return (vec![found], notes);
            }
            notes.push(format!(
                "“{}” is the default import of \"{}\", and no declaration was found there.",
                binding.local, binding.specifier
            ));
        }
        ImportKind::Namespace => {
            return (vec![module_start(&target, root, source)], notes);
        }
    }
    (Vec::new(), notes)
}

pub fn default_export(
    index: &Index,
    current: &IndexedFile,
    target: &Path,
    root: &Path,
    current_text: &str,
) -> Option<Located> {
    if let Some(file) = file_or_current(index, current, target) {
        if let Some(declaration) = file
            .declarations
            .iter()
            .filter(|declaration| declaration.exported && declaration.kind != "method")
            .min_by_key(|declaration| declaration.line)
        {
            return Some(located_from_declaration(
                file,
                declaration,
                "default export".to_string(),
                text_for(current, target, current_text),
            ));
        }
    }
    if let Some(text) = read_code(target) {
        if let Some(line) = text
            .split('\n')
            .position(|line| line.contains("export default"))
        {
            let line = line + 1;
            return Some(Located {
                path: target.to_path_buf(),
                relative: relative_path(root, target),
                name: "default".to_string(),
                kind: "default".to_string(),
                line,
                column: 1,
                length: 7,
                source: "export default".to_string(),
                excerpt: excerpt_of(target, line, None),
            });
        }
    }
    Some(module_start(target, root, "default import".to_string()))
}

pub fn resolve_js_member(
    index: &Index,
    current: &IndexedFile,
    current_text: &str,
    word: &str,
    context: &PathContext,
    config: Option<&TsConfig>,
) -> (Vec<Located>, Vec<String>) {
    let mut notes = Vec::new();
    let root_segment = context.segments.first().cloned().unwrap_or_default();
    let receiver = context
        .segments
        .get(context.index.saturating_sub(1))
        .cloned()
        .unwrap_or_default();

    if let Some(binding) = current
        .imports
        .iter()
        .find(|binding| binding.local == root_segment)
    {
        let Some(target) = resolve_ts_module(&binding.specifier, &current.path, config) else {
            notes.push(format!(
                "“{root_segment}” comes from \"{}\", and that module could not be resolved from this file.",
                binding.specifier
            ));
            return (Vec::new(), notes);
        };
        let source = format!("import \"{}\"", binding.specifier);
        match binding.kind {
            ImportKind::Namespace => {
                let mut found = Vec::new();
                if let Some(file) = file_or_current(index, current, &target) {
                    for declaration in &file.declarations {
                        if declaration.name == word && declaration.kind != "method" {
                            found.push(located_from_declaration(
                                file,
                                declaration,
                                source.clone(),
                                text_for(current, &target, current_text),
                            ));
                        }
                    }
                }
                if found.is_empty() {
                    notes.push(format!(
                        "“{word}” is not declared in \"{}\".",
                        binding.specifier
                    ));
                }
                return (found, notes);
            }
            ImportKind::Named | ImportKind::Default => {
                let container = if binding.kind == ImportKind::Named {
                    binding.imported.clone()
                } else {
                    file_or_current(index, current, &target)
                        .and_then(|file| {
                            file.declarations
                                .iter()
                                .filter(|declaration| {
                                    declaration.exported && declaration.kind != "method"
                                })
                                .min_by_key(|declaration| declaration.line)
                                .map(|declaration| declaration.name.clone())
                        })
                        .unwrap_or_else(|| receiver.clone())
                };
                if let Some(found) = declaration_in_file(
                    index,
                    current,
                    &target,
                    word,
                    Some(&container),
                    current_text,
                    source.clone(),
                ) {
                    return (vec![found], notes);
                }
                notes.push(format!(
                    "“{container}” is imported from \"{}\", but this editor could not find a declaration of “{word}” on it.",
                    binding.specifier
                ));
                return (Vec::new(), notes);
            }
        }
    }

    if let Some(container_declaration) = current.declarations.iter().find(|declaration| {
        declaration.name == root_segment
            && matches!(
                declaration.kind.as_str(),
                "class" | "interface" | "namespace" | "type" | "enum"
            )
    }) {
        let container = if context.index > 1 {
            context
                .segments
                .get(context.index - 1)
                .cloned()
                .unwrap_or_else(|| container_declaration.name.clone())
        } else {
            container_declaration.name.clone()
        };
        let found: Vec<Located> = current
            .declarations
            .iter()
            .filter(|declaration| {
                declaration.name == word
                    && declaration.container.as_deref() == Some(container.as_str())
            })
            .map(|declaration| {
                located_from_declaration(
                    current,
                    declaration,
                    "this file".to_string(),
                    Some(current_text),
                )
            })
            .collect();
        if !found.is_empty() {
            return (found, notes);
        }
        notes.push(format!(
            "“{container}” declares no “{word}” this editor can see."
        ));
        return (Vec::new(), notes);
    }

    if let Some(receiver_type) = local_receiver_type(current, current_text, &receiver) {
        let found = resolve_js_type_member(
            index,
            current,
            current_text,
            word,
            &receiver_type,
            config,
            &receiver,
        );
        if !found.is_empty() {
            return (found, notes);
        }
    }

    notes.push(format!(
        "“{word}” is a member of “{receiver}”, and this editor has no type information for that receiver."
    ));
    (Vec::new(), notes)
}

pub fn resolve_js_type_member(
    index: &Index,
    current: &IndexedFile,
    current_text: &str,
    word: &str,
    type_name: &str,
    config: Option<&TsConfig>,
    receiver: &str,
) -> Vec<Located> {
    let local: Vec<Located> = current
        .declarations
        .iter()
        .filter(|declaration| {
            declaration.name == word && declaration.container.as_deref() == Some(type_name)
        })
        .map(|declaration| {
            located_from_declaration(
                current,
                declaration,
                format!("type of {receiver}"),
                Some(current_text),
            )
        })
        .collect();
    if !local.is_empty() {
        return local;
    }

    if let Some(binding) = current
        .imports
        .iter()
        .find(|binding| binding.local == type_name)
    {
        if let Some(target) = resolve_ts_module(&binding.specifier, &current.path, config) {
            let container = if binding.kind == ImportKind::Named {
                binding.imported.clone()
            } else {
                file_or_current(index, current, &target)
                    .and_then(|file| {
                        file.declarations
                            .iter()
                            .filter(|declaration| {
                                declaration.exported && declaration.kind != "method"
                            })
                            .min_by_key(|declaration| declaration.line)
                            .map(|declaration| declaration.name.clone())
                    })
                    .unwrap_or_else(|| type_name.to_string())
            };
            if let Some(found) = declaration_in_file(
                index,
                current,
                &target,
                word,
                Some(&container),
                current_text,
                format!("type of {receiver}"),
            ) {
                return vec![found];
            }
        }
    }

    for file in &index.files {
        if !is_js_like(file.language) || path_key(&file.path) == path_key(&current.path) {
            continue;
        }
        let declares_type = file.declarations.iter().any(|declaration| {
            declaration.name == type_name
                && matches!(
                    declaration.kind.as_str(),
                    "class" | "interface" | "struct" | "enum" | "namespace"
                )
        });
        if !declares_type {
            continue;
        }
        if let Some(found) = declaration_in_file(
            index,
            current,
            &file.path,
            word,
            Some(type_name),
            current_text,
            format!("type of {receiver}"),
        ) {
            return vec![found];
        }
    }
    Vec::new()
}
