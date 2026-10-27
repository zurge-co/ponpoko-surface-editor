use serde_json::json;

use super::*;


fn temp_project(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "ponpoko-editor-index-{tag}-{}-{nanos}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("src");
    root
}

fn write(root: &Path, relative: &str, text: &str) -> PathBuf {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("parent");
    }
    std::fs::write(&path, text).expect("write");
    path
}

fn definition(root: &Path, path: &Path, text: &str, line: usize, column: usize) -> Value {
    let mut cache = IndexCache::new();
    cache
        .definition(&json!({
            "root": root,
            "path": path,
            "text": text,
            "line": line,
            "column": column,
        }))
        .expect("definition")
}

fn names(answer: &Value) -> Vec<String> {
    answer["definitions"]
        .as_array()
        .expect("definitions")
        .iter()
        .map(|definition| {
            format!(
                "{}:{}:{}",
                definition["relative"].as_str().unwrap_or(""),
                definition["line"].as_u64().unwrap_or(0),
                definition["name"].as_str().unwrap_or("")
            )
        })
        .collect()
}

#[test]
fn a_relative_typescript_import_resolves_both_the_binding_and_its_use() {
    let root = temp_project("ts-relative");
    write(
        &root,
        "src/thing.ts",
        "export interface Named { name: string }\nexport function greet(name: string): string { return name; }\n",
    );
    let main = write(
        &root,
        "src/main.ts",
        "import { greet } from \"./thing\";\nconst hello = greet(\"world\");\n",
    );
    let text = std::fs::read_to_string(&main).expect("main");

    let answer = definition(&root, &main, &text, 2, 15);
    assert_eq!(answer["word"], "greet");
    assert_eq!(names(&answer), vec!["src/thing.ts:2:greet"]);

    let answer = definition(&root, &main, &text, 1, 10);
    assert_eq!(names(&answer), vec!["src/thing.ts:2:greet"]);
    assert!(answer["definitions"][0]["source"]
        .as_str()
        .unwrap_or("")
        .contains("import \"./thing\""));
}

#[test]
fn an_extensionless_import_can_resolve_an_index_file() {
    let root = temp_project("ts-index-file");
    write(
        &root,
        "src/util/index.ts",
        "export const helper = (value: number) => value + 1;\n",
    );
    let main = write(
        &root,
        "src/main.ts",
        "import { helper } from \"./util\";\nhelper(1);\n",
    );
    let text = std::fs::read_to_string(&main).expect("main");
    let answer = definition(&root, &main, &text, 1, 10);
    assert_eq!(names(&answer), vec!["src/util/index.ts:1:helper"]);
}

#[test]
fn tsconfig_base_url_and_paths_are_read_through_comments_and_trailing_commas() {
    let root = temp_project("tsconfig");
    write(
        &root,
        "tsconfig.json",
        r#"{
  // the project's own alias
  "compilerOptions": {
"baseUrl": ".",
"paths": {
  "@app/*": ["src/*"],
},
  },
}
"#,
    );
    write(
        &root,
        "src/widget.ts",
        "export function widget(): string { return \"w\"; }\n",
    );
    let main = write(
        &root,
        "src/deep/main.ts",
        "import { widget } from \"@app/widget\";\nwidget();\n",
    );
    let text = std::fs::read_to_string(&main).expect("main");
    let answer = definition(&root, &main, &text, 2, 1);
    assert_eq!(names(&answer), vec!["src/widget.ts:1:widget"]);
}

#[test]
fn default_and_namespace_imports_resolve_their_targets() {
    let root = temp_project("ts-default-namespace");
    write(
        &root,
        "src/model.ts",
        "export default class Model {\n  save(): void {}\n}\nexport function build(): Model { return new Model(); }\n",
    );
    let main = write(
        &root,
        "src/main.ts",
        "import Model from \"./model\";\nimport * as model from \"./model\";\nconst a = new Model();\nmodel.build();\n",
    );
    let text = std::fs::read_to_string(&main).expect("main");

    let answer = definition(&root, &main, &text, 1, 8);
    assert_eq!(names(&answer), vec!["src/model.ts:1:Model"]);

    let answer = definition(&root, &main, &text, 4, 7);
    assert_eq!(names(&answer), vec!["src/model.ts:4:build"]);

    let answer = definition(&root, &main, &text, 3, 17);
    assert_eq!(names(&answer), vec!["src/model.ts:1:Model"]);
}

