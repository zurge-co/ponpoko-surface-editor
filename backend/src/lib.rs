use serde_json::{json, Value};

mod fsops;
mod index;
mod workspace;

use workspace::Workspace;

pub const METHODS: [&str; 19] = [
    "fs.read",
    "fs.write",
    "fs.stat",
    "fs.list",
    "fs.read_asset",
    "fs.create",
    "fs.rename",
    "fs.delete",
    "fs.reveal",
    "workspace.files",
    "workspace.search",
    "workspace.replace",
    "workspace.symbols",
    "workspace.definition",
    "workspace.references",
    "fmt.rustfmt",
    "fmt.toml",
    "app.ping",
    "app.info",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    pub fn method_not_found(method: &str) -> Self {
        RpcError {
            code: -32601,
            message: format!(
                "'{method}' is not a method this backend has ({})",
                METHODS.join(" | ")
            ),
        }
    }
}

pub(crate) fn invalid_params(message: impl Into<String>) -> RpcError {
    RpcError {
        code: -32602,
        message: message.into(),
    }
}

pub(crate) fn internal(message: impl Into<String>) -> RpcError {
    RpcError {
        code: -32603,
        message: message.into(),
    }
}

pub struct Backend {
    workspace: Workspace,
}

impl Default for Backend {
    fn default() -> Self {
        Self::new()
    }
}

impl Backend {
    pub fn new() -> Self {
        Backend {
            workspace: Workspace::new(),
        }
    }

    pub fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "app.ping" => Ok(json!({ "ok": true, "pid": std::process::id() })),
            "app.info" => Ok(fsops::app_info()),

            "fs.read" => fsops::read(params),
            "fs.stat" => fsops::stat(params),
            "fs.list" => fsops::list(params),
            "fs.read_asset" => fsops::read_asset(params),
            "fs.write" => {
                let answer = fsops::write(params)?;
                self.workspace.invalidate();
                Ok(answer)
            }
            "fs.create" => {
                let answer = fsops::create(params)?;
                self.workspace.invalidate();
                Ok(answer)
            }
            "fs.rename" => {
                let answer = fsops::rename(params)?;
                self.workspace.invalidate();
                Ok(answer)
            }
            "fs.delete" => {
                let answer = fsops::delete(params)?;
                self.workspace.invalidate();
                Ok(answer)
            }
            "fs.reveal" => fsops::reveal(params),

            "workspace.files" => self.workspace.files(params),
            "workspace.search" => self.workspace.search(params),
            "workspace.replace" => self.workspace.replace(params),
            "workspace.symbols" => self.workspace.symbols(params),
            "workspace.definition" => self.workspace.definition(params),
            "workspace.references" => self.workspace.references(params),

            "fmt.rustfmt" => fsops::format_rustfmt(params),
            "fmt.toml" => fsops::format_toml(params),

            other => Err(RpcError::method_not_found(other)),
        }
    }
}

pub fn respond(backend: &mut Backend, line: &str) -> Option<String> {
    if line.trim().is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(e) => {
            return Some(error_frame(
                Value::Null,
                -32700,
                format!("the request line is not JSON: {e}"),
            ))
        }
    };
    let Some(object) = value.as_object() else {
        return Some(error_frame(
            Value::Null,
            -32600,
            "a JSON-RPC request is an object".to_string(),
        ));
    };
    let params = object.get("params").cloned().unwrap_or(Value::Null);
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    let Some(id) = object.get("id").cloned() else {
        return None;
    };
    if method.is_empty() {
        return Some(error_frame(
            id,
            -32600,
            "the request names no method".to_string(),
        ));
    }

    Some(match backend.handle(&method, &params) {
        Ok(result) => result_frame(id, result),
        Err(error) => error_frame(id, error.code, error.message),
    })
}

