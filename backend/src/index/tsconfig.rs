use std::path::{Path, PathBuf};
use serde_json::Value;

use super::*;

#[derive(Clone, Debug, Default)]
pub struct TsConfig {
    pub base_url: Option<PathBuf>,
    pub paths: Vec<(String, Vec<PathBuf>)>,
    pub config_dir: PathBuf,
}

pub fn discover_ts_config(from: &Path, root: &Path) -> Option<TsConfig> {
    let mut directory = from.parent();
    while let Some(current) = directory {
        for name in ["tsconfig.json", "jsconfig.json"] {
            let candidate = current.join(name);
            if candidate.is_file() {
                return read_ts_config(&candidate, 0);
            }
        }
        if current == root {
            break;
        }
        directory = current.parent();
    }
    None
}

pub fn resolve_extends(specifier: &str, directory: &Path) -> Option<PathBuf> {
    if !specifier.starts_with('.') && !specifier.starts_with('/') {
        return None;
    }
    let mut candidate = if specifier.starts_with('/') {
        PathBuf::from(specifier)
    } else {
        directory.join(specifier)
    };
    if candidate.extension().is_none() {
        candidate.set_extension("json");
    }
    candidate.is_file().then_some(candidate)
}

pub fn read_ts_config(path: &Path, depth: usize) -> Option<TsConfig> {
    if depth > 5 {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&strip_jsonc(&text)).ok()?;
    let config_dir = path.parent()?.to_path_buf();
    let mut config = value
        .get("extends")
        .and_then(Value::as_str)
        .and_then(|specifier| resolve_extends(specifier, &config_dir))
        .and_then(|parent| read_ts_config(&parent, depth + 1))
        .unwrap_or(TsConfig {
            base_url: None,
            paths: Vec::new(),
            config_dir: config_dir.clone(),
        });

    let compiler = value.get("compilerOptions");
    if let Some(base_url) = compiler
        .and_then(|options| options.get("baseUrl"))
        .and_then(Value::as_str)
    {
        config.base_url = Some(config_dir.join(base_url));
    }
    if let Some(paths) = compiler
        .and_then(|options| options.get("paths"))
        .and_then(Value::as_object)
    {
        let base = config
            .base_url
            .clone()
            .unwrap_or_else(|| config_dir.clone());
        config.paths.clear();
        for (pattern, targets) in paths {
            let Some(list) = targets.as_array() else {
                continue;
            };
            let targets = list
                .iter()
                .filter_map(Value::as_str)
                .map(|target| base.join(target))
                .collect();
            config.paths.push((pattern.clone(), targets));
        }
    }
    config.config_dir = config_dir;
    Some(config)
}

pub fn strip_jsonc(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut without_comments = String::with_capacity(text.len());
    let mut index = 0usize;
    let mut in_string = false;
    let mut quote = '"';
    while index < chars.len() {
        let c = chars[index];
        if in_string {
            without_comments.push(c);
            if c == '\\' {
                if let Some(next) = chars.get(index + 1) {
                    without_comments.push(*next);
                    index += 2;
                    continue;
                }
            } else if c == quote {
                in_string = false;
            }
            index += 1;
        } else if c == '"' || c == '\'' {
            in_string = true;
            quote = c;
            without_comments.push(c);
            index += 1;
        } else if c == '/' && chars.get(index + 1) == Some(&'/') {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
        } else if c == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < chars.len() && !(chars[index] == '*' && chars[index + 1] == '/') {
                index += 1;
            }
            index += 2;
        } else {
            without_comments.push(c);
            index += 1;
        }
    }

    let chars: Vec<char> = without_comments.chars().collect();
    let mut result = String::with_capacity(without_comments.len());
    let mut index = 0usize;
    let mut in_string = false;
    let mut quote = '"';
    while index < chars.len() {
        let c = chars[index];
        if in_string {
            result.push(c);
            if c == '\\' {
                if let Some(next) = chars.get(index + 1) {
                    result.push(*next);
                    index += 2;
                    continue;
                }
            } else if c == quote {
                in_string = false;
            }
            index += 1;
        } else if c == '"' || c == '\'' {
            in_string = true;
            quote = c;
            result.push(c);
            index += 1;
        } else if c == ',' {
            let mut next = index + 1;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            if matches!(chars.get(next), Some('}') | Some(']')) {
                index += 1;
                continue;
            }
            result.push(c);
            index += 1;
        } else {
            result.push(c);
            index += 1;
        }
    }
    result
}

pub fn resolve_ts_module(specifier: &str, from: &Path, config: Option<&TsConfig>) -> Option<PathBuf> {
    let base = if specifier.starts_with('.') {
        from.parent()?.join(specifier)
    } else if specifier.starts_with('/') {
        PathBuf::from(specifier)
    } else {
        let config = config?;
        let mut best: Option<(usize, PathBuf)> = None;
        for (pattern, targets) in &config.paths {
            if let Some(star) = pattern.find('*') {
                let prefix = &pattern[..star];
                let suffix = &pattern[star + 1..];
                if specifier.starts_with(prefix)
                    && specifier.ends_with(suffix)
                    && specifier.len() >= prefix.len() + suffix.len()
                {
                    let middle = &specifier[prefix.len()..specifier.len() - suffix.len()];
                    for target in targets {
                        let substituted = target.to_string_lossy().replace('*', middle);
                        if best
                            .as_ref()
                            .map(|(length, _)| prefix.len() > *length)
                            .unwrap_or(true)
                        {
                            best = Some((prefix.len(), PathBuf::from(substituted)));
                        }
                    }
                }
            } else if pattern == specifier {
                if let Some(target) = targets.first() {
                    if best
                        .as_ref()
                        .map(|(length, _)| pattern.len() > *length)
                        .unwrap_or(true)
                    {
                        best = Some((pattern.len(), target.clone()));
                    }
                }
            }
        }
        match best {
            Some((_, candidate)) => candidate,
            None => config.base_url.as_ref()?.join(specifier),
        }
    };
    try_ts_file(&base)
}

pub fn try_ts_file(base: &Path) -> Option<PathBuf> {
    if base.is_file() {
        return Some(base.to_path_buf());
    }
    if let Some(extension) = base.extension().and_then(|value| value.to_str()) {
        let extension = extension.to_ascii_lowercase();
        if matches!(extension.as_str(), "js" | "jsx" | "mjs" | "cjs") {
            let stem = base.with_extension("");
            for candidate_extension in ["ts", "tsx", "mts", "cts"] {
                let candidate = stem.with_extension(candidate_extension);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        if TS_EXTENSIONS.contains(&extension.as_str()) {
            return None;
        }
    } else {
        for extension in TS_EXTENSIONS {
            let candidate = base.with_extension(extension);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let declaration_file = PathBuf::from(format!("{}.d.ts", base.to_string_lossy()));
        if declaration_file.is_file() {
            return Some(declaration_file);
        }
    }
    if base.is_dir() {
        for extension in TS_EXTENSIONS {
            let candidate = base.join(format!("index.{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let declaration_file = base.join("index.d.ts");
        if declaration_file.is_file() {
            return Some(declaration_file);
        }
    }
    None
}
