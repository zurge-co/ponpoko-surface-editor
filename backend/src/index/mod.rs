use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use serde_json::Value;
use crate::fsops;
use crate::workspace::{language_for_path, parse_symbols, walk_files, Language};
use crate::RpcError;




pub const MAX_INDEX_FILES: usize = 20_000;
pub const MAX_INDEX_FILE_BYTES: u64 = 1_500_000;
pub const MAX_REFERENCES: usize = 500;
pub const MAX_DEFINITIONS: usize = 50;
pub const MAX_EXCERPT: usize = 240;
pub const INDEX_TTL: Duration = Duration::from_secs(10);

pub const TS_EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Declaration {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub column: usize,
    pub exported: bool,
    pub container: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportKind {
    Named,
    Default,
    Namespace,
}

#[derive(Clone, Debug)]
pub struct ImportBinding {
    pub local: String,
    pub imported: String,
    pub kind: ImportKind,
    pub specifier: String,
}

#[derive(Clone, Debug)]
pub struct UsePath {
    pub segments: Vec<String>,
    pub local: String,
}

pub struct IndexedFile {
    pub path: PathBuf,
    pub relative: String,
    pub language: Language,
    pub declarations: Vec<Declaration>,
    pub imports: Vec<ImportBinding>,
    pub rust_mods: Vec<(String, usize)>,
    pub rust_uses: Vec<UsePath>,
}

impl IndexedFile {
    pub fn parse(path: PathBuf, relative: String, language: Language, text: String) -> Self {
        let declarations = parse_symbols(language, &text)
            .into_iter()
            .map(|symbol| Declaration {
                name: symbol.name,
                kind: symbol.kind,
                line: symbol.line,
                column: symbol.column + 1,
                exported: symbol.exported,
                container: symbol.container,
            })
            .collect();
        let imports = match language {
            Language::TypeScript | Language::JavaScript => scan_ts_imports(&text),
            _ => Vec::new(),
        };
        let rust_mods = if language == Language::Rust {
            scan_rust_mods(&text)
        } else {
            Vec::new()
        };
        let rust_uses = if language == Language::Rust {
            scan_rust_uses(&text)
        } else {
            Vec::new()
        };
        IndexedFile {
            path,
            relative,
            language,
            declarations,
            imports,
            rust_mods,
            rust_uses,
        }
    }
}

pub struct Index {
    pub root: PathBuf,
    pub built_at: Instant,
    pub files: Vec<IndexedFile>,
    pub by_path: HashMap<String, usize>,
}

impl Index {
    pub fn build(root: &Path) -> Index {
        let (files, _) = walk_files(root, false);
        let mut indexed = Vec::new();
        for meta in files {
            if indexed.len() >= MAX_INDEX_FILES {
                break;
            }
            let language = language_for_path(&meta.path);
            if !is_indexed_language(language) || meta.size > MAX_INDEX_FILE_BYTES {
                continue;
            }
            let Some(text) = read_code(&meta.path) else {
                continue;
            };
            indexed.push(IndexedFile::parse(meta.path, meta.relative, language, text));
        }
        let mut by_path = HashMap::new();
        for (position, file) in indexed.iter().enumerate() {
            by_path.insert(path_key(&file.path), position);
        }
        Index {
            root: root.to_path_buf(),
            built_at: Instant::now(),
            files: indexed,
            by_path,
        }
    }

    pub fn file(&self, path: &Path) -> Option<&IndexedFile> {
        self.by_path
            .get(&path_key(path))
            .and_then(|position| self.files.get(*position))
    }
}

pub(crate) struct IndexCache {
    current: Option<Index>,
}

impl IndexCache {
    pub(crate) fn new() -> Self {
        IndexCache { current: None }
    }

    pub(crate) fn invalidate(&mut self) {
        self.current = None;
    }

    pub fn index_for(&mut self, root: &Path) -> &Index {
        let stale = match &self.current {
            Some(index) => index.root != root || index.built_at.elapsed() >= INDEX_TTL,
            None => true,
        };
        if stale {
            self.current = Some(Index::build(root));
        }
        self.current.as_ref().expect("an index was just built")
    }

    pub(crate) fn definition(&mut self, params: &Value) -> Result<Value, RpcError> {
        let path = fsops::path_param(params, "workspace.definition")?;
        let root = root_for(params, &path);
        let index = self.index_for(&root);
        definition_answer(index, &root, &path, params)
    }

    pub(crate) fn references(&mut self, params: &Value) -> Result<Value, RpcError> {
        let path = fsops::path_param(params, "workspace.references")?;
        let root = root_for(params, &path);
        let index = self.index_for(&root);
        references_answer(index, &root, &path, params)
    }
}

mod scan;
mod ts_imports;
mod tsconfig;
mod rust_scan;
mod defs;
mod js;
mod rust_defs;
mod references;

pub use scan::*;
pub use ts_imports::*;
pub use tsconfig::*;
pub use rust_scan::*;
pub use defs::*;
pub use js::*;
pub use rust_defs::*;
pub use references::*;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
