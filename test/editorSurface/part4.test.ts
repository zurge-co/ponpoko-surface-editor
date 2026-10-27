import { DEFAULT_SIDEBAR, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, SETTINGS, SIDEBAR_STORAGE_KEY, compareEntries, createCommandRegistry, createDocumentState, createDocuments, createTabModel, describe, entryIcon, expect, explorerRows, fakeStorage, fileCandidates, filterOutline, formatEngineLabel, formatTarget, fuzzyMatch, nameProblem, noFormatterSentence, normalizeSidebarState, outlineRows, rankCandidates, readSidebar, stateOf, symbolIcon, test, visibleEntries, writeSidebar } from "../editorSurfaceCommon";
import type { EditorApi } from "../editorSurfaceCommon";

describe("the command registry is the one place an action lives", () => {
  test("a registered command runs once and an unknown one is refused quietly", async () => {
    const errors: string[] = [];
    const registry = createCommandRegistry({ onError: (message) => errors.push(message) });
    let runs = 0;
    registry.register({ id: "demo", title: "Demo", run: () => void (runs += 1) });

    expect(await registry.run("demo")).toBe(true);
    expect(await registry.run("nope")).toBe(false);
    expect(runs).toBe(1);
    expect(registry.get("demo")?.title).toBe("Demo");
    expect(registry.all().map((command) => command.id)).toEqual(["demo"]);
    expect(errors).toEqual([]);
  });

  test("a command that throws becomes a sentence, not an unhandled rejection", async () => {
    const errors: string[] = [];
    const registry = createCommandRegistry({ onError: (message) => errors.push(message) });
    registry.register({
      id: "explode",
      title: "Explode",
      run: () => {
        throw new Error("the disk is on fire");
      },
    });
    expect(await registry.run("explode")).toBe(false);
    expect(errors).toEqual(["Explode could not be completed: the disk is on fire"]);
  });
});

describe("the fuzzy list behind Cmd+P and Cmd+Shift+P", () => {
  test("an empty query matches everything and keeps the owner's order", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
    const items = ["zeta.ts", "a.ts", "middle.ts"];
    expect(rankCandidates("", items, (item) => item).map((row) => row.item)).toEqual(items);
    expect(rankCandidates("", items, (item) => item, 2)).toHaveLength(2);
  });

  test("the matched letters are the query, in order", () => {
    const text = "ponpoko/editor.ts";
    const match = fuzzyMatch("ned", text);
    expect(match).not.toBeNull();
    expect(match!.positions.map((position) => text[position]).join("")).toBe("ned");
    expect(fuzzyMatch("xyz", text)).toBeNull();
    expect(fuzzyMatch("MAIN", "src/main.rs")).not.toBeNull();
  });

  test("an earlier match and a word start win over a later, buried one", () => {
    const ranked = rankCandidates("main", ["domain.ts", "src/main.ts", "main.ts"], (item) => item);
    expect(ranked.map((row) => row.item)).toEqual(["main.ts", "src/main.ts", "domain.ts"]);
  });

  test("a camelCase hump is a word start", () => {
    expect(rankCandidates("gn", ["gone", "getUserName"], (item) => item)[0].item).toBe("getUserName");
  });
});

describe("quick open lists the folder's own files", () => {
  test("a workspace file becomes a row whose label is its relative path", () => {
    const rows = fileCandidates([
      { path: "/tmp/work/src/main.ts", relative: "src/main.ts", bytes: 2048 },
      { path: "/tmp/work/README.md", relative: "README.md", bytes: 10 },
    ]);
    expect(rows[0]).toEqual({ id: "/tmp/work/src/main.ts", label: "src/main.ts", detail: "2.0 KB" });
    expect(rows[1].detail).toBe("10 B");
  });

  test("typing across a path finds the file, and the id is the path to open", () => {
    const rows = fileCandidates([
      { path: "/tmp/work/src/main.ts", relative: "src/main.ts", bytes: 2048 },
      { path: "/tmp/work/docs/maintenance.md", relative: "docs/maintenance.md", bytes: 30 },
      { path: "/tmp/work/README.md", relative: "README.md", bytes: 10 },
    ]);
    const ranked = rankCandidates("srcmain", rows, (row) => row.label);
    expect(ranked[0].item.id).toBe("/tmp/work/src/main.ts");
  });
});

