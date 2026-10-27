use std::io::{BufRead, Write};

use editor_backend::{respond, Backend};

fn main() {
    eprintln!("editor backend ready (pid {})", std::process::id());
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut backend = Backend::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(e) => {
                eprintln!("stdin could not be read: {e}");
                break;
            }
        };
        let Some(response) = respond(&mut backend, line.trim()) else {
            continue;
        };
        if writeln!(stdout, "{response}")
            .and_then(|()| stdout.flush())
            .is_err()
        {
            break;
        }
    }
    eprintln!("editor backend exiting (stdin closed)");
}
