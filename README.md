# Editor — the reference Ponpoko surface (1.0.0)

This is a **surface**, not a built-in: Ponpoko did not ship it, a human installs it
from a folder. It is the surface the architecture is proven with (ADR-003,
ADR-004) and it is a real programming editor: open a folder, browse it in the
Explorer, edit files in tabs, search and replace across the folder, format by
language, preview Markdown / images / HTML, and jump to a definition with a
static symbol index. CodeMirror 6 is the editor component; file I/O happens in
its own stdio backend process.

Everything below is what this build actually does. Where it stops, it says so
instead of pretending.

## What this build does

### Workspace and Explorer

- **Open a folder.** The OS folder dialog (through `tool.file`, opened by the
  host) picks the workspace. The workspace root is remembered with the session.
- **Explorer tree.** Folders expand lazily through `fs.list` (so a huge folder
  costs one directory read, not a walk); files open in tabs; hidden files are
  behind a toggle. The tree has create file / create folder / rename / delete /
  reveal-in-OS / copy path, from the row's context menu and the keyboard.
- **Drop files and folders onto the tree.** Dragging files or folders from the
  OS file manager onto the Explorer, or pressing `Ctrl`/`Cmd`+`V` while the tree
  has focus, writes them into the selected folder (the selected file's folder if
  a file is selected, the workspace root when nothing is). Folders keep their
  shape — every nested file is written — and a file too large to be handed to
  the page is copied by the backend instead of being read into memory. A name
  that is already taken becomes `notes (2).txt`; nothing is ever overwritten.
  Image and text data on the clipboard can be pasted as a new file from the
  "Paste Files" command.
- **Ignore rules.** Search, Replace All and quick open skip what a programmer
  expects to skip: `.git`, `node_modules`, `target`, `dist`, `build`, and the
  rest of the backend's ignore list.
- Everything on disk goes through the surface's own programs
  (`backend/src/`); Ponpoko itself never touches the files.

### Tabs and memory

- **Tabs.** Several files at once, one `EditorState` per tab (undo history,
  selection, folds, the document), a dirty dot, close with Save / Don't Save /
  Cancel, close others / close all, reopen the last closed tab.
- **Memory.** Each tab remembers the line it was scrolled to; switching tabs
  comes back to it. Closing a tab forgets it. Clean tabs and their positions are
  restored on the next start.
- **Drag-free navigation.** Next/previous tab, "go to tab *n*", and the tab
  strip's arrow/home/end keys.

### Languages

28 modes from CodeMirror's grammars — TypeScript/TSX, JavaScript/JSX, Rust,
YAML, JSON/JSONC, Markdown/MDX, TOML, HTML, XML, CSS/SCSS/Less, Python, Go,
C/C++, Java, PHP, SQL, Shell, Dockerfile, INI/properties, diff, plain text. A
file nobody claims is plain text, and the status line says so instead of
guessing. The language can be set by hand from the status line.

- **No autocomplete.** There is no completion popup and no completion keymap;
  the surface never shows one. This is a deliberate omission, not something to
  discover later: the requirement asks for an editor without a completion
  engine, and the test suite checks that no completion UI exists in the source.
- **One theme.** Ponpoko's palette, including syntax colors. No theme switcher.

### Editing

In-file find/replace, go to line, toggle comment, indent/outdent, move/copy/
delete line, multi-cursor (select next occurrence, add cursor at click), word
wrap, zoom (text size), bracket matching, folding, and the usual CodeMirror
undo/redo.

### Quick open, command palette, outline

- **Quick open** (Cmd/Ctrl+P) ranks the workspace's files with a fuzzy match and
  opens the chosen one.
- **Command palette** (Cmd/Ctrl+Shift+P) lists every command the surface
  registers, with the same fuzzy ranking.
- **Outline** (in the sidebar) reads the active **buffer** (not the file on
  disk) through `workspace.symbols`: TypeScript/JavaScript, Rust, Python, Go,
  Markdown, JSON, YAML and TOML get real entries; clicking one moves the caret.

### Search in files, and Replace All

- Search the workspace with literal or regex matching, case sensitivity, whole
  word, hidden files, with results grouped per file and click-to-open at the
  exact line and column.
- **Replace All asks first**, names how many matches in how many files, then
  reports what actually changed and which files it could not write.
- Limits, stated rather than hit by surprise: files larger than 2 MB are not
  searched, and results stop at 2,000 matches (the panel says it stopped early).
- After a Replace All, clean tabs reload from disk; a tab with unsaved edits is
  kept and named, because reloading it would throw work away and saving it would
  undo the replace.

### Formatting

One command per document (`Format Document`), by language:

- **Prettier**, bundled into this surface — it runs in the page, on this
  machine, with no network and no toolchain: JavaScript/JSX, TypeScript/TSX,
  JSON, JSONC, YAML, Markdown/MDX, CSS/SCSS/Less, HTML.
