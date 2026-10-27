use serde_json::json;

use super::*;


fn temp_project(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "ponpoko-editor-workspace-{tag}-{}-{nanos}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("src");
    std::fs::create_dir_all(root.join("node_modules")).expect("node_modules");
    root
}

#[test]
fn a_workspace_walk_skips_dependencies_and_respects_gitignore() {
    let root = temp_project("walk");
    std::fs::write(root.join("src/a.ts"), "export const a = 1;\n").expect("a");
    std::fs::write(root.join("README.md"), "# readme\n").expect("readme");
    std::fs::write(root.join("node_modules/x.js"), "module.exports = 1;\n").expect("dep");
    std::fs::write(root.join("ignored.txt"), "not source\n").expect("ignored");
    std::fs::write(root.join(".gitignore"), "ignored.txt\n").expect("gitignore");

    let (files, truncated) = walk_files(&root, false);
    let relative: Vec<&str> = files.iter().map(|file| file.relative.as_str()).collect();
    assert!(!truncated);
    assert!(relative.contains(&"src/a.ts"), "{relative:?}");
    assert!(relative.contains(&"README.md"), "{relative:?}");
    assert!(!relative.contains(&"node_modules/x.js"), "{relative:?}");
    assert!(!relative.contains(&"ignored.txt"), "{relative:?}");
}

#[test]
fn workspace_files_returns_paths_and_can_include_hidden_files() {
    let root = temp_project("files");
    std::fs::write(root.join("src/a.ts"), "a\n").expect("a");
    std::fs::write(root.join(".env"), "A=1\n").expect("env");
    let mut workspace = Workspace::new();

    let answer = workspace
        .files(&json!({ "root": root }))
        .expect("files");
    let relatives: Vec<&str> = answer["files"]
        .as_array()
        .expect("files")
        .iter()
        .map(|file| file["relative"].as_str().expect("relative"))
        .collect();
    assert!(relatives.contains(&"src/a.ts"));
    assert!(!relatives.contains(&".env"));

    let answer = workspace
        .files(&json!({ "root": root, "include_hidden": true }))
        .expect("hidden files");
    let relatives: Vec<&str> = answer["files"]
        .as_array()
        .expect("files")
        .iter()
        .map(|file| file["relative"].as_str().expect("relative"))
        .collect();
    assert!(relatives.contains(&".env"), "{relatives:?}");
}

#[test]
fn search_reports_lines_columns_and_whole_word_matches() {
    let root = temp_project("search");
    std::fs::write(
        root.join("src/a.ts"),
        "export function greet() {}\nconst greeting = 'hello';\ngreet();\n",
    )
    .expect("a");
    std::fs::write(root.join("src/b.md"), "hello world\nHELLO there\n").expect("b");
    let workspace = Workspace::new();

    let answer = workspace
        .search(&json!({ "root": root, "query": "greet", "whole_word": true }))
        .expect("search");
    let matches = answer["matches"].as_array().expect("matches");
    assert!(matches.iter().any(|m| m["relative"] == "src/a.ts" && m["line"] == 1));
    assert!(matches.iter().any(|m| m["relative"] == "src/a.ts" && m["line"] == 3));
    assert!(!matches.iter().any(|m| m["line_text"].as_str() == Some("const greeting = 'hello';")));

    let answer = workspace
        .search(&json!({ "root": root, "query": "hello", "case_sensitive": false }))
        .expect("case insensitive");
    let lines: Vec<u64> = answer["matches"]
        .as_array()
        .expect("matches")
        .iter()
        .filter(|m| m["relative"] == "src/b.md")
        .map(|m| m["line"].as_u64().expect("line"))
        .collect();
    assert_eq!(lines, vec![1, 2]);

    let answer = workspace
        .search(&json!({ "root": root, "query": "gr[a-z]+", "regex": true }))
        .expect("regex");
    assert!(answer["matches"].as_array().expect("matches").len() >= 2);

    let error = workspace
        .search(&json!({ "root": root, "query": "(", "regex": true }))
        .expect_err("invalid regex");
    assert!(error.message.contains("not valid"), "{}", error.message);
}

#[test]
fn replace_changes_only_matching_files_and_preserves_line_endings() {
    let root = temp_project("replace");
    let a = root.join("src/a.ts");
    std::fs::write(&a, "const foo = 1;\r\nconst foobar = 2;\r\n").expect("a");
    let b = root.join("src/b.ts");
    std::fs::write(&b, "const bar = 3;\n").expect("b");
    let mut workspace = Workspace::new();

    let answer = workspace
        .replace(&json!({
            "root": root,
            "query": "foo",
            "replacement": "baz",
            "whole_word": true,
        }))
        .expect("replace");
    assert_eq!(answer["total"], 1);
    let changed = answer["changed"].as_array().expect("changed");
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0]["relative"], "src/a.ts");
    assert_eq!(changed[0]["replacements"], 1);
    assert_eq!(
        std::fs::read_to_string(&a).expect("a"),
        "const baz = 1;\r\nconst foobar = 2;\r\n"
    );
    assert_eq!(std::fs::read_to_string(&b).expect("b"), "const bar = 3;\n");

    let answer = workspace
        .replace(&json!({
            "root": root,
            "query": "const (\\w+) =",
            "replacement": "let $1 =",
            "regex": true,
        }))
        .expect("regex replace");
    assert_eq!(answer["total"], 3);
    assert_eq!(
        std::fs::read_to_string(&a).expect("a"),
        "let baz = 1;\r\nlet foobar = 2;\r\n"
    );
    assert_eq!(
        std::fs::read_to_string(&b).expect("b"),
        "let bar = 3;\n"
    );
}

