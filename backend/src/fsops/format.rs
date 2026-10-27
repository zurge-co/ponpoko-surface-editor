use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use serde_json::{json, Value};
use crate::{internal, invalid_params, RpcError};

use super::*;

pub fn edition_near(path: Option<&Path>) -> String {
    let Some(path) = path else {
        return "2021".to_string();
    };
    let mut directory = if path.is_dir() {
        Some(path)
    } else {
        path.parent()
    };
    while let Some(current) = directory {
        let cargo = current.join("Cargo.toml");
        if let Ok(text) = std::fs::read_to_string(&cargo) {
            for line in text.lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("edition") {
                    if let Some(rest) = rest.trim_start().strip_prefix('=') {
                        let rest = rest.trim().trim_matches('"').trim_matches('\'');
                        if !rest.is_empty() {
                            return rest.to_string();
                        }
                    }
                }
            }
            return "2021".to_string();
        }
        directory = current.parent();
    }
    "2021".to_string()
}

pub(crate) fn format_rustfmt(params: &Value) -> Result<Value, RpcError> {
    let content = string_param(params, "content", "fmt.rustfmt")?;
    if content.len() > MAX_RUSTFMT_BYTES {
        return Err(invalid_params(format!(
            "the buffer is {} bytes, larger than the {MAX_RUSTFMT_BYTES} byte formatting limit",
            content.len()
        )));
    }
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let edition = edition_near(path.as_deref());

    let mut command = Command::new("rustfmt");
    command
        .arg("--edition")
        .arg(&edition)
        .arg("--emit")
        .arg("stdout")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            internal(
                "rustfmt is not installed or is not on PATH. Install the Rust toolchain (rustup component add rustfmt) and try again.",
            )
        } else {
            internal(format!("rustfmt could not be started: {e}"))
        }
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| internal("rustfmt did not expose stdin"))?;
    if let Err(e) = stdin.write_all(content.as_bytes()) {
        return Err(internal(format!("rustfmt could not read the buffer: {e}")));
    }
    drop(stdin);

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| internal("rustfmt did not expose stdout"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| internal("rustfmt did not expose stderr"))?;
    let out_thread = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let err_thread = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > FORMAT_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(internal(format!(
                    "rustfmt did not finish within {} seconds; the file was not changed",
                    FORMAT_TIMEOUT.as_secs()
                )));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(internal(format!("rustfmt could not be waited for: {e}")));
            }
        }
    };

    let formatted = out_thread
        .join()
        .map_err(|_| internal("rustfmt output could not be read"))?;
    let warnings = err_thread
        .join()
        .map_err(|_| internal("rustfmt diagnostics could not be read"))?;

    if !status.success() {
        let detail = warnings.trim();
        return Err(internal(if detail.is_empty() {
            format!("rustfmt refused the buffer with exit status {status}")
        } else {
            format!("rustfmt refused the buffer: {detail}")
        }));
    }
    if formatted.trim().is_empty() {
        return Err(internal(
            "rustfmt returned an empty buffer; the file was not changed",
        ));
    }
    Ok(json!({
        "content": formatted,
        "warnings": warnings.trim(),
        "edition": edition,
    }))
}

pub(crate) fn format_toml(params: &Value) -> Result<Value, RpcError> {
    let content = string_param(params, "content", "fmt.toml")?;
    let formatted = taplo::formatter::format(content, taplo::formatter::Options::default());
    if formatted.trim().is_empty() && !content.trim().is_empty() {
        return Err(internal(
            "the TOML formatter returned an empty document; the buffer was not changed",
        ));
    }
    Ok(json!({
        "content": formatted,
    }))
}

pub(crate) fn mime_for_path(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" | "markdown" | "mdx" => "text/plain; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "jsonc" | "map" => "application/json; charset=utf-8",
        "xml" => "application/xml",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}
