use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use regex::Regex;

use super::*;

pub fn rust_mod_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*;")
            .expect("the Rust mod pattern is valid")
    })
}

pub fn rust_use_alias_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^(?P<path>.+?)\s+as\s+(?P<alias>[A-Za-z_][A-Za-z0-9_]*)$")
            .expect("the Rust use alias pattern is valid")
    })
}

pub fn scan_rust_mods(text: &str) -> Vec<(String, usize)> {
    rust_mod_regex()
        .captures_iter(text)
        .filter_map(|captures| {
            let name = captures.name("name")?.as_str().to_string();
            let start = captures.get(0)?.start();
            let line = text[..start].matches('\n').count() + 1;
            Some((name, line))
        })
        .collect()
}

pub fn scan_rust_uses(text: &str) -> Vec<UsePath> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut uses = Vec::new();
    let mut line = 0usize;
    while line < lines.len() {
        let trimmed = lines[line].trim_start();
        let is_use = trimmed.starts_with("use ")
            || trimmed.starts_with("pub use ")
            || (trimmed.starts_with("pub(") && trimmed.contains(") use "));
        if !is_use {
            line += 1;
            continue;
        }
        let mut end = line;
        let mut statement = String::new();
        let mut depth = 0i32;
        let mut complete = false;
        while end < lines.len() && end - line < 40 {
            let current = lines[end];
            statement.push_str(current);
            statement.push('\n');
            depth += current.chars().filter(|c| *c == '{').count() as i32;
            depth -= current.chars().filter(|c| *c == '}').count() as i32;
            if depth <= 0 && current.contains(';') {
                complete = true;
                break;
            }
            end += 1;
        }
        if complete {
            if let Some(position) = statement.find("use ") {
                let body = statement[position + 4..].trim().trim_end_matches(';');
                let mut paths = Vec::new();
                parse_use_tree(body, &[], &mut paths);
                uses.extend(paths);
            }
        }
        line = end + 1;
    }
    uses
}

pub fn split_path(text: &str) -> Vec<String> {
    text.split("::")
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn parse_use_tree(input: &str, prefix: &[String], out: &mut Vec<UsePath>) {
    let input = input.trim().trim_end_matches(';');
    if input.is_empty() {
        return;
    }
    for part in split_top_level(input, ',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if part.starts_with('{') && part.ends_with('}') {
            parse_use_tree(part[1..part.len() - 1].trim(), prefix, out);
            continue;
        }
        if let Some(brace) = part.find('{') {
            let head = part[..brace].trim().trim_end_matches("::").trim();
            if let Some(inner) = part[brace + 1..].strip_suffix('}') {
                let mut next_prefix = prefix.to_vec();
                next_prefix.extend(split_path(head));
                parse_use_tree(inner.trim(), &next_prefix, out);
            }
            continue;
        }
        let (path_text, alias) = match rust_use_alias_regex().captures(part) {
            Some(captures) => (
                captures
                    .name("path")
                    .map(|m| m.as_str())
                    .unwrap_or("")
                    .to_string(),
                captures.name("alias").map(|m| m.as_str().to_string()),
            ),
            None => (part.to_string(), None),
        };
        let mut segments = prefix.to_vec();
        segments.extend(split_path(&path_text));
        if segments.is_empty() {
            continue;
        }
        if segments
            .last()
            .map(|segment| segment == "*")
            .unwrap_or(false)
        {
            continue;
        }
        if segments
            .last()
            .map(|segment| segment == "self")
            .unwrap_or(false)
        {
            segments.pop();
            if segments.is_empty() {
                continue;
            }
        }
        let local = alias
            .or_else(|| segments.last().cloned())
            .unwrap_or_default();
        if local.is_empty() {
            continue;
        }
        out.push(UsePath { segments, local });
    }
}

pub fn children_dir(file: &Path) -> PathBuf {
    let parent = file.parent().unwrap_or_else(|| Path::new(""));
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    if name == "mod.rs" || name == "lib.rs" || name == "main.rs" {
        parent.to_path_buf()
    } else {
        parent.join(file.file_stem().unwrap_or_default())
    }
}