#[test]
fn typescript_symbols_include_exports_classes_and_methods() {
    let text = r#"
import { Thing } from "./thing";

export interface Named { name: string }

export class Person implements Named {
  name: string;
  constructor(name: string) { this.name = name; }
  greet(): string { return this.name; }
}

export async function load(): Promise<void> {}
const local = 1;
// function hiddenInComment() {}
const text = "class HiddenInString {}";
"#;
    let symbols = parse_symbols(Language::TypeScript, text);
    let names: Vec<&str> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
    assert!(names.contains(&"Named"), "{names:?}");
    assert!(names.contains(&"Person"), "{names:?}");
    assert!(names.contains(&"constructor"), "{names:?}");
    assert!(names.contains(&"greet"), "{names:?}");
    assert!(names.contains(&"load"), "{names:?}");
    assert!(names.contains(&"local"), "{names:?}");
    assert!(!names.contains(&"hiddenInComment"), "{names:?}");
    assert!(!names.contains(&"HiddenInString"), "{names:?}");

    let person = symbols.iter().find(|symbol| symbol.name == "Person").expect("Person");
    assert!(person.exported);
    let constructor = symbols
        .iter()
        .find(|symbol| symbol.name == "constructor")
        .expect("constructor");
    assert_eq!(constructor.container.as_deref(), Some("Person"));
}

#[test]
fn rust_symbols_include_impl_methods_and_macros() {
    let text = r##"
use std::fmt;

pub struct Point { x: i32, y: i32 }

impl Point {
pub fn new(x: i32, y: i32) -> Self { Self { x, y } }
fn hidden(&self) {}
}

pub enum Shape { Circle(f64) }
pub trait Draw { fn draw(&self); }
macro_rules! make_point { () => {} }
// fn commented_out() {}
const RAW: &str = r#"fn inside_raw() {}"#;
"##;
    let symbols = parse_symbols(Language::Rust, text);
    let names: Vec<&str> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
    assert!(names.contains(&"Point"), "{names:?}");
    assert!(names.contains(&"new"), "{names:?}");
    assert!(names.contains(&"hidden"), "{names:?}");
    assert!(names.contains(&"Shape"), "{names:?}");
    assert!(names.contains(&"Draw"), "{names:?}");
    assert!(names.contains(&"make_point"), "{names:?}");
    assert!(!names.contains(&"commented_out"), "{names:?}");
    assert!(!names.contains(&"inside_raw"), "{names:?}");
    let new = symbols.iter().find(|symbol| symbol.name == "new").expect("new");
    assert_eq!(new.container.as_deref(), Some("Point"));
    assert!(new.exported);
}

#[test]
fn markdown_json_yaml_and_toml_have_useful_outline_entries() {
    let markdown = parse_symbols(Language::Markdown, "# Title\n\ntext\n\n## Section\n");
    assert_eq!(markdown[0].name, "Title");
    assert_eq!(markdown[1].name, "Section");

    let json = parse_symbols(Language::Json, "{\n  \"name\": \"ponpoko\",\n  \"nested\": {}\n}\n");
    assert!(json.iter().any(|symbol| symbol.name == "name"));
    assert!(json.iter().any(|symbol| symbol.name == "nested"));

    let yaml = parse_symbols(Language::Yaml, "name: ponpoko\nversion: 1\n");
    assert!(yaml.iter().any(|symbol| symbol.name == "name"));
    assert!(yaml.iter().any(|symbol| symbol.name == "version"));

    let toml = parse_symbols(
        Language::Toml,
        "[package]\nname = \"ponpoko\"\n\n[dependencies]\nserde = \"1\"\n",
    );
    assert!(toml.iter().any(|symbol| symbol.name == "package"));
    assert!(toml.iter().any(|symbol| symbol.name == "dependencies"));
}

#[test]
fn symbols_method_reads_a_file_and_reports_its_language() {
    let root = temp_project("symbols");
    let file = root.join("src/main.rs");
    std::fs::write(&file, "pub fn main() {}\n").expect("file");
    let workspace = Workspace::new();
    let answer = workspace
        .symbols(&json!({ "path": file }))
        .expect("symbols");
    assert_eq!(answer["language"], "rust");
    assert_eq!(answer["symbols"][0]["name"], "main");
}