- **rustfmt** for Rust and **taplo** for TOML, through the backend, because they
  are native tools. A missing binary is one sentence naming what to install, not
  a silent no-op.
- The project's own configuration is read first: `.prettierrc` /
  `.prettierrc.json` at the workspace root (only an allowlist of keys is passed
  through) and the matching `.editorconfig` section; Prettier wins where both
  speak, and the status line says which file decided.
- Limits: buffers over 8 MB are not formatted, and a language with no formatter
  says so.

### Previews

- **Markdown** is rendered from the buffer (an unsaved edit is what you see),
  sanitized with DOMPurify, with fenced code highlighted by the same Lezer
  grammars and Ponpoko colors as the editor. Local images are inlined through
  `fs.read_asset`; a relative link to another document opens that document in a
  tab; a link to the web is shown as text, because this surface has no browser
  and must not start a navigation inside the workbench.
- **Images** (`png/jpg/jpeg/gif/webp/avif/bmp/ico/svg`) are drawn byte-for-byte
  from `fs.read_asset` — no re-encode, no server — with real size and
  dimensions, and zoom. Preview assets are capped at 32 MB.
- **HTML** is drawn in an iframe with an empty `sandbox` attribute and a
  Content-Security-Policy that permits inline styles and `data:` images only:
  **scripts never run**, and its local stylesheets and images are inlined first
  so the preview never reaches for the network.
- Code files have no preview; the command says that rather than opening an empty
  pane.

### Navigation: definitions, references, go to symbol

There is **no language server** behind this surface, so navigation is a static
index instead of a type checker:

- the identifier under the cursor is read from the **buffer** (an unsaved
  declaration is still a declaration);
- `Ctrl+click` (Cmd+click on macOS) and `F12` ask for a definition;
  `Shift+F12` asks for every reference; the context menu offers the same;
- one answer opens directly, several open a peek list to choose from, none says
  why in a sentence instead of doing nothing.

What it reads: imports and `export`s across the workspace, relative paths,
`index.ts`-style folder resolution, the project's `tsconfig.json`/`jsconfig.json`
`baseUrl` and `paths`, Rust `use`/`mod`/`crate`/`super`/`self` paths, and the
declarations the indexer can see. What it does not do: type inference, generics,
re-exports it cannot see through, a name that only exists at run time, or
anything a compiler would resolve and a regex cannot. When it is unsure it says
so; it does not guess silently.

### A file that changes under an open tab

The editor asks the disk, not its memory:

- **Before every save** it compares the file's timestamp with the one the tab
  read. If another program wrote the file in between, it asks: **Overwrite**,
  **Reload from Disk**, or **Cancel** — and Cancel writes nothing.
- **When a tab comes to the front** it checks again. A clean tab follows the disk
  and says that it did; a tab with unsaved edits asks first, because reloading
  it would discard work. "Keep My Version" keeps the buffer and the next save
  still asks before overwriting.
- A file deleted outside the editor is reported; the tab keeps the text that was
  last saved there, because that text is now the only copy.
- Renames and deletes done **in the Explorer** move or close the tabs that
  followed them, out loud.

### Large files

Above **4 MB** a file opens as plain text on purpose: the grammar, the highlight
style and the document-wide decoration passes are left out so typing stays
responsive, and the status line says why. The text is all there, editing and
saving are unchanged. The backend refuses to open files over 16 MB at all, with
a sentence naming the limit.

### Accessibility

The workbench is built for the keyboard and announces itself to assistive
technology: the tab strip is a `tablist` with `aria-selected` and a roving
tabindex, the Explorer and the outline are `tree`s with `aria-expanded` and
`aria-level`, the status line is `role="status"`, the error banner is
`role="alert"`, the editor's content area carries an `aria-label` and every
icon-only button has one too. Dialogs are `role="dialog" aria-modal`, move focus
into themselves, keep Tab inside, close on Escape, and restore focus afterwards.
The command palette and quick open are combobox/listbox pairs driven by the
keyboard.

### Settings

Text size, tab size, spaces vs tabs, word wrap, restore session — stored on this
machine (`localStorage`), no network, no telemetry.

## Build the bundle

This folder is a repo of its own: it carries its own `bun.lock` and its own build
task, so it builds from a checkout of itself and needs nothing from the app.

```sh
bun install                 # once
bun run build               # type-check, bundle, compile both programs, verify
```

From the app's side the same task runs through `bun run build:surface-editor`
(or `node scripts/build-surfaces.mjs surfaces/editor`), which only delegates.

`app/bunfig.toml` installs with the isolated linker, so as a workspace outside
`app/` these dependencies land in this folder's `node_modules/` rather than being
hoisted — that is what lets its tsconfig and its bundle resolve CodeMirror at all.

The installable bundle lands in `dist/`:

