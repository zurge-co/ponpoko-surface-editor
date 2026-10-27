use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use serde_json::{json, Value};
use crate::fsops;
use crate::index::IndexCache;
use crate::{invalid_params, RpcError};




pub const MAX_WORKSPACE_FILES: usize = 50_000;
pub const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_SEARCH_RESULTS: usize = 2_000;
pub const MAX_LINE_TEXT: usize = 1_000;
pub const CACHE_TTL: Duration = Duration::from_secs(2);

pub const IGNORED_DIRS: [&str; 22] = [
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode-test",
    ".next",
    ".nuxt",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    "vendor",
    "Pods",
    "DerivedData",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Language {
    TypeScript,
    JavaScript,
    Rust,
    Python,
    Go,
    Java,
    C,
    Cpp,
    Json,
    Yaml,
    Markdown,
    Toml,
    Html,
    Css,
    Shell,
    Other,
}

impl Language {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Language::TypeScript => "typescript",
            Language::JavaScript => "javascript",
            Language::Rust => "rust",
            Language::Python => "python",
            Language::Go => "go",
            Language::Java => "java",
            Language::C => "c",
            Language::Cpp => "cpp",
            Language::Json => "json",
            Language::Yaml => "yaml",
            Language::Markdown => "markdown",
            Language::Toml => "toml",
            Language::Html => "html",
            Language::Css => "css",
            Language::Shell => "shell",
            Language::Other => "text",
        }
    }
}

