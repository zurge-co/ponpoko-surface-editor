use serde_json::json;

use super::*;


fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "ponpoko-editor-fsops-{tag}-{}-{nanos}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn a_file_written_through_the_backend_reads_back_byte_for_byte() {
    let dir = temp_dir("roundtrip");
    let file = dir.join("note.md");
    let text = "# หัวข้อ\n\nสวัสดีครับ\nwith a trailing newline\n";
    let answer = write(&json!({ "path": file, "content": text })).expect("write");
    assert_eq!(answer["bytes"], text.len() as u64);
    assert_eq!(
        std::fs::read_to_string(&file).expect("the file exists"),
        text
    );

    let answer = read(&json!({ "path": file })).expect("read");
    assert_eq!(answer["content"], text);
    assert_eq!(answer["bytes"], text.len() as u64);
    assert!(answer["modified_ms"].as_u64().unwrap_or(0) > 0);

    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .expect("dir")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "temporary files left behind: {leftovers:?}"
    );
}

#[test]
fn what_is_not_text_is_refused_with_a_sentence_that_names_the_file() {
    let dir = temp_dir("nonttext");
    let binary = dir.join("image.bin");
    std::fs::write(&binary, [0xff, 0x00, 0xfe, 0x01]).expect("binary");
    let error = read(&json!({ "path": binary })).expect_err("binary is not text");
    assert_eq!(error.code, -32602);
    assert!(error.message.contains("image.bin"), "{}", error.message);
    assert!(
        error.message.contains("NUL") || error.message.contains("UTF-8"),
        "{}",
        error.message
    );

    let invalid = dir.join("latin1.txt");
    std::fs::write(&invalid, [0x68, 0x69, 0x20, 0xe9, 0x21]).expect("latin-1 bytes");
    let error = read(&json!({ "path": invalid })).expect_err("latin-1 is not UTF-8");
    assert_eq!(error.code, -32602);
    assert!(error.message.contains("UTF-8"), "{}", error.message);
}

#[test]
fn a_file_larger_than_the_editor_withholds_is_refused_before_it_is_read() {
    let dir = temp_dir("huge");
    let file = dir.join("huge.txt");
    let handle = std::fs::File::create(&file).expect("create");
    handle.set_len(MAX_TEXT_BYTES + 1).expect("sparse file");
    let error = read(&json!({ "path": file })).expect_err("too large");
    assert_eq!(error.code, -32602);
    assert!(error.message.contains("limit"));
}