describe("the explorer's tree is a model before it is a widget", () => {
  interface TestEntry {
    name: string;
    path: string;
    is_dir: boolean;
    is_symlink: boolean;
    bytes: number;
    modified_ms: number;
  }
  const entry = (name: string, isDir = false, path?: string): TestEntry => ({
    name,
    path: path ?? "/work/" + name,
    is_dir: isDir,
    is_symlink: false,
    bytes: 0,
    modified_ms: 0,
  });

  test("folders come first, and numbered names read like a human numbers them", () => {
    const sorted = visibleEntries(
      [entry("file10.ts"), entry("src", true), entry("file2.ts"), entry("Alpha.ts")],
      true,
    );
    expect(sorted.map((item) => item.name)).toEqual(["src", "Alpha.ts", "file2.ts", "file10.ts"]);
    expect(compareEntries(entry("a", true), entry("z"))).toBeLessThan(0);
  });

  test("hidden names are opt-in", () => {
    const entries = [entry(".git", true), entry(".env"), entry("src", true)];
    expect(visibleEntries(entries, false).map((item) => item.name)).toEqual(["src"]);
    expect(visibleEntries(entries, true).map((item) => item.name)).toEqual([".git", "src", ".env"]);
  });

  test("the tree draws the root, the expanded folders, and nothing else", () => {
    const children = new Map<string, TestEntry[]>([
      ["/work", [entry("src", true), entry("README.md", false, "/work/README.md")]],
      ["/work/src", [entry("main.ts", false, "/work/src/main.ts"), entry("lib", true, "/work/src/lib")]],
    ]);
    const rows = explorerRows({
      root: "/work",
      expanded: new Set(["/work", "/work/src"]),
      children,
      showHidden: false,
      filter: "",
    });
    expect(rows.map((row) => `${row.depth}:${row.name}`)).toEqual([
      "0:work",
      "1:src",
      "2:lib",
      "2:main.ts",
      "1:README.md",
    ]);
  });

  test("a filter keeps the parents of what it matches, and answers nothing honestly", () => {
    const children = new Map<string, TestEntry[]>([
      ["/work", [entry("src", true), entry("README.md", false, "/work/README.md")]],
      ["/work/src", [entry("main.ts", false, "/work/src/main.ts")]],
    ]);
    const found = explorerRows({
      root: "/work",
      expanded: new Set(["/work"]),
      children,
      showHidden: false,
      filter: "main",
    });
    expect(found.map((row) => `${row.depth}:${row.name}`)).toEqual(["0:work", "1:src", "2:main.ts"]);

    expect(
      explorerRows({ root: "/work", expanded: new Set(["/work"]), children, showHidden: false, filter: "zzz" }),
    ).toEqual([]);
  });

  test("a name that cannot be a file name is refused with a sentence", () => {
    expect(nameProblem("a/b", [])).toContain("path separator");
    expect(nameProblem("   ", [])).toContain("required");
    expect(nameProblem("..", [])).not.toBeNull();
    expect(nameProblem("main.ts", ["MAIN.TS"])).toContain("already");
    expect(nameProblem("main.ts", ["lib.ts"])).toBeNull();
  });

  test("an entry's icon says what it is without a word", () => {
    expect(entryIcon("src", true, false)).toBe("folder");
    expect(entryIcon("src", true, true)).toBe("folder-open");
    expect(entryIcon("notes.md", false, false)).toBe("file-markdown");
    expect(entryIcon("logo.png", false, false)).toBe("file-image");
    expect(entryIcon("main.rs", false, false)).toBe("file-code");
    expect(entryIcon("LICENSE", false, false)).toBe("file-text");
  });
});

describe("the outline reads a symbol list the way a file is structured", () => {
  const SYMBOLS = [
    { name: "Person", kind: "class", line: 3, column: 7, container: null, exported: true },
    { name: "greet", kind: "method", line: 5, column: 3, container: "Person", exported: false },
    { name: "parse", kind: "function", line: 20, column: 1, container: null, exported: true },
  ];

  test("a member sits one level below its container", () => {
    expect(outlineRows(SYMBOLS).map((row) => row.depth)).toEqual([0, 1, 0]);
  });

  test("the filter matches the symbol's own name, not its container's", () => {
    const rows = outlineRows(SYMBOLS);
    expect(filterOutline(rows, "gre").map((row) => row.name)).toEqual(["greet"]);
    expect(filterOutline(rows, "PERSON").map((row) => row.name)).toEqual(["Person"]);
    expect(filterOutline(rows, "person").map((row) => row.name)).toEqual(["Person"]);
    expect(filterOutline(rows, "")).toHaveLength(SYMBOLS.length);
    expect(filterOutline(rows, "zzz")).toEqual([]);
  });

  test("each kind gets the glyph that says what it is", () => {
    expect(symbolIcon("class")).toBe("symbol-class");
    expect(symbolIcon("interface")).toBe("symbol-class");
    expect(symbolIcon("function")).toBe("symbol-function");
    expect(symbolIcon("method")).toBe("symbol-function");
    expect(symbolIcon("const")).toBe("symbol-variable");
    expect(symbolIcon("heading")).toBe("symbol-heading");
    expect(symbolIcon("key")).toBe("symbol-key");
    expect(symbolIcon("something-else")).toBe("symbols");
  });
});

