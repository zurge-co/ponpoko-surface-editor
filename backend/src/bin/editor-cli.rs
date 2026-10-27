use std::io::Read;

use editor_backend::{Backend, METHODS, RpcError};
use serde_json::{json, Map, Value};

const USAGE: &str = "\
editor-cli — the editor surface's own command line

USAGE:
    editor-cli --list
    editor-cli --help
    editor-cli <method> [key=value ...]
    editor-cli <method> --json '<params object>'
    editor-cli <method> --json -        (params read from stdin)

EXAMPLES:
    editor-cli app.info
    editor-cli fs.read path=/some/file.txt
    editor-cli fs.list path=/some/folder
    editor-cli workspace.search root=/some/project query=needle
    echo '{\"path\":\"/tmp/a.txt\",\"content\":\"42\"}' | editor-cli fs.write --json -

Values given as key=value are taken as JSON when they parse as JSON
(true, false, null, numbers, objects, arrays) and as text otherwise.
The answer is JSON on stdout; exit 0 means the method answered.";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{USAGE}");
        return;
    }
    if args[0] == "--list" {
        for method in METHODS {
            println!("{method}");
        }
        return;
    }

    let (method, params) = match parse(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("editor-cli: {message}");
            eprintln!("editor-cli: run `editor-cli --help` for the shape");
            std::process::exit(2);
        }
    };

    let mut backend = Backend::new();
    match backend.handle(&method, &params) {
        Ok(result) => match serde_json::to_string_pretty(&result) {
            Ok(text) => println!("{text}"),
            Err(e) => {
                eprintln!("editor-cli: the answer could not be written: {e}");
                std::process::exit(1);
            }
        },
        Err(RpcError { code, message }) => {
            let refusal = json!({ "error": { "code": code, "message": message } });
            eprintln!("{refusal}");
            std::process::exit(1);
        }
    }
}

fn parse(args: &[String]) -> Result<(String, Value), String> {
    let method = args[0].trim();
    if method.is_empty() || method.starts_with('-') {
        return Err(format!("'{method}' is not a method name"));
    }

    let mut params = Map::new();
    let mut index = 1;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--json" {
            let source = args
                .get(index + 1)
                .ok_or_else(|| "--json needs a params object (or - for stdin)".to_string())?;
            let text = if source == "-" {
                let mut text = String::new();
                std::io::stdin()
                    .read_to_string(&mut text)
                    .map_err(|e| format!("stdin could not be read: {e}"))?;
                text
            } else {
                source.clone()
            };
            let value: Value = serde_json::from_str(&text)
                .map_err(|e| format!("--json '{source}' is not JSON: {e}"))?;
            let object = value
                .as_object()
                .ok_or_else(|| "--json takes a params OBJECT, not a bare value".to_string())?;
            for (key, value) in object {
                params.insert(key.clone(), value.clone());
            }
            index += 2;
            continue;
        }
        if arg.starts_with("--") {
            return Err(format!(
                "unknown option '{arg}' — this CLI passes params as key=value or --json"
            ));
        }
        let (key, value) = arg
            .split_once('=')
            .ok_or_else(|| format!("'{arg}' is not key=value"))?;
        let key = key.trim();
        if key.is_empty() {
            return Err(format!("'{arg}' has no param name"));
        }
        params.insert(key.to_string(), typed(value));
        index += 1;
    }

    Ok((method.to_string(), Value::Object(params)))
}

fn typed(value: &str) -> Value {
    match serde_json::from_str::<Value>(value) {
        Ok(json) => json,
        Err(_) => Value::String(value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn a_command_line_becomes_a_method_and_its_params() {
        let (method, params) = parse(&args("fs.read path=/tmp/a.txt")).expect("parsed");
        assert_eq!(method, "fs.read");
        assert_eq!(params["path"], "/tmp/a.txt");
    }

    #[test]
    fn values_that_spell_json_are_json_and_text_stays_text() {
        assert_eq!(typed("120"), json!(120));
        assert_eq!(typed("true"), json!(true));
        assert_eq!(typed("null"), Value::Null);
        assert_eq!(typed("a b"), json!("a b"));
        assert_eq!(typed("/tmp/120"), json!("/tmp/120"));
        assert_eq!(typed("\"5\""), json!("5"), "a quoted value stays a string");
    }

    #[test]
    fn json_params_carry_the_object_and_win_over_key_value() {
        let (_, params) =
            parse(&args(r#"workspace.search root=/tmp --json {"query":"a","root":"/b"}"#))
                .expect("parsed");
        assert_eq!(params["query"], "a");
        assert_eq!(params["root"], "/b", "--json is the exact shape asked for");
    }

    #[test]
    fn a_bad_command_line_is_a_sentence_not_a_panic() {
        assert!(parse(&args("--nope")).is_err());
        assert!(parse(&args("fs.read --color")).is_err());
        assert!(parse(&args("fs.read path")).is_err());
        assert!(parse(&args("fs.read --json")).is_err());
        assert!(parse(&args("fs.read --json [1,2]")).is_err());
        assert!(parse(&args("fs.read --json nope")).is_err());
    }

    #[test]
    fn the_cli_answers_from_the_same_table_the_backend_serves() {
        let mut backend = Backend::new();
        for method in METHODS {
            let refused = backend.handle(method, &json!({})).err();
            assert_ne!(
                refused.map(|error| error.code),
                Some(-32601),
                "{method} is in METHODS but the library does not dispatch it"
            );
        }
        assert_eq!(
            backend
                .handle("fs.nope", &json!({}))
                .map_err(|error| error.message),
            Err(format!(
                "'fs.nope' is not a method this backend has ({})",
                METHODS.join(" | ")
            ))
        );
    }
}