#[test]
fn a_caller_that_already_extracted_the_word_still_gets_member_navigation() {
    let root = temp_project("word-supplied");
    write(
        &root,
        "src/model.ts",
        "export default class Model {\n  save(): void {}\n}\n",
    );
    let main = write(
        &root,
        "src/main.ts",
        "import Model from \"./model\";\nconst model = new Model();\nmodel.save();\n",
    );
    let text = std::fs::read_to_string(&main).expect("main");
    let mut cache = IndexCache::new();
    let answer = cache
        .definition(&json!({
            "root": root,
            "path": main,
            "text": text,
            "line": 3,
            "column": 7,
            "word": "save",
        }))
        .expect("definition");
    assert_eq!(names(&answer), vec!["src/model.ts:2:save"]);
}

#[test]
fn an_unknown_language_says_so_instead_of_pretending_to_navigate() {
    let root = temp_project("unknown");
    let file = write(&root, "notes.txt", "greet\n");
    let mut cache = IndexCache::new();
    let answer = cache
        .definition(&json!({
            "root": root,
            "path": file,
            "text": "greet\n",
            "line": 1,
            "column": 1,
        }))
        .expect("definition");
    assert_eq!(
        answer["definitions"].as_array().expect("definitions").len(),
        0
    );
    assert!(answer["notes"][0]
        .as_str()
        .unwrap_or("")
        .contains("TypeScript, JavaScript and Rust"));
}

#[test]
fn a_local_class_member_is_found_without_any_type_information() {
    let root = temp_project("ts-member");
    let main = write(
        &root,
        "src/main.ts",
        "class Point {\n  move(): void {}\n}\nconst point = new Point();\npoint.move();\n",
    );
    let text = std::fs::read_to_string(&main).expect("main");
    let answer = definition(&root, &main, &text, 5, 7);
    assert_eq!(names(&answer), vec!["src/main.ts:2:move"]);
}

#[test]
fn a_cursor_inside_an_import_specifier_opens_the_module() {
    let root = temp_project("ts-specifier");
    write(&root, "src/thing.ts", "export const one = 1;\n");
    let main = write(&root, "src/main.ts", "import { one } from \"./thing\";\n");
    let text = std::fs::read_to_string(&main).expect("main");
    let answer = definition(&root, &main, &text, 1, 24);
    assert_eq!(answer["definitions"][0]["relative"], "src/thing.ts");
    assert_eq!(answer["definitions"][0]["kind"], "module");
}

#[test]
fn rust_crate_super_self_and_mod_paths_resolve_to_files_and_items() {
    let root = temp_project("rust-paths");
    write(&root, "Cargo.toml", "[package]\nname = \"demo\"\n");
    write(&root, "src/lib.rs", "pub mod thing;\npub fn root_fn() {}\n");
    write(&root, "src/other.rs", "pub struct Other;\n");
    let thing = write(
        &root,
        "src/thing.rs",
        "use super::root_fn;\nuse crate::other::Other;\npub struct Widget;\nimpl Widget {\n    pub fn new() -> Self { Self }\n}\nfn local() { root_fn(); Other; let w = Widget::new(); w.new(); }\n",
    );
    let text = std::fs::read_to_string(&thing).expect("thing");

    let answer = definition(&root, &thing, &text, 1, 13);
    assert_eq!(names(&answer), vec!["src/lib.rs:2:root_fn"]);

    let answer = definition(&root, &thing, &text, 2, 19);
    assert_eq!(names(&answer), vec!["src/other.rs:1:Other"]);

    let lib = root.join("src/lib.rs");
    let lib_text = std::fs::read_to_string(&lib).expect("lib");
    let answer = definition(&root, &lib, &lib_text, 1, 9);
    assert_eq!(answer["definitions"][0]["relative"], "src/thing.rs");

    let answer = definition(&root, &thing, &text, 7, 48);
    assert_eq!(names(&answer), vec!["src/thing.rs:5:new"]);
}

#[test]
fn rust_self_paths_resolve_within_the_current_module() {
    let root = temp_project("rust-self");
    write(&root, "Cargo.toml", "[package]\nname = \"demo\"\n");
    write(&root, "src/lib.rs", "pub mod thing;\n");
    let thing = write(
        &root,
        "src/thing.rs",
        "pub fn helper() {}\nuse self::helper;\nfn local() { helper(); }\n",
    );
    let text = std::fs::read_to_string(&thing).expect("thing");
    let answer = definition(&root, &thing, &text, 2, 14);
    assert_eq!(names(&answer), vec!["src/thing.rs:1:helper"]);
}