describe("the sidebar remembers its shape, within reason", () => {
  test("the stored width is clamped instead of obeyed", () => {
    expect(normalizeSidebarState({ width: 4 }).width).toBe(MIN_SIDEBAR_WIDTH);
    expect(normalizeSidebarState({ width: 4000 }).width).toBe(MAX_SIDEBAR_WIDTH);
    expect(normalizeSidebarState({ width: 300 }).width).toBe(300);
    expect(normalizeSidebarState(null)).toEqual(DEFAULT_SIDEBAR);
    expect(normalizeSidebarState("nonsense")).toEqual(DEFAULT_SIDEBAR);
  });

  test("a remembered view survives a round trip; junk reads as the default", () => {
    const storage = fakeStorage();
    writeSidebar(storage, { open: false, active: "outline", width: 321 });
    expect(readSidebar(storage)).toEqual({ open: false, active: "outline", width: 321 });

    storage.setItem(SIDEBAR_STORAGE_KEY, '{"open":"yes","width":"wide"}');
    expect(readSidebar(storage)).toEqual({ ...DEFAULT_SIDEBAR, active: null });
  });

  test("a sidebar written under an earlier product name is read and copied forward", () => {
    const storage = fakeStorage({
      "earlier.editor.sidebar.v1": '{"open":false,"active":"outline","width":321}',
    });
    expect(readSidebar(storage)).toEqual({ open: false, active: "outline", width: 321 });
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe(
      '{"open":false,"active":"outline","width":321}',
    );
  });

  test("a key for another surface's settings is not mistaken for ours", () => {
    const storage = fakeStorage({ "earlier.terminal.sidebar.v1": '{"open":false}' });
    expect(readSidebar(storage)).toEqual(DEFAULT_SIDEBAR);
  });
});

describe("the tabs and the tree agree about paths", () => {
  test("renaming a folder moves every open tab below it, and only those", () => {
    const tabs = createTabModel();
    tabs.open({ path: "/work/src/a.ts", state: stateOf("a\n") });
    tabs.open({ path: "/work/src/lib/b.rs", state: stateOf("b\n") });
    tabs.open({ path: "/work/notes.md", state: stateOf("c\n") });

    const moved = tabs.renamePrefix("/work/src", "/work/source");
    expect(moved.map((tab) => tab.path)).toEqual(["/work/source/a.ts", "/work/source/lib/b.rs"]);
    expect(tabs.list().map((tab) => tab.path)).toEqual([
      "/work/source/a.ts",
      "/work/source/lib/b.rs",
      "/work/notes.md",
    ]);
    expect(moved[0].language).toBe("typescript");
    expect(moved[1].language).toBe("rust");
  });

  test("a dropped tab is not offered back by reopen", () => {
    const tabs = createTabModel();
    tabs.open({ path: "/work/a.ts", state: stateOf("a\n") });
    const b = tabs.open({ path: "/work/b.ts", state: stateOf("b\n") }).tab;

    expect(tabs.tabsUnder("/work").map((tab) => tab.path)).toEqual(["/work/a.ts", "/work/b.ts"]);
    tabs.drop(b.id);
    expect(tabs.list().map((tab) => tab.path)).toEqual(["/work/a.ts"]);
    expect(tabs.closedCount()).toBe(0);
  });
});