pub fn module_file_for_dir(directory: &Path) -> Option<PathBuf> {
    let mod_rs = directory.join("mod.rs");
    if mod_rs.is_file() {
        return Some(mod_rs);
    }
    if let (Some(parent), Some(name)) = (directory.parent(), directory.file_name()) {
        let sibling = parent.join(name).with_extension("rs");
        if sibling.is_file() {
            return Some(sibling);
        }
    }
    for name in ["lib.rs", "main.rs"] {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn rust_module_file(directory: &Path, name: &str) -> Option<(PathBuf, PathBuf)> {
    let direct = directory.join(format!("{name}.rs"));
    if direct.is_file() {
        let children = directory.join(name);
        return Some((direct, children));
    }
    let mod_rs = directory.join(name).join("mod.rs");
    if mod_rs.is_file() {
        let children = directory.join(name);
        return Some((mod_rs, children));
    }
    None
}

pub struct RustModuleInfo {
    pub crate_dir: PathBuf,
    pub crate_file: PathBuf,
    pub children_dir: PathBuf,
}

pub fn rust_module_info(file: &Path, root: &Path) -> RustModuleInfo {
    let children = children_dir(file);
    let mut cargo_dir = None;
    let mut directory = file.parent();
    while let Some(current) = directory {
        if current.join("Cargo.toml").is_file() {
            cargo_dir = Some(current.to_path_buf());
            break;
        }
        if current == root {
            break;
        }
        directory = current.parent();
    }

    let (crate_dir, crate_file) = match cargo_dir {
        Some(cargo) => {
            let src = cargo.join("src");
            let is_crate_root = file == src.join("lib.rs")
                || file == src.join("main.rs")
                || file.starts_with(src.join("bin"));
            if is_crate_root {
                (children.clone(), file.to_path_buf())
            } else if src.join("lib.rs").is_file() {
                (src.clone(), src.join("lib.rs"))
            } else if src.join("main.rs").is_file() {
                (src.clone(), src.join("main.rs"))
            } else {
                (
                    src.clone(),
                    module_file_for_dir(&src).unwrap_or_else(|| src.join("lib.rs")),
                )
            }
        }
        None => {
            let src = root.join("src");
            let is_crate_root = file == src.join("lib.rs") || file == src.join("main.rs");
            if is_crate_root {
                (children.clone(), file.to_path_buf())
            } else if src.join("lib.rs").is_file() {
                (src.clone(), src.join("lib.rs"))
            } else if src.join("main.rs").is_file() {
                (src.clone(), src.join("main.rs"))
            } else {
                (
                    src.clone(),
                    module_file_for_dir(&src).unwrap_or_else(|| file.to_path_buf()),
                )
            }
        }
    };

    RustModuleInfo {
        crate_dir,
        crate_file,
        children_dir: children,
    }
}

pub struct RustPathResolution {
    pub module_dir: PathBuf,
    pub module_file: Option<PathBuf>,
    pub item_index: Option<usize>,
}

pub fn resolve_rust_path(
    file: &Path,
    root: &Path,
    segments: &[String],
    in_use: bool,
) -> Option<RustPathResolution> {
    let info = rust_module_info(file, root);
    let (mut directory, mut module_file, mut index) = match segments.first().map(String::as_str) {
        Some("crate") => (
            info.crate_dir.clone(),
            Some(info.crate_file.clone()),
            1usize,
        ),
        Some("self") => (info.children_dir.clone(), Some(file.to_path_buf()), 1usize),
        Some(_) => {
            let mut supers = 0usize;
            while segments
                .get(supers)
                .map(|segment| segment == "super")
                .unwrap_or(false)
            {
                supers += 1;
            }
            if supers > 0 {
                let mut directory = info.children_dir.clone();
                for _ in 0..supers {
                    directory = directory.parent()?.to_path_buf();
                }
                let module_file = module_file_for_dir(&directory)
                    .or_else(|| (directory == info.crate_dir).then(|| info.crate_file.clone()));
                (directory, module_file, supers)
            } else if in_use {
                (
                    info.crate_dir.clone(),
                    Some(info.crate_file.clone()),
                    0usize,
                )
            } else {
                (
                    info.children_dir.clone(),
                    module_file_for_dir(&info.children_dir),
                    0usize,
                )
            }
        }
        None => return None,
    };

    while index < segments.len() {
        match rust_module_file(&directory, &segments[index]) {
            Some((next_file, next_directory)) => {
                module_file = Some(next_file);
                directory = next_directory;
                index += 1;
            }
            None => break,
        }
    }

    Some(RustPathResolution {
        module_dir: directory,
        module_file,
        item_index: (index < segments.len()).then_some(index),
    })
}
