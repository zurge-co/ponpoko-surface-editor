use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use serde_json::{json, Value};
use crate::{internal, invalid_params, RpcError};

use super::*;

pub struct Listed {
    name: String,
    path: PathBuf,
    is_dir: bool,
    is_symlink: bool,
    bytes: u64,
    modified: Value,
}

pub(crate) fn list(params: &Value) -> Result<Value, RpcError> {
    let path = path_param(params, "fs.list")?;
    let show_hidden = bool_param(params, "show_hidden", false);
    let metadata = std::fs::metadata(&path)
        .map_err(|e| internal(format!("{} could not be listed: {e}", path.display())))?;
    if !metadata.is_dir() {
        return Err(invalid_params(format!(
            "{} is not a folder — fs.list lists folders",
            path.display()
        )));
    }

    let read_dir = std::fs::read_dir(&path)
        .map_err(|e| internal(format!("{} could not be listed: {e}", path.display())))?;
    let mut entries: Vec<Listed> = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                return Err(internal(format!(
                    "{} could not be read while listing: {e}",
                    path.display()
                )))
            }
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let child = entry.path();
        let symlink_meta = match std::fs::symlink_metadata(&child) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let is_symlink = symlink_meta.file_type().is_symlink();
        let followed = std::fs::metadata(&child).ok();
        let is_dir = followed.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let bytes = followed.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = followed.as_ref().map(modified_ms).unwrap_or(Value::Null);
        entries.push(Listed {
            name,
            path: child,
            is_dir,
            is_symlink,
            bytes,
            modified,
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });

    let entries: Vec<Value> = entries
        .into_iter()
        .map(|entry| {
            json!({
                "name": entry.name,
                "path": entry.path.to_string_lossy(),
                "is_dir": entry.is_dir,
                "is_symlink": entry.is_symlink,
                "bytes": entry.bytes,
                "modified_ms": entry.modified,
            })
        })
        .collect();

    Ok(json!({
        "path": path.to_string_lossy(),
        "parent": path.parent().map(|parent| parent.to_string_lossy().to_string()),
        "entries": entries,
    }))
}

pub(crate) fn create(params: &Value) -> Result<Value, RpcError> {
    let path = path_param(params, "fs.create")?;
    let kind = params
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("file")
        .trim();
    if path.exists() {
        return Err(invalid_params(format!(
            "{} already exists — choose another name",
            path.display()
        )));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(invalid_params(format!(
            "{} does not exist — create the folder first",
            parent.display()
        )));
    }

    match kind {
        "file" => {
            let content = params.get("content").and_then(Value::as_str).unwrap_or("");
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| internal(format!("{} could not be created: {e}", path.display())))?;
            file.write_all(content.as_bytes())
                .map_err(|e| internal(format!("{} could not be written: {e}", path.display())))?;
        }
        "directory" => {
            std::fs::create_dir(&path)
                .map_err(|e| internal(format!("{} could not be created: {e}", path.display())))?;
        }
        other => {
            return Err(invalid_params(format!(
                "fs.create kind must be \"file\" or \"directory\", not '{other}'"
            )))
        }
    }

    let metadata = std::fs::metadata(&path).map_err(|e| {
        internal(format!(
            "{} was created but could not be read: {e}",
            path.display()
        ))
    })?;
    let mut value = entry_value(
        &path,
        metadata.is_file(),
        metadata.len(),
        modified_ms(&metadata),
    );
    value["exists"] = json!(true);
    Ok(value)
}

pub(crate) fn rename(params: &Value) -> Result<Value, RpcError> {
    let from = path_param(params, "fs.rename")?;
    let to = params
        .get("to")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|to| !to.is_empty())
        .ok_or_else(|| invalid_params("fs.rename needs a non-empty 'to' path"))?;
    let to = PathBuf::from(to);

    if from == to {
        return Err(invalid_params("fs.rename needs two different paths"));
    }
    let from_meta = std::fs::symlink_metadata(&from)
        .map_err(|e| internal(format!("{} could not be renamed: {e}", from.display())))?;
    if from_meta.is_dir() && to.starts_with(&from) {
        return Err(invalid_params(format!(
            "{} cannot be moved inside itself ({})",
            from.display(),
            to.display()
        )));
    }
    if to.exists() {
        return Err(invalid_params(format!(
            "{} already exists — choose another name",
            to.display()
        )));
    }
    let parent = to
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(invalid_params(format!(
            "{} does not exist — create the folder first",
            parent.display()
        )));
    }

    let is_dir = from_meta.is_dir();
    std::fs::rename(&from, &to).map_err(|e| {
        internal(format!(
            "{} could not be renamed to {}: {e}",
            from.display(),
            to.display()
        ))
    })?;
    Ok(json!({
        "from": from.to_string_lossy(),
        "to": to.to_string_lossy(),
        "is_dir": is_dir,
    }))
}

pub(crate) fn delete(params: &Value) -> Result<Value, RpcError> {
    let path = path_param(params, "fs.delete")?;
    let recursive = bool_param(params, "recursive", false);
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|e| internal(format!("{} could not be deleted: {e}", path.display())))?;

    if path.parent().is_none() {
        return Err(invalid_params(format!(
            "{} is a filesystem root — this editor will not delete it",
            path.display()
        )));
    }

    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(&path)
            .map_err(|e| internal(format!("{} could not be deleted: {e}", path.display())))?;
    } else if metadata.is_dir() {
        if recursive {
            std::fs::remove_dir_all(&path)
                .map_err(|e| internal(format!("{} could not be deleted: {e}", path.display())))?;
        } else {
            std::fs::remove_dir(&path).map_err(|e| {
                internal(format!(
                    "{} is a folder and is not empty (or could not be removed without recursion): {e}",
                    path.display()
                ))
            })?;
        }
    } else {
        return Err(invalid_params(format!(
            "{} is neither a file nor a folder",
            path.display()
        )));
    }

    Ok(json!({
        "path": path.to_string_lossy(),
        "deleted": true,
        "recursive": recursive,
    }))
}

pub(crate) fn reveal_command(path: &Path, os: &str) -> (String, Vec<String>) {
    let target = path.to_string_lossy().to_string();
    match os {
        "macos" => ("open".to_string(), vec!["-R".to_string(), target]),
        "windows" => ("explorer".to_string(), vec![format!("/select,{target}")]),
        _ => {
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty());
            let target = parent.unwrap_or(path).to_string_lossy().to_string();
            ("xdg-open".to_string(), vec![target])
        }
    }
}

pub(crate) fn reveal(params: &Value) -> Result<Value, RpcError> {
    let path = path_param(params, "fs.reveal")?;
    if !path.exists() {
        return Err(invalid_params(format!("{} does not exist", path.display())));
    }
    let (program, args) = reveal_command(&path, std::env::consts::OS);
    let mut command = Command::new(&program);
    command.args(&args);
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match child {
        Ok(_) => Ok(json!({
            "revealed": true,
            "opener": program,
            "path": path.to_string_lossy(),
        })),
        Err(e) => Err(internal(format!(
            "{} could not be shown in the file manager with '{program}': {e}",
            path.display()
        ))),
    }
}

pub(crate) fn app_info() -> Value {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    json!({
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "home": home.to_string_lossy(),
        "separator": std::path::MAIN_SEPARATOR.to_string(),
    })
}
