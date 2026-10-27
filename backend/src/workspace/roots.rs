use std::path::{Path, PathBuf};
use ignore::WalkBuilder;
use serde_json::Value;
use crate::{invalid_params, RpcError};

use super::*;

pub fn root_param(params: &Value, method: &str) -> Result<PathBuf, RpcError> {
    let root = params
        .get("root")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .ok_or_else(|| invalid_params(format!("{method} needs a non-empty 'root'")))?;
    let path = PathBuf::from(root);
    if !path.is_dir() {
        return Err(invalid_params(format!(
            "{root} is not a folder — open a workspace folder first"
        )));
    }
    Ok(path)
}

pub(crate) fn walk_files(root: &Path, include_hidden: bool) -> (Vec<FileMeta>, bool) {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(!include_hidden)
        .parents(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !IGNORED_DIRS
                .iter()
                .any(|ignored| name.eq_ignore_ascii_case(ignored))
        });

    let mut files = Vec::new();
    let mut truncated = false;
    for entry in builder.build() {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        let path = entry.path().to_path_buf();
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata().ok();
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_ms = metadata.as_ref().and_then(|m| {
            m.modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64)
        });
        files.push(FileMeta {
            path,
            relative,
            size,
            modified_ms,
        });
        if files.len() >= MAX_WORKSPACE_FILES {
            truncated = true;
            break;
        }
    }
    files.sort_by(|left, right| left.relative.cmp(&right.relative));
    (files, truncated)
}

pub fn read_searchable(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_SEARCH_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub fn truncate_line(line: &str) -> String {
    if line.chars().count() <= MAX_LINE_TEXT {
        return line.to_string();
    }
    let mut text: String = line.chars().take(MAX_LINE_TEXT).collect();
    text.push('…');
    text
}