#[test]
fn listing_sorts_folders_first_and_can_hide_dotfiles() {
    let dir = temp_dir("list");
    std::fs::create_dir(dir.join("src")).expect("dir");
    std::fs::create_dir(dir.join(".hidden-dir")).expect("dir");
    std::fs::write(dir.join("z.txt"), "z").expect("file");
    std::fs::write(dir.join("A.txt"), "a").expect("file");
    std::fs::write(dir.join(".env"), "secret").expect("file");

    let all = list(&json!({ "path": dir, "show_hidden": true })).expect("list");
    let names: Vec<&str> = all["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .map(|entry| entry["name"].as_str().expect("name"))
        .collect();
    assert_eq!(names, vec![".hidden-dir", "src", ".env", "A.txt", "z.txt"]);

    let visible = list(&json!({ "path": dir })).expect("list");
    let names: Vec<&str> = visible["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .map(|entry| entry["name"].as_str().expect("name"))
        .collect();
    assert_eq!(names, vec!["src", "A.txt", "z.txt"]);
    assert_eq!(
        all["parent"],
        dir.parent().expect("parent").to_string_lossy().as_ref()
    );
}

#[test]
fn creating_renaming_and_deleting_are_real_filesystem_operations() {
    let dir = temp_dir("mutate");
    let file = dir.join("a.txt");
    let created =
        create(&json!({ "path": file, "kind": "file", "content": "hello" })).expect("create");
    assert_eq!(created["bytes"], 5);
    assert_eq!(std::fs::read_to_string(&file).expect("file"), "hello");

    let folder = dir.join("nested");
    create(&json!({ "path": folder, "kind": "directory" })).expect("mkdir");
    assert!(folder.is_dir());

    let renamed = dir.join("nested").join("b.txt");
    let answer = rename(&json!({ "path": file, "to": renamed })).expect("rename");
    assert_eq!(answer["to"], renamed.to_string_lossy().as_ref());
    assert!(!file.exists());
    assert_eq!(std::fs::read_to_string(&renamed).expect("file"), "hello");

    let duplicate =
        create(&json!({ "path": dir.join("c.txt"), "kind": "file" })).expect("create");
    assert!(duplicate["exists"].as_bool().unwrap_or(false));
    let error =
        rename(&json!({ "path": renamed, "to": dir.join("c.txt") })).expect_err("no overwrite");
    assert!(
        error.message.contains("already exists"),
        "{}",
        error.message
    );

    delete(&json!({ "path": dir.join("c.txt") })).expect("delete file");
    assert!(!dir.join("c.txt").exists());
    let error = delete(&json!({ "path": folder })).expect_err("non-empty folder");
    assert!(error.message.contains("not empty"), "{}", error.message);
    delete(&json!({ "path": folder, "recursive": true })).expect("recursive delete");
    assert!(!folder.exists());
}

#[test]
fn an_asset_is_base64_with_a_mime_type_and_a_size_limit() {
    let dir = temp_dir("asset");
    let image = dir.join("pixel.png");
    let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
    std::fs::write(&image, bytes).expect("image");
    let answer = read_asset(&json!({ "path": image })).expect("asset");
    assert_eq!(answer["mime"], "image/png");
    assert_eq!(answer["bytes"], bytes.len() as u64);
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(answer["base64"].as_str().expect("base64"))
        .expect("decodes");
    assert_eq!(decoded, bytes);

    let huge = dir.join("huge.bin");
    let handle = std::fs::File::create(&huge).expect("create");
    handle.set_len(MAX_ASSET_BYTES + 1).expect("sparse");
    let error = read_asset(&json!({ "path": huge })).expect_err("too large");
    assert!(error.message.contains("preview limit"), "{}", error.message);
}

#[test]
fn stat_answers_for_a_file_a_folder_and_a_path_that_is_not_there() {
    let dir = temp_dir("stat");
    let file = dir.join("a.txt");
    std::fs::write(&file, "hello").expect("write");

    let answer = stat(&json!({ "path": file })).expect("stat file");
    assert_eq!(answer["exists"], true);
    assert_eq!(answer["is_file"], true);
    assert_eq!(answer["bytes"], 5);
    assert!(answer["modified_ms"].as_u64().expect("a timestamp") > 0);

    let answer = stat(&json!({ "path": dir })).expect("stat dir");
    assert_eq!(answer["exists"], true);
    assert_eq!(answer["is_dir"], true);

    let answer = stat(&json!({ "path": dir.join("absent") })).expect("stat absent");
    assert_eq!(answer["exists"], false);
    assert_eq!(answer["modified_ms"], Value::Null);
}

#[test]
fn reveal_commands_are_platform_shaped_without_spawning_anything() {
    let path = Path::new("/tmp/work/notes.md");
    let (program, args) = reveal_command(path, "macos");
    assert_eq!(program, "open");
    assert_eq!(args, vec!["-R", "/tmp/work/notes.md"]);

    let (program, args) = reveal_command(path, "windows");
    assert_eq!(program, "explorer");
    assert_eq!(args, vec!["/select,/tmp/work/notes.md"]);

    let (program, args) = reveal_command(path, "linux");
    assert_eq!(program, "xdg-open");
    assert_eq!(args, vec!["/tmp/work"]);
}

#[test]
fn rustfmt_formats_when_the_toolchain_is_there_and_says_so_when_it_is_not() {
    let source = "fn main(){println!(\"hi\");}";
    match format_rustfmt(&json!({ "content": source })) {
        Ok(answer) => {
            let formatted = answer["content"].as_str().expect("content");
            assert!(formatted.contains("fn main()"), "{formatted}");
            assert!(formatted.contains("println!"), "{formatted}");
        }
        Err(error) => {
            assert!(
                error.message.contains("rustfmt") && error.message.contains("PATH"),
                "a missing formatter must be actionable: {}",
                error.message
            );
        }
    }
}

#[test]
fn taplo_formats_toml_without_a_network_or_a_binary() {
    let source = "[package]\nname=\"Ponpoko\"\nversion = \"1.0.0\"\n";
    let answer = format_toml(&json!({ "content": source })).expect("toml");
    let formatted = answer["content"].as_str().expect("content");
    assert!(formatted.contains("name = \"Ponpoko\""), "{formatted}");
    assert!(formatted.ends_with('\n'), "{formatted:?}");
}