```
dist/surface.json            the contract Ponpoko validates at install time
dist/index.html              the page the host loads into the surface's frame
dist/assets/…                the built page and styles
dist/bin/editor-backend      the surface's own process (compiled by cargo)
dist/bin/editor-cli          the surface's own command line, same method table
```

`bun run build` at the app root builds the window **and** this bundle; this
folder's `scripts/build.mjs` compiles both programs the manifest declares and then
checks the output against the same rules the install path uses — an uninstallable
bundle fails the build.

The *source* folder is deliberately not installable: `surface.json` lives here
but the entry document exists only in `dist/`, and the install path requires the
entry to be in the folder you pick.

## Install it

In Ponpoko: **Surfaces → Install a surface…** and pick `surfaces/editor/dist`.

Headlessly, through the same install path:

```sh
PONPOKO_HOME=$(mktemp -d) \
  cargo run --manifest-path app/src-tauri/Cargo.toml --bin ponpoko -- \
  surface-install --bundle surfaces/editor/dist
```

The registry row goes into the central db and the files into
`<app data dir>/surfaces/editor/` — never inside a workspace (ADR-001).
Remove it from the Surfaces window, or with `ponpoko surface-remove editor`.

## How it talks to Ponpoko

- `surface.json` asks for `tool.file` (the OS file dialog, opened by the host)
  and `backend.call` (this surface's own process). It asks for nothing else, and
  it has no way to ask for anything else: an unknown permission fails the whole
  manifest at install time.
- The page reaches Ponpoko only through `postMessage` (`src/bridge.ts` speaks the
  protocol the host's `app/src/lib/surfaceBridge.ts` defines). There is no Tauri
  IPC in the frame, so Ponpoko's own commands are not reachable from here at all.
- File I/O and the index live in `backend/src/lib.rs` as one method table, with
  two programs in front of it: `bin/editor-backend`, the JSON-RPC process over
  stdin/stdout that Ponpoko starts from the installed bundle and logs to
  `<app data dir>/logs/surface-backends/editor.log`, and `bin/editor-cli`, this
  surface's own command line. Methods: `fs.read`,
  `fs.write`, `fs.stat`, `fs.list`, `fs.read_asset`, `fs.create`, `fs.copy`,
  `fs.write_asset`, `fs.rename`,
  `fs.delete`, `fs.reveal`, `workspace.files`, `workspace.search`,
  `workspace.replace`, `workspace.symbols`, `workspace.definition`,
  `workspace.references`, `fmt.rustfmt`, `fmt.toml`, `app.ping`, `app.info`.

## The surface's own CLI

The editor does not need Ponpoko to read, search or format a file: the bundle
ships `bin/editor-cli`, built from the same library and the same method table as
the backend. `surface.json` says it exists (`"cli": { "command": "bin/editor-cli" }`);
Ponpoko reads that path and never runs it.

```sh
bin/editor-cli --list                                     # the methods it answers
bin/editor-cli app.info
bin/editor-cli fs.read path=/some/file.txt
bin/editor-cli fs.list path=/some/folder
bin/editor-cli workspace.search root=/some/project query=needle
bin/editor-cli fs.write --json '{"path":"/tmp/a.txt","content":"42"}'
```

`key=value` values are typed the way JSON spells them (`true`, `false`, `null`,
numbers, objects, arrays) and stay text otherwise; use `--json` when a value
must be exactly a string that looks like a number. The answer is JSON on stdout;
a refusal is `{"error": …}` on stderr and a non-zero exit.

## Test it

```sh
cd app && bun test                                   # app + this surface's suite
cd surfaces/editor/backend && cargo test             # both binaries' suite
cd surfaces/editor && bun run typecheck              # the surface's own project
```

The surface's suite (`app/test/editorSurface.test.ts`) proves the pure layers —
language detection, the tab model, the save/close flows, conflict detection,
the large-file guard, the keymap, the session, search grouping, preview
resolution, navigation — and the promises this README makes about what the build
does and does not contain.

## Version 1.0.0 — what it is not

- **No language server**: navigation is a static, heuristic index (above), no
  type checking, no rename-symbol, no diagnostics.
- **No autocomplete** and no AI completion of any kind.
- **No git integration**, no debugger, no terminal.
- **No extensions or plugin model**: the language list and the theme are fixed.
- **No multi-window or split view**: one document in front, one preview pane.
- Formatting only where an engine exists (Prettier, rustfmt, taplo); it does not
  ship a formatter for every language in the list.
- Previews are Markdown, images and HTML; everything else is edited as text.

## Thai, and other complex scripts

The editor is a browser document: text shaping (Thai combining marks, ligatures,
RTL) is the WebView's own work and needs nothing from Ponpoko. That is the reason
a surface — rather than a built-in screen — is a good home for it. A terminal
surface is a different story: a grid of fixed-width cells mis-measures Thai
combining marks, and that problem is not addressed in this round.