fn result_frame(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

fn error_frame(id: Value, code: i64, message: String) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ponpoko-editor-rpc-{tag}-{}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn exchange(line: &str) -> Value {
        let mut backend = Backend::new();
        let response = respond(&mut backend, line).expect("a request gets an answer");
        serde_json::from_str(&response).expect("the answer is JSON")
    }

    fn exchange_with(backend: &mut Backend, line: &str) -> Value {
        let response = respond(backend, line).expect("a request gets an answer");
        serde_json::from_str(&response).expect("the answer is JSON")
    }

    #[test]
    fn a_request_is_answered_with_its_own_id_and_a_result_or_an_error() {
        let answer = exchange(r#"{"jsonrpc":"2.0","id":7,"method":"app.ping","params":{}}"#);
        assert_eq!(answer["jsonrpc"], "2.0");
        assert_eq!(answer["id"], 7);
        assert_eq!(answer["result"]["ok"], true);
        assert!(answer["result"]["pid"].as_u64().unwrap_or(0) > 0);
        assert!(answer.get("error").is_none());

        let answer = exchange(r#"{"jsonrpc":"2.0","id":8,"method":"fs.nope"}"#);
        assert_eq!(answer["id"], 8);
        assert_eq!(answer["error"]["code"], -32601);
        assert!(answer["error"]["message"]
            .as_str()
            .expect("a message")
            .contains("workspace.search"));
    }

    #[test]
    fn a_notification_is_not_answered_and_a_broken_line_is() {
        assert!(respond(&mut Backend::new(), r#"{"jsonrpc":"2.0","method":"fs.read","params":{}}"#).is_none());
        assert!(respond(&mut Backend::new(), "   ").is_none());
        let answer = exchange("this is not json");
        assert_eq!(answer["id"], Value::Null);
        assert_eq!(answer["error"]["code"], -32700);
        let answer = exchange("[]");
        assert_eq!(answer["error"]["code"], -32600);
        let answer = exchange(r#"{"jsonrpc":"2.0","id":1}"#);
        assert_eq!(answer["error"]["code"], -32600);
    }

    #[test]
    fn every_advertised_method_has_a_dispatch_and_unknown_ones_do_not() {
        let mut backend = Backend::new();
        for method in METHODS {
            let answer = backend
                .handle(method, &json!({}))
                .err()
                .unwrap_or_else(|| RpcError {
                    code: 0,
                    message: String::new(),
                });
            assert_ne!(
                answer.code, -32601,
                "{method} is advertised but has no dispatch"
            );
        }
        let manifest = include_str!("../../surface.json");
        for method in METHODS {
            assert!(
                manifest.contains(&format!("\"{method}\"")),
                "{method} is not declared in surface.json"
            );
        }
    }

    #[test]
    fn a_write_invalidates_the_workspace_cache_for_the_next_query() {
        let dir = temp_dir("cache");
        std::fs::write(dir.join("a.txt"), "a\n").expect("seed");
        let mut backend = Backend::new();
        let before = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "workspace.files",
                     "params": { "root": dir } })
            .to_string(),
        );
        let count_before = before["result"]["files"].as_array().expect("files").len();

        let write = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 2, "method": "fs.write",
                     "params": { "path": dir.join("b.txt"), "content": "b\n" } })
            .to_string(),
        );
        assert!(write.get("error").is_none(), "{write}");

        let after = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 3, "method": "workspace.files",
                     "params": { "root": dir } })
            .to_string(),
        );
        let count_after = after["result"]["files"].as_array().expect("files").len();
        assert_eq!(count_after, count_before + 1, "{after}");
    }

    #[test]
    fn fs_operations_are_reachable_through_the_json_rpc_surface() {
        let dir = temp_dir("dispatch");
        let file = dir.join("hello.txt");
        let mut backend = Backend::new();

        let create = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "fs.create",
                     "params": { "path": file, "kind": "file", "content": "hello" } })
            .to_string(),
        );
        assert_eq!(create["result"]["bytes"], 5);

        let list = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 2, "method": "fs.list", "params": { "path": dir } })
                .to_string(),
        );
        assert_eq!(list["result"]["entries"][0]["name"], "hello.txt");

        let asset = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 3, "method": "fs.read_asset", "params": { "path": file } })
                .to_string(),
        );
        assert_eq!(asset["result"]["mime"], "text/plain; charset=utf-8");

        let symbol = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 4, "method": "workspace.symbols", "params": { "path": file } })
                .to_string(),
        );
        assert_eq!(symbol["result"]["language"], "text");

        let remove = exchange_with(
            &mut backend,
            &json!({ "jsonrpc": "2.0", "id": 5, "method": "fs.delete", "params": { "path": file } })
                .to_string(),
        );
        assert_eq!(remove["result"]["deleted"], true);
    }

    #[test]
    fn a_call_without_a_usable_path_or_content_is_refused_as_invalid_params() {
        for (id, method, params) in [
            (1, "fs.read", json!({})),
            (2, "fs.read", json!({ "path": "   " })),
            (3, "fs.write", json!({ "path": "/tmp/x" })),
            (4, "fs.write", json!({ "path": "/tmp/x", "content": 5 })),
            (5, "fs.stat", json!({})),
            (6, "fs.list", json!({})),
            (7, "fs.create", json!({ "path": "/tmp/x", "kind": "socket" })),
            (8, "fs.rename", json!({ "path": "/tmp/x" })),
            (9, "fs.delete", json!({})),
            (10, "workspace.files", json!({})),
            (11, "workspace.search", json!({ "root": "/tmp" })),
            (12, "workspace.replace", json!({ "root": "/tmp", "query": "a" })),
            (13, "workspace.symbols", json!({})),
            (14, "fmt.rustfmt", json!({})),
            (15, "fmt.toml", json!({})),
            (16, "workspace.definition", json!({})),
            (17, "workspace.references", json!({})),
        ] {
            let answer = exchange(
                &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
                    .to_string(),
            );
            assert_eq!(answer["error"]["code"], -32602, "{method} {params}");
            let message = answer["error"]["message"].as_str().expect("message");
            assert!(
                message.contains("path")
                    || message.contains("content")
                    || message.contains("root")
                    || message.contains("query")
                    || message.contains("replacement")
                    || message.contains("kind")
                    || message.contains("to"),
                "{method}: {message}"
            );
        }
    }
}
