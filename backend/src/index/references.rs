use std::path::{Path, PathBuf};
use serde_json::{json, Value};
use crate::workspace::{language_for_path, mask_noncode, walk_files};
use crate::{invalid_params, RpcError};

use super::*;

pub fn references_answer(
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
    let word = match word_param {
        Some(word) => word.to_string(),
        None => {
            let line = params.get("line").and_then(Value::as_u64).ok_or_else(|| {
                invalid_params("workspace.references needs 'line' and 'column', or 'word'")
            })? as usize;
            let column = params
                .get("column")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    invalid_params("workspace.references needs 'line' and 'column', or 'word'")
                })? as usize;
            match word_at(&text, line, column) {
                Some(found) => found.word,
                None => {
                    return Ok(json!({
                        "root": root.to_string_lossy(),
                        "path": path.to_string_lossy(),
                        "word": "",
                        "language": language.id(),
                        "references": [],
                        "files_searched": 0,
                        "truncated": false,
                        "notes": ["There is no identifier under the cursor."],
                    }))
                }
            }
        }
    };

    let current = IndexedFile::parse(
        path.to_path_buf(),
        relative_path(root, path),
        language,
        text.clone(),
    );
    let word_chars: Vec<char> = word.chars().collect();
    let mut references = Vec::new();
    let mut files_searched = 0usize;
    let mut truncated = false;

    let (files, walk_truncated) = walk_files(root, false);
    let mut candidates: Vec<PathBuf> = files.into_iter().map(|file| file.path).collect();
    if !candidates
        .iter()
        .any(|candidate| path_key(candidate) == path_key(path))
    {
        candidates.push(path.to_path_buf());
    }

    'files: for candidate in candidates {
        let is_current = path_key(&candidate) == path_key(path);
        let file_language = language_for_path(&candidate);
        if !is_current && !is_searchable_language(file_language) {
            continue;
        }
        let Some(file_text) = (if is_current {
            Some(text.clone())
        } else {
            read_code(&candidate)
        }) else {
            continue;
        };
        files_searched += 1;
        let masked = mask_noncode(&file_text, file_language);
        let original_lines: Vec<&str> = file_text.split('\n').collect();
        let masked_lines: Vec<&str> = masked.split('\n').collect();
        for (line_index, (original, masked_line)) in
            original_lines.iter().zip(masked_lines.iter()).enumerate()
        {
            let masked_chars: Vec<char> = masked_line.chars().collect();
            let original_chars: Vec<char> = original.chars().collect();
            if masked_chars.len() < word_chars.len() {
                continue;
            }
            let mut position = 0usize;
            while position + word_chars.len() <= masked_chars.len() {
                let matches_word =
                    masked_chars[position..position + word_chars.len()] == word_chars[..];
                if !matches_word {
                    position += 1;
                    continue;
                }
                let before_is_word = position > 0 && is_word_char(masked_chars[position - 1]);
                let after_is_word = masked_chars
                    .get(position + word_chars.len())
                    .copied()
                    .is_some_and(is_word_char);
                if before_is_word || after_is_word {
                    position += 1;
                    continue;
                }
                let column = char_to_utf16(&original_chars, position) + 1;
                let is_definition = if is_current {
                    current.declarations.iter().any(|declaration| {
                        declaration.line == line_index + 1 && declaration.column == column
                    })
                } else {
                    index
                        .file(&candidate)
                        .map(|file| {
                            file.declarations.iter().any(|declaration| {
                                declaration.line == line_index + 1 && declaration.column == column
                            })
                        })
                        .unwrap_or(false)
                };
                references.push(json!({
                    "path": candidate.to_string_lossy(),
                    "relative": relative_path(root, &candidate),
                    "line": line_index + 1,
                    "column": column,
                    "length": word_chars.iter().map(|c| c.len_utf16()).sum::<usize>(),
                    "line_text": truncate(original),
                    "kind": if is_definition { "definition" } else { "reference" },
                }));
                if references.len() >= MAX_REFERENCES {
                    truncated = true;
                    break 'files;
                }
                position += word_chars.len();
            }
        }
    }

    let mut notes = Vec::new();
    if references.is_empty() && !word.is_empty() {
        notes.push(format!(
            "No code reference to “{word}” was found in this folder. Comments and string contents are not counted."
        ));
    }

    Ok(json!({
        "root": root.to_string_lossy(),
        "path": path.to_string_lossy(),
        "word": word,
        "language": language.id(),
        "references": references,
        "files_searched": files_searched,
        "truncated": truncated || walk_truncated,
        "notes": notes,
    }))
}
