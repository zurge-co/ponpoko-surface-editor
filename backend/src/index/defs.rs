use std::collections::HashSet;
use std::path::{Path, PathBuf};
use serde_json::{json, Value};
use crate::workspace::{language_for_path, Language};
use crate::{invalid_params, RpcError};

use super::*;

pub fn in_use_statement(text: &str, line: usize) -> bool {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut index = line.saturating_sub(1);
    for _ in 0..12 {
        let Some(current) = lines.get(index) else {
            return false;
        };
        let trimmed = current.trim_start();
        if trimmed.starts_with("use ")
            || trimmed.starts_with("pub use ")
            || (trimmed.starts_with("pub(") && trimmed.contains(") use "))
        {
            return true;
        }
        if trimmed.is_empty()
            || trimmed.ends_with(';')
            || trimmed.starts_with("fn ")
            || trimmed.starts_with("impl ")
        {
            return false;
        }
        if index == 0 {
            return false;
        }
        index -= 1;
    }
    false
}


pub struct Located {
    pub path: PathBuf,
    pub relative: String,
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub column: usize,
    pub length: usize,
    pub source: String,
    pub excerpt: String,
}

pub fn located_from_declaration(
    file: &IndexedFile,
    declaration: &Declaration,
    source: String,
    current_text: Option<&str>,
) -> Located {
    Located {
        path: file.path.clone(),
        relative: file.relative.clone(),
        name: declaration.name.clone(),
        kind: declaration.kind.clone(),
        line: declaration.line,
        column: declaration.column,
        length: declaration.name.chars().map(|c| c.len_utf16()).sum(),
        source,
        excerpt: excerpt_of(&file.path, declaration.line, current_text),
    }
}

pub fn module_start(path: &Path, root: &Path, source: String) -> Located {
    let excerpt = read_line(path, 1)
        .map(|line| truncate(&line))
        .unwrap_or_default();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "module".to_string());
    Located {
        path: path.to_path_buf(),
        relative: relative_path(root, path),
        name,
        kind: "module".to_string(),
        line: 1,
        column: 1,
        length: 1,
        source,
        excerpt,
    }
}

pub fn text_for<'a>(current: &IndexedFile, target: &Path, current_text: &'a str) -> Option<&'a str> {
    (path_key(target) == path_key(&current.path)).then_some(current_text)
}

pub fn file_or_current<'a>(
    index: &'a Index,
    current: &'a IndexedFile,
    path: &Path,
) -> Option<&'a IndexedFile> {
    if path_key(path) == path_key(&current.path) {
        Some(current)
    } else {
        index.file(path)
    }
}

pub fn declaration_in_file(
    index: &Index,
    current: &IndexedFile,
    path: &Path,
    name: &str,
    container: Option<&str>,
    current_text: &str,
    source: String,
) -> Option<Located> {
    let file = file_or_current(index, current, path)?;
    let declaration = file.declarations.iter().find(|declaration| {
        declaration.name == name
            && container
                .map(|container| declaration.container.as_deref() == Some(container))
                .unwrap_or(true)
    })?;
    Some(located_from_declaration(
        file,
        declaration,
        source,
        text_for(current, path, current_text),
    ))
}

pub fn definition_answer(
    index: &Index,
    root: &Path,
    path: &Path,
    params: &Value,
) -> Result<Value, RpcError> {
    let text = match params.get("text").and_then(Value::as_str) {
        Some(text) => text.to_string(),
        None => read_code(path).unwrap_or_default(),
    };
    let language = language_for_path(path);
    let word_param = params
        .get("word")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|word| !word.is_empty());
    let line_param = params.get("line").and_then(Value::as_u64);
    let column_param = params.get("column").and_then(Value::as_u64);
    let mut notes = Vec::new();

    let (word, start_column, cursor_line) = match word_param {
        Some(word) => {
            let line = line_param.unwrap_or(1) as usize;
            let column = column_param.unwrap_or(1) as usize;
            (word.to_string(), column, line)
        }
        None => {
            let line = line_param.ok_or_else(|| {
                invalid_params("workspace.definition needs 'line' and 'column', or 'word'")
            })? as usize;
            let column = column_param.ok_or_else(|| {
                invalid_params("workspace.definition needs 'line' and 'column', or 'word'")
            })? as usize;
            match word_at(&text, line, column) {
                Some(found) => (found.word, found.start_column, line),
                None => {
                    if is_js_like(language) {
                        if let Some(specifier) = specifier_at(&text, line, column) {
                            let config = discover_ts_config(path, root);
                            if let Some(target) =
                                resolve_ts_module(&specifier, path, config.as_ref())
                            {
                                let located =
                                    module_start(&target, root, format!("import \"{specifier}\""));
                                return Ok(definition_json(
                                    path,
                                    &language,
                                    &specifier,
                                    vec![located],
                                    Vec::new(),
                                ));
                            }
                        }
                    }
                    notes.push(
                        "There is no identifier or import path under the cursor.".to_string(),
                    );
                    return Ok(definition_json(path, &language, "", Vec::new(), notes));
                }
            }
        }
    };

    let relative = relative_path(root, path);
    let current = IndexedFile::parse(path.to_path_buf(), relative, language, text.clone());
    let context = if line_param.is_some() && column_param.is_some() {
        path_context(&text, cursor_line, start_column, language)
    } else {
        None
    };

    let (mut definitions, mut resolution_notes) = match (&current.language, &language) {
        (Language::TypeScript, _) | (Language::JavaScript, _) => resolve_js(
            index,
            &current,
            &text,
            root,
            &word,
            context.as_ref(),
            cursor_line,
            start_column,
        ),
        (Language::Rust, _) => resolve_rust(
            index,
            &current,
            &text,
            root,
            &word,
            context.as_ref(),
            cursor_line,
        ),
        _ => (
            Vec::new(),
            vec![format!(
                "Navigation in this editor understands TypeScript, JavaScript and Rust. {} files are not indexed.",
                language.id()
            )],
        ),
    };
    notes.append(&mut resolution_notes);

    let mut seen = HashSet::new();
    definitions.retain(|definition| {
        seen.insert((
            path_key(&definition.path),
            definition.line,
            definition.column,
        ))
    });
    definitions.truncate(MAX_DEFINITIONS);
    if definitions.is_empty() && notes.is_empty() {
        notes.push(format!(
            "No definition of “{word}” was found in this folder. This editor's navigation is static and heuristic — it does not run code, so a name that only exists at run time has no definition here."
        ));
    }

    Ok(definition_json(path, &language, &word, definitions, notes))
}

pub fn definition_json(
    path: &Path,
    language: &Language,
    word: &str,
    definitions: Vec<Located>,
    notes: Vec<String>,
) -> Value {
    json!({
        "path": path.to_string_lossy(),
        "word": word,
        "language": language.id(),
        "definitions": definitions.iter().map(|definition| json!({
            "path": definition.path.to_string_lossy(),
            "relative": definition.relative,
            "name": definition.name,
            "kind": definition.kind,
            "line": definition.line,
            "column": definition.column,
            "length": definition.length,
            "language": language_for_path(&definition.path).id(),
            "source": definition.source,
            "excerpt": definition.excerpt,
        })).collect::<Vec<Value>>(),
        "notes": notes,
    })
}