pub(crate) fn language_for_path(path: &Path) -> Language {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name == "cargo.toml" {
        return Language::Toml;
    }
    if name == "makefile" || name == "gnumakefile" {
        return Language::Shell;
    }
    if name == "dockerfile" || name.starts_with("dockerfile.") {
        return Language::Shell;
    }
    if name == "justfile" {
        return Language::Shell;
    }

    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "ts" | "tsx" | "mts" | "cts" => Language::TypeScript,
        "js" | "jsx" | "mjs" | "cjs" => Language::JavaScript,
        "rs" => Language::Rust,
        "py" | "pyi" => Language::Python,
        "go" => Language::Go,
        "java" => Language::Java,
        "c" | "h" => Language::C,
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => Language::Cpp,
        "json" | "jsonc" | "json5" => Language::Json,
        "yaml" | "yml" => Language::Yaml,
        "md" | "markdown" | "mdx" => Language::Markdown,
        "toml" => Language::Toml,
        "html" | "htm" | "xhtml" | "xml" | "svg" | "vue" | "svelte" => Language::Html,
        "css" | "scss" | "less" => Language::Css,
        "sh" | "bash" | "zsh" | "fish" | "command" => Language::Shell,
        _ => Language::Other,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Symbol {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub column: usize,
    pub container: Option<String>,
    pub exported: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct FileMeta {
    pub path: PathBuf,
    pub relative: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

pub(crate) struct Workspace {
    cache: Option<Cache>,
    index: IndexCache,
}

pub struct Cache {
    root: PathBuf,
    include_hidden: bool,
    built_at: Instant,
    files: Vec<FileMeta>,
    truncated: bool,
}

impl Default for Workspace {
    fn default() -> Self {
        Self::new()
    }
}

impl Workspace {
    pub(crate) fn new() -> Self {
        Workspace {
            cache: None,
            index: IndexCache::new(),
        }
    }

    pub(crate) fn invalidate(&mut self) {
        self.cache = None;
        self.index.invalidate();
    }

    pub(crate) fn files(&mut self, params: &Value) -> Result<Value, RpcError> {
        let root = root_param(params, "workspace.files")?;
        let include_hidden = params
            .get("include_hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let files = self.files_for(&root, include_hidden)?;
        let entries: Vec<Value> = files
            .iter()
            .map(|file| {
                json!({
                    "path": file.path.to_string_lossy(),
                    "relative": file.relative,
                    "bytes": file.size,
                    "modified_ms": file.modified_ms,
                })
            })
            .collect();
        Ok(json!({
            "root": root.to_string_lossy(),
            "files": entries,
            "truncated": self.cache.as_ref().map(|cache| cache.truncated).unwrap_or(false),
        }))
    }

    pub fn files_for(
        &mut self,
        root: &Path,
        include_hidden: bool,
    ) -> Result<Vec<FileMeta>, RpcError> {
        if let Some(cache) = &self.cache {
            if cache.root == root
                && cache.include_hidden == include_hidden
                && cache.built_at.elapsed() < CACHE_TTL
            {
                return Ok(cache.files.clone());
            }
        }
        let (files, truncated) = walk_files(root, include_hidden);
        self.cache = Some(Cache {
            root: root.to_path_buf(),
            include_hidden,
            built_at: Instant::now(),
            files: files.clone(),
            truncated,
        });
        Ok(files)
    }

    pub(crate) fn search(&self, params: &Value) -> Result<Value, RpcError> {
        let root = root_param(params, "workspace.search")?;
        let matcher = Matcher::from_params(params, "workspace.search")?;
        let include_hidden = params
            .get("include_hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let max_results = params
            .get("max_results")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(500)
            .clamp(1, MAX_SEARCH_RESULTS);

        let (files, _) = walk_files(&root, include_hidden);
        let mut matches = Vec::new();
        let mut files_searched = 0usize;
        let mut truncated = false;

        'files: for file in files {
            let Some(text) = read_searchable(&file.path) else {
                continue;
            };
            files_searched += 1;
            for (index, line) in text.lines().enumerate() {
                for found in matcher.find_matches(line) {
                    if !matcher.is_whole_word(line, found.0, found.1) {
                        continue;
                    }
                    let line_text = truncate_line(line);
                    matches.push(json!({
                        "path": file.path.to_string_lossy(),
                        "relative": file.relative,
                        "line": index + 1,
                        "column": line[..found.0].encode_utf16().count(),
                        "length": line[found.0..found.1].encode_utf16().count(),
                        "line_text": line_text,
                    }));
                    if matches.len() >= max_results {
                        truncated = true;
                        break 'files;
                    }
                }
            }
        }

        Ok(json!({
            "root": root.to_string_lossy(),
            "query": matcher.query(),
            "matches": matches,
            "files_searched": files_searched,
            "truncated": truncated,
        }))
    }

    pub(crate) fn replace(&mut self, params: &Value) -> Result<Value, RpcError> {
        let root = root_param(params, "workspace.replace")?;
        let matcher = Matcher::from_params(params, "workspace.replace")?;
        let replacement = params
            .get("replacement")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid_params("workspace.replace needs 'replacement' (text)"))?;
        let include_hidden = params
            .get("include_hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let (files, _) = walk_files(&root, include_hidden);
        let mut changed = Vec::new();
        let mut total = 0usize;
        let mut files_searched = 0usize;
        let mut failed = Vec::new();

        for file in files {
            let Some(text) = read_searchable(&file.path) else {
                continue;
            };
            files_searched += 1;
            let (next, count) = matcher.replace_all(&text, replacement);
            if count == 0 || next == text {
                continue;
            }
            match fsops::write_atomic(&file.path, next.as_bytes()) {
                Ok(()) => {
                    total += count;
                    changed.push(json!({
                        "path": file.path.to_string_lossy(),
                        "relative": file.relative,
                        "replacements": count,
                    }));
                }
                Err(error) => failed.push(json!({
                    "path": file.path.to_string_lossy(),
                    "relative": file.relative,
                    "error": error.to_string(),
                })),
            }
        }

        self.invalidate();
        Ok(json!({
            "root": root.to_string_lossy(),
            "changed": changed,
            "failed": failed,
            "total": total,
            "files_searched": files_searched,
        }))
    }

    pub(crate) fn definition(&mut self, params: &Value) -> Result<Value, RpcError> {
        self.index.definition(params)
    }

    pub(crate) fn references(&mut self, params: &Value) -> Result<Value, RpcError> {
        self.index.references(params)
    }

    pub(crate) fn symbols(&self, params: &Value) -> Result<Value, RpcError> {
        let path = fsops::path_param(params, "workspace.symbols")?;
        let text = match params.get("text").and_then(Value::as_str) {
            Some(text) => text.to_string(),
            None => {
                let answer = fsops::read(&json!({ "path": path }))?;
                answer["content"].as_str().unwrap_or("").to_string()
            }
        };
        let language = language_for_path(&path);
        let symbols = parse_symbols(language, &text);
        Ok(json!({
            "path": path.to_string_lossy(),
            "language": language.id(),
            "symbols": symbols.iter().map(|symbol| json!({
                "name": symbol.name,
                "kind": symbol.kind,
                "line": symbol.line,
                "column": symbol.column,
                "container": symbol.container,
                "exported": symbol.exported,
            })).collect::<Vec<Value>>(),
        }))
    }
}

mod roots;
mod matcher;
mod mask;
mod symbols;

pub use roots::*;
pub use matcher::*;
pub use mask::*;
pub use symbols::*;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