#[test]
fn rust_use_braces_aliases_and_self_are_understood() {
    let root = temp_project("rust-braces");
    write(&root, "Cargo.toml", "[package]\nname = \"demo\"\n");
    write(
        &root,
        "src/lib.rs",
        "pub mod thing;\npub fn helper() {}\npub struct Other;\n",
    );
    let thing = write(
        &root,
        "src/thing.rs",
        "use crate::{helper as h, Other};\nfn local() { h(); let o = Other; }\n",
    );
    let text = std::fs::read_to_string(&thing).expect("thing");

    let answer = definition(&root, &thing, &text, 2, 14);
    assert_eq!(names(&answer), vec!["src/lib.rs:2:helper"]);

    let answer = definition(&root, &thing, &text, 2, 27);
    assert_eq!(names(&answer), vec!["src/lib.rs:3:Other"]);
}

#[test]
fn references_count_code_occurrences_and_skip_comments_and_strings() {
    let root = temp_project("references");
    write(
        &root,
        "src/a.ts",
        "export function greet() {}\n// greet is mentioned in a comment\ngreet();\nconst text = \"greet\";\n",
    );
    write(
        &root,
        "src/b.ts",
        "import { greet } from \"./a\";\ngreet();\n",
    );
    let a = root.join("src/a.ts");
    let text = std::fs::read_to_string(&a).expect("a");
    let mut cache = IndexCache::new();
    let answer = cache
        .references(&json!({
            "root": root,
            "path": a,
            "text": text,
            "line": 1,
            "column": 17,
        }))
        .expect("references");
    assert_eq!(answer["word"], "greet");
    let found: Vec<String> = answer["references"]
        .as_array()
        .expect("references")
        .iter()
        .map(|reference| {
            format!(
                "{}:{}:{}",
                reference["relative"].as_str().unwrap_or(""),
                reference["line"].as_u64().unwrap_or(0),
                reference["column"].as_u64().unwrap_or(0)
            )
        })
        .collect();
    assert!(found.contains(&"src/a.ts:1:17".to_string()), "{found:?}");
    assert!(found.contains(&"src/a.ts:3:1".to_string()), "{found:?}");
    assert!(found.contains(&"src/b.ts:1:10".to_string()), "{found:?}");
    assert!(found.contains(&"src/b.ts:2:1".to_string()), "{found:?}");
    assert!(
        !found.iter().any(|hit| hit.starts_with("src/a.ts:2:")),
        "{found:?}"
    );
    assert!(
        !found.iter().any(|hit| hit.starts_with("src/a.ts:4:")),
        "{found:?}"
    );
    let definition = answer["references"]
        .as_array()
        .expect("references")
        .iter()
        .find(|reference| reference["line"] == 1)
        .expect("declaration");
    assert_eq!(definition["kind"], "definition");
}

#[test]
fn an_unsaved_buffer_is_what_gets_indexed_for_the_open_file() {
    let root = temp_project("unsaved");
    write(&root, "src/thing.ts", "export function saved(): void {}\n");
    let main = write(
        &root,
        "src/main.ts",
        "import { saved } from \"./thing\";\nsaved();\n",
    );
    let text = "import { saved } from \"./thing\";\nconst local = 1;\nlocal;\n";
    let answer = definition(&root, &main, text, 3, 1);
    assert_eq!(names(&answer), vec!["src/main.ts:2:local"]);
}

#[test]
fn words_and_paths_are_read_without_guessing() {
    let text = "const greeting = greet(\"user\");\n";
    assert_eq!(word_at(text, 1, 7).expect("greeting").word, "greeting");
    assert_eq!(word_at(text, 1, 18).expect("greet").word, "greet");
    assert_eq!(word_at(text, 1, 15).expect("end of word").word, "greeting");
    assert!(word_at("()", 1, 1).is_none());
    assert!(word_at("const x = 1;", 9, 1).is_none());

    let context = path_context(
        "  const value = service.users.find();",
        1,
        26,
        Language::TypeScript,
    )
    .expect("context");
    assert_eq!(context.segments, vec!["service", "users", "find"]);
    assert_eq!(context.index, 1);

    let context =
        path_context("use crate::other::Other;", 1, 19, Language::Rust).expect("rust context");
    assert_eq!(context.segments, vec!["crate", "other", "Other"]);
    assert_eq!(context.index, 2);
}

#[test]
fn tsconfig_without_the_file_is_no_config_and_jsonc_survives_strings() {
    assert_eq!(
        strip_jsonc(
            "{\n // comment\n \"url\": \"http://example.com//x\",\n \"list\": [1, 2,],\n}"
        ),
        "{\n \n \"url\": \"http://example.com//x\",\n \"list\": [1, 2]\n}"
    );
    assert!(discover_ts_config(
        Path::new("/definitely/not/a/file.ts"),
        Path::new("/definitely")
    )
    .is_none());

}