describe("an open tab follows what the explorer did to the folder", () => {
  function documentsWith(files: Record<string, string>) {
    const store = new Map(Object.entries(files));
    const errors: string[] = [];
    const notes: string[] = [];
    const tabs = createTabModel();
    const api: Pick<EditorApi, "read" | "write" | "stat"> = {
      async read(path) {
        const content = store.get(path);
        if (content === undefined) throw new Error(`there is no file at ${path}`);
        return { path, content, bytes: content.length };
      },
      async write(path, content) {
        store.set(path, content);
        return { path, bytes: content.length };
      },
      async stat(path) {
        const content = store.get(path);
        return {
          path,
          exists: content !== undefined,
          is_file: content !== undefined,
          is_dir: false,
          bytes: content?.length ?? 0,
        };
      },
    };
    const documents = createDocuments({
      api,
      tabs,
      createState: (text, language, settings) => createDocumentState(text, { language, settings }),
      capture: () => ({ scrollTop: 0, topLine: 1, cursorLine: 1, cursorColumn: 1 }),
      settings: () => SETTINGS,
      pickFile: async () => null,
      askUnsaved: async () => "cancel",
      confirm: async () => true,
      reconfigureLanguage: () => undefined,
      preferredDirectory: () => "/work",
      onChange: () => undefined,
      onError: (message) => errors.push(message),
      onNote: (message) => notes.push(message),
    });
    return { documents, tabs, errors, notes, store };
  }

  test("a renamed file's tab follows the rename and keeps its buffer", async () => {
    const h = documentsWith({ "/work/a.ts": "alpha\n" });
    const tab = (await h.documents.openPath("/work/a.ts"))!;
    h.tabs.update(tab.id, stateOf("alpha edited\n"));
    expect(h.tabs.isDirty(tab.id)).toBe(true);

    expect(h.documents.applyRenamed("/work/a.ts", "/work/b.ts")).toBe(1);
    const renamed = h.tabs.list()[0];
    expect(renamed.path).toBe("/work/b.ts");
    expect(renamed.name).toBe("b.ts");
    expect(renamed.state.doc.toString()).toBe("alpha edited\n");
    expect(h.tabs.isDirty(renamed.id)).toBe(true);
    expect(h.notes.join(" ")).toContain("a.ts is now b.ts");
  });

  test("a deleted file closes its clean tab and keeps a dirty one, out loud", async () => {
    const h = documentsWith({ "/work/clean.ts": "a\n", "/work/dirty.ts": "b\n" });
    await h.documents.openPath("/work/clean.ts");
    const dirty = (await h.documents.openPath("/work/dirty.ts"))!;
    h.tabs.update(dirty.id, stateOf("b edited\n"));
    expect(h.tabs.list()).toHaveLength(2);

    expect(h.documents.applyDeleted("/work/clean.ts")).toEqual({ closed: 1, kept: [] });
    expect(h.tabs.list().map((tab) => tab.path)).toEqual(["/work/dirty.ts"]);

    const kept = h.documents.applyDeleted("/work/dirty.ts");
    expect(kept.kept).toEqual(["dirty.ts"]);
    expect(h.tabs.list()).toHaveLength(1);
    expect(h.errors.join(" ")).toContain("still has unsaved changes");
    expect(h.errors.join(" ")).toContain("Save As");
  });

  test("a rewrite outside the editor reloads a clean tab and keeps a dirty one, out loud", async () => {
    const h = documentsWith({ "/work/clean.ts": "alpha\n", "/work/dirty.ts": "beta\n" });
    await h.documents.openPath("/work/clean.ts");
    const dirty = (await h.documents.openPath("/work/dirty.ts"))!;
    h.tabs.update(dirty.id, stateOf("beta edited\n"));

    h.store.set("/work/clean.ts", "alpha replaced\n");
    h.store.set("/work/dirty.ts", "beta replaced\n");
    const result = await h.documents.applyExternalWrite(["/work/clean.ts", "/work/dirty.ts"]);

    expect(result.reloaded).toEqual(["clean.ts"]);
    expect(result.kept).toEqual(["dirty.ts"]);
    const clean = h.tabs.findPath("/work/clean.ts")!;
    expect(clean.state.doc.toString()).toBe("alpha replaced\n");
    expect(h.tabs.dirty(clean)).toBe(false);
    expect(h.tabs.findPath("/work/dirty.ts")!.state.doc.toString()).toBe("beta edited\n");
    expect(h.errors.join(" ")).toContain("would undo the change");
    expect(h.notes.join(" ")).toContain("reloaded");
  });
});

describe("the formatter knows which engine each language belongs to", () => {
  test("the requirement's languages map to the engine that formats them", () => {
    expect(formatTarget("typescript")).toEqual({ engine: "prettier", parser: "typescript" });
    expect(formatTarget("tsx")).toEqual({ engine: "prettier", parser: "typescript" });
    expect(formatTarget("javascript")).toEqual({ engine: "prettier", parser: "babel" });
    expect(formatTarget("json")).toEqual({ engine: "prettier", parser: "json" });
    expect(formatTarget("jsonc")).toEqual({ engine: "prettier", parser: "jsonc" });
    expect(formatTarget("markdown")).toEqual({ engine: "prettier", parser: "markdown" });
    expect(formatTarget("scss")).toEqual({ engine: "prettier", parser: "scss" });
    expect(formatTarget("html")).toEqual({ engine: "prettier", parser: "html" });
    expect(formatTarget("rust")).toEqual({ engine: "rustfmt" });
    expect(formatTarget("toml")).toEqual({ engine: "taplo" });
    expect(formatTarget("python")).toBeNull();
    expect(formatTarget("text")).toBeNull();
    expect(noFormatterSentence("python")).toContain("no formatter for Python");
    expect(formatEngineLabel("prettier")).toBe("Prettier");
    expect(formatEngineLabel("rustfmt")).toBe("rustfmt");
    expect(formatEngineLabel("taplo")).toBe("taplo");
  });
});
