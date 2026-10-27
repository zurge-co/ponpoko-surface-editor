import { APP_KEYBINDINGS, DEFAULT_SETTINGS, EDITOR_KEYBINDINGS, LARGE_FILE_BYTES, SESSION_STORAGE_KEY, SETTINGS_STORAGE_KEY, createTabModel, debounce, describe, expect, fakeStorage, formatBytes, harness, installAppKeymap, isLargeFile, keyEvent, keyLabel, matchesKey, normalizeSession, normalizeSettings, parseKey, persistedTabs, readSession, readSettings, rememberRecent, stateOf, test, writeSession, writeSettings } from "../editorSurfaceCommon";
import type { StorageLike } from "../editorSurfaceCommon";

describe("a file another program wrote is never replaced by accident", () => {
  async function opened(tabText = "one\n") {
    const h = harness();
    h.store.set("/tmp/a.ts", tabText);
    h.modified.set("/tmp/a.ts", 1);
    const tab = (await h.documents.openPath("/tmp/a.ts"))!;
    return { h, tab };
  }

  test("saving over a file that changed on disk asks first, and Cancel writes nothing", async () => {
    const { h, tab } = await opened();
    h.tabs.update(tab.id, stateOf("one edited\n"));
    h.externalWrite("/tmp/a.ts", "written by another program\n");
    h.log.length = 0;
    h.answerConflict("cancel");

    expect(await h.documents.save(tab.id)).toBe(false);
    expect(h.conflicts).toEqual(["save:a.ts"]);
    expect(h.log).toEqual([]);
    expect(h.store.get("/tmp/a.ts")).toBe("written by another program\n");
    expect(h.notes.join(" ")).toContain("changed on disk");
    expect(h.tabs.findPath("/tmp/a.ts")!.state.doc.toString()).toBe("one edited\n");
    expect(h.tabs.isDirty(tab.id)).toBe(true);
  });

  test("Overwrite puts the buffer on disk and re-stamps the tab", async () => {
    const { h, tab } = await opened();
    h.tabs.update(tab.id, stateOf("one edited\n"));
    h.externalWrite("/tmp/a.ts", "theirs\n");
    h.answerConflict("overwrite");

    expect(await h.documents.save(tab.id)).toBe(true);
    expect(h.store.get("/tmp/a.ts")).toBe("one edited\n");
    expect(h.tabs.isDirty(tab.id)).toBe(false);
    expect(h.tabs.findPath("/tmp/a.ts")!.modifiedMs).toBe(h.modified.get("/tmp/a.ts")!);
  });

  test("Reload from the save question replaces the buffer and writes nothing", async () => {
    const { h, tab } = await opened();
    h.tabs.update(tab.id, stateOf("one edited\n"));
    h.externalWrite("/tmp/a.ts", "from disk\n");
    h.answerConflict("reload");

    expect(await h.documents.save(tab.id)).toBe(false);
    expect(h.store.get("/tmp/a.ts")).toBe("from disk\n");
    expect(h.tabs.findPath("/tmp/a.ts")!.state.doc.toString()).toBe("from disk\n");
    expect(h.tabs.isDirty(tab.id)).toBe(false);
    expect(h.notes.join(" ")).toContain("nothing was saved");
  });

  test("a clean tab follows the disk when it comes to the front, without asking", async () => {
    const { h, tab } = await opened();
    h.externalWrite("/tmp/a.ts", "after\n");

    expect(await h.documents.reconcile(tab.id)).toBe("reloaded");
    expect(h.conflicts).toEqual([]);
    expect(h.tabs.findPath("/tmp/a.ts")!.state.doc.toString()).toBe("after\n");
    expect(h.tabs.isDirty(tab.id)).toBe(false);
    expect(h.notes.join(" ")).toContain("reloaded");
  });

  test("a dirty tab keeps its edits unless the human chooses to reload", async () => {
    const { h, tab } = await opened();
    h.tabs.update(tab.id, stateOf("my edit\n"));
    h.externalWrite("/tmp/a.ts", "theirs\n");
    h.answerConflict("keep");

    expect(await h.documents.reconcile(tab.id)).toBe("kept");
    expect(h.tabs.findPath("/tmp/a.ts")!.state.doc.toString()).toBe("my edit\n");
    expect(h.tabs.isDirty(tab.id)).toBe(true);
    expect(h.conflicts).toEqual(["reload:a.ts"]);
    expect(h.notes.join(" ")).toContain("Saving will ask");

    expect(await h.documents.reconcile(tab.id)).toBe("kept");
    expect(h.conflicts).toEqual(["reload:a.ts"]);

    h.answerConflict("cancel");
    expect(await h.documents.save(tab.id)).toBe(false);
    expect(h.conflicts).toEqual(["reload:a.ts", "save:a.ts"]);
  });

  test("the human may answer the front-of-tab question by reloading", async () => {
    const { h, tab } = await opened();
    h.tabs.update(tab.id, stateOf("my edit\n"));
    h.externalWrite("/tmp/a.ts", "theirs\n");
    h.answerConflict("reload");

    expect(await h.documents.reconcile(tab.id)).toBe("reloaded");
    expect(h.tabs.findPath("/tmp/a.ts")!.state.doc.toString()).toBe("theirs\n");
    expect(h.tabs.isDirty(tab.id)).toBe(false);
    expect(h.notes.join(" ")).toContain("discarded");
  });

  test("a tab whose file vanished says so and keeps its text", async () => {
    const { h, tab } = await opened();
    h.store.delete("/tmp/a.ts");

    expect(await h.documents.reconcile(tab.id)).toBe("missing");
    expect(h.errors.join(" ")).toContain("is no longer on disk");
    expect(h.tabs.findPath("/tmp/a.ts")!.state.doc.toString()).toBe("one\n");
  });

  test("a tab nobody has written yet is saved to a new path without asking", async () => {
    const { h, tab } = await opened();
    h.pick("/tmp/new.ts");

    expect(await h.documents.saveAs(tab.id)).toBe(true);
    expect(h.conflicts).toEqual([]);
    expect(h.store.get("/tmp/new.ts")).toBe("one\n");
    expect(h.tabs.findPath("/tmp/new.ts")).not.toBeNull();
  });
});

describe("a file too large to parse opens as plain text, on purpose", () => {
  test("the threshold is 4 MB and says so in bytes", () => {
    expect(LARGE_FILE_BYTES).toBe(4 * 1024 * 1024);
    expect(isLargeFile(LARGE_FILE_BYTES - 1)).toBe(false);
    expect(isLargeFile(LARGE_FILE_BYTES)).toBe(true);
    expect(formatBytes(LARGE_FILE_BYTES)).toBe("4.0 MB");
  });

  test("opening a large file builds its state without a grammar and says why", async () => {
    const h = harness();
    const big = "x".repeat(LARGE_FILE_BYTES + 10);
    h.store.set("/tmp/big.ts", big);

    const tab = (await h.documents.openPath("/tmp/big.ts"))!;

    expect(tab.bytes).toBe(big.length);
    expect(h.stateOptions.at(-1)).toEqual({ largeFile: true });
    expect(h.notes.join(" ")).toContain("syntax highlighting is off");
    expect(tab.state.doc.length).toBe(big.length);
  });

  test("a normal file is still highlighted", async () => {
    const h = harness();
    h.store.set("/tmp/small.ts", "const a = 1;\n");

    await h.documents.openPath("/tmp/small.ts");

    expect(h.stateOptions.at(-1)).toEqual({ largeFile: false });
    expect(h.notes.join(" ")).not.toContain("syntax highlighting is off");
  });
});

describe("the keyboard follows VS Code's spelling of the same shortcuts", () => {
  test("Mod is Cmd on macOS and Ctrl elsewhere", () => {
    expect(matchesKey(keyEvent({ key: "s", code: "KeyS", meta: true }), "Mod-s", "mac")).toBe(true);
    expect(matchesKey(keyEvent({ key: "s", code: "KeyS", ctrl: true }), "Mod-s", "mac")).toBe(false);
    expect(matchesKey(keyEvent({ key: "s", code: "KeyS", ctrl: true }), "Mod-s", "other")).toBe(true);
    expect(matchesKey(keyEvent({ key: "s", code: "KeyS", meta: true }), "Mod-s", "other")).toBe(false);
  });

  test("extra modifiers mean a different binding", () => {
    expect(
      matchesKey(keyEvent({ key: "S", code: "KeyS", meta: true, shift: true }), "Mod-s", "mac"),
    ).toBe(false);
    expect(
      matchesKey(keyEvent({ key: "S", code: "KeyS", meta: true, shift: true }), "Mod-Shift-s", "mac"),
    ).toBe(true);
    expect(matchesKey(keyEvent({ key: "z", code: "KeyZ", meta: true }), "Alt-z", "mac")).toBe(false);
  });

  test("Ctrl-Tab is an explicit Control chord, and punctuation is layout-safe", () => {
    expect(matchesKey(keyEvent({ key: "Tab", code: "Tab", ctrl: true }), "Ctrl-Tab", "mac")).toBe(true);
    expect(matchesKey(keyEvent({ key: "Tab", code: "Tab", meta: true }), "Ctrl-Tab", "mac")).toBe(false);
    expect(matchesKey(keyEvent({ key: "Tab", code: "Tab", ctrl: true }), "Ctrl-Tab", "other")).toBe(true);
    expect(matchesKey(keyEvent({ key: "+", code: "Equal", meta: true }), "Mod-Equal", "mac")).toBe(true);
    expect(matchesKey(keyEvent({ key: "1", code: "Digit1", meta: true }), "Mod-Digit1", "mac")).toBe(true);
  });

  test("the bindings are the ones the requirement names", () => {
    const app = new Map(APP_KEYBINDINGS.map((binding) => [binding.key, binding.command]));
    expect(app.get("Mod-s")).toBe("file.save");
    expect(app.get("Mod-Shift-s")).toBe("file.saveAs");
    expect(app.get("Mod-Alt-s")).toBe("file.saveAll");
    expect(app.get("Mod-o")).toBe("file.open");
    expect(APP_KEYBINDINGS.find((binding) => binding.key === "Mod-Alt-o")?.label).toBe("Open Folder…");
    expect(app.get("Mod-w")).toBe("file.close");
    expect(app.get("Mod-Shift-w")).toBe("file.closeAll");
    expect(app.get("Ctrl-Tab")).toBe("tab.next");
    expect(app.get("Ctrl-Shift-Tab")).toBe("tab.previous");
    expect(app.get("Mod-Digit9")).toBe("tab.activate9");
    expect(app.get("Alt-z")).toBe("view.toggleWrap");
    expect(app.get("Mod-p")).toBe("quickopen.files");
    expect(app.get("Mod-Shift-p")).toBe("command.palette");
    expect(app.get("Mod-b")).toBe("view.toggleSidebar");
    expect(app.get("Mod-Shift-e")).toBe("view.explorer");
    expect(app.get("Mod-Shift-o")).toBe("view.outline");
    expect(app.get("Mod-Shift-f")).toBe("search.inFiles");
    expect(app.get("Mod-Shift-v")).toBe("preview.toggle");

    const shiftP = keyEvent({ key: "P", code: "KeyP", meta: true, shift: true });
    expect(matchesKey(shiftP, "Mod-p", "mac")).toBe(false);
    expect(matchesKey(shiftP, "Mod-Shift-p", "mac")).toBe(true);

    const editor = new Map(EDITOR_KEYBINDINGS.map((binding) => [binding.key, binding.command]));
    expect(editor.get("Mod-f")).toBe("editor.find");
    expect(editor.get("Mod-h")).toBe("editor.replace");
    expect(editor.get("Mod-g")).toBe("editor.gotoLine");
    expect(editor.get("Mod-Slash")).toBe("editor.toggleComment");
    expect(editor.get("Mod-d")).toBe("editor.nextOccurrence");
    expect(editor.get("Shift-Alt-f")).toBe("editor.formatDocument");
    expect([...editor.values()].some((command) => command.includes("completion"))).toBe(false);
  });

  test("a binding parses into its modifiers and its key", () => {
    expect(parseKey("Mod-Shift-s")).toEqual({
      code: "KeyS",
      mod: true,
      shift: true,
      alt: false,
      ctrl: false,
    });
    expect(parseKey("Ctrl-Tab").code).toBe("Tab");
    expect(parseKey("Mod-BracketLeft").code).toBe("BracketLeft");
  });

  test("the window hears an app chord in the capture phase, before the editor", () => {
    const registrations: Array<{ type: string; capture: boolean }> = [];
    let listener: unknown = null;
    const target = {
      addEventListener(type: string, handler: unknown, options?: boolean | AddEventListenerOptions) {
        registrations.push({
          type,
          capture: typeof options === "boolean" ? options : options?.capture === true,
        });
        listener = handler;
      },
      removeEventListener(type: string, _handler: unknown, options?: boolean | AddEventListenerOptions) {
        registrations.push({
          type: `remove:${type}`,
          capture: typeof options === "boolean" ? options : options?.capture === true,
        });
      },
    };
    const remove = installAppKeymap(
      target as unknown as Window,
      { run: () => undefined },
      "other",
    );
    expect(registrations).toEqual([{ type: "keydown", capture: true }]);
    expect(typeof listener).toBe("function");
    remove();
    expect(registrations[1]).toEqual({ type: "remove:keydown", capture: true });
  });

  test("a key reads the way the platform writes it", () => {
    expect(keyLabel("Mod-s", "mac")).toBe("⌘S");
    expect(keyLabel("Mod-Shift-s", "mac")).toBe("⌘⇧S");
    expect(keyLabel("Mod-Alt-s", "mac")).toBe("⌘⌥S");
    expect(keyLabel("Mod-s", "other")).toBe("Mod+S");
    expect(keyLabel("Ctrl-Shift-Tab", "other")).toBe("Ctrl+Shift+Tab");
    expect(keyLabel("Mod-Equal", "mac")).toBe("⌘+");
    expect(keyLabel("Mod-Digit1", "other")).toBe("Mod+1");
  });
});

describe("the session is remembered carefully, and distrusts what it reads", () => {
  test("settings round-trip, and out-of-range values are clamped", () => {
    const storage = fakeStorage();
    writeSettings(storage, { ...DEFAULT_SETTINGS, fontSize: 16, tabSize: 4, insertSpaces: false });
    expect(readSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, fontSize: 16, tabSize: 4, insertSpaces: false });
    expect(storage.data.get(SETTINGS_STORAGE_KEY)).toContain('"fontSize":16');

    expect(normalizeSettings({ fontSize: 999, tabSize: 0, insertSpaces: "yes", wordWrap: true })).toEqual({
      fontSize: 32,
      tabSize: 1,
      insertSpaces: DEFAULT_SETTINGS.insertSpaces,
      wordWrap: true,
      restoreSession: DEFAULT_SETTINGS.restoreSession,
    });
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test("a damaged store reads as nothing remembered, never as a crash", () => {
    const broken = fakeStorage({ [SETTINGS_STORAGE_KEY]: "{not json", [SESSION_STORAGE_KEY]: "[]" });
    expect(readSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(readSession(broken)).toEqual({
      version: 1,
      workspace: null,
      activePath: null,
      tabs: [],
      recentFolders: [],
      recentFiles: [],
    });

    const throwing: StorageLike = {
      getItem() {
        throw new Error("storage is disabled");
      },
      setItem() {
        throw new Error("storage is disabled");
      },
      removeItem() {
        throw new Error("storage is disabled");
      },
    };
    expect(readSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => writeSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
  });

  test("a session drops bad tabs, duplicates, and an active path that is not open", () => {
    const session = normalizeSession({
      version: 1,
      workspace: "/tmp/work",
      activePath: "/tmp/missing.ts",
      tabs: [
        { path: "/tmp/a.ts", language: "rust", eol: "crlf", topLine: 40, cursorLine: 9, cursorColumn: 3 },
        { path: "/tmp/a.ts", language: null, eol: "lf", topLine: 1, cursorLine: 1, cursorColumn: 1 },
        { path: "   ", language: null, eol: "lf", topLine: 1, cursorLine: 1, cursorColumn: 1 },
        { path: "/tmp/b.ts", language: "klingon", eol: "unix", topLine: 0, cursorLine: 0, cursorColumn: 0 },
        "not a tab",
      ],
      recentFolders: ["/tmp/work", "/tmp/work", 7],
      recentFiles: ["/tmp/a.ts", null],
    });

    expect(session.workspace).toBe("/tmp/work");
    expect(session.activePath).toBeNull();
    expect(session.tabs).toEqual([
      { path: "/tmp/a.ts", language: "rust", eol: "crlf", topLine: 40, cursorLine: 9, cursorColumn: 3 },
      { path: "/tmp/b.ts", language: null, eol: "lf", topLine: 1, cursorLine: 1, cursorColumn: 1 },
    ]);
    expect(session.recentFolders).toEqual(["/tmp/work"]);
    expect(session.recentFiles).toEqual(["/tmp/a.ts"]);
  });

  test("a session round-trips through storage", () => {
    const storage = fakeStorage();
    writeSession(storage, {
      version: 1,
      workspace: "/tmp/work",
      activePath: "/tmp/a.ts",
      tabs: [
        { path: "/tmp/a.ts", language: null, eol: "lf", topLine: 3, cursorLine: 2, cursorColumn: 5 },
      ],
      recentFolders: ["/tmp/work"],
      recentFiles: ["/tmp/a.ts"],
    });
    expect(readSession(storage)).toEqual({
      version: 1,
      workspace: "/tmp/work",
      activePath: "/tmp/a.ts",
      tabs: [
        { path: "/tmp/a.ts", language: null, eol: "lf", topLine: 3, cursorLine: 2, cursorColumn: 5 },
      ],
      recentFolders: ["/tmp/work"],
      recentFiles: ["/tmp/a.ts"],
    });
  });

  test("recent lists move the chosen entry to the front, without duplicates", () => {
    expect(rememberRecent(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
    expect(rememberRecent(["/a", "/b"], "/c", 2)).toEqual(["/c", "/a"]);
    expect(rememberRecent(["/a"], "  ")).toEqual(["/a"]);
  });

  test("the tabs persisted for a session carry the view but never the dirty buffer", () => {
    const tabs = createTabModel();
    const a = tabs.open({ path: "/tmp/a.ts", state: stateOf("a\n", "typescript") });
    const b = tabs.open({ path: "/tmp/b.md", state: stateOf("b\n", "markdown") });
    tabs.remember(a.tab.id, { scrollTop: 320, topLine: 18, cursorLine: 12, cursorColumn: 2 });
    tabs.setLanguage(b.tab.id, "rust", true);
    tabs.setEol(b.tab.id, "crlf");

    const persisted = persistedTabs(tabs.list(), b.tab.id);
    expect(persisted.activePath).toBe("/tmp/b.md");
    expect(persisted.tabs).toEqual([
      { path: "/tmp/a.ts", language: null, eol: "lf", topLine: 18, cursorLine: 12, cursorColumn: 2 },
      { path: "/tmp/b.md", language: "rust", eol: "crlf", topLine: 1, cursorLine: 1, cursorColumn: 1 },
    ]);
    expect(Object.keys(persisted.tabs[0]!).sort()).toEqual([
      "cursorColumn",
      "cursorLine",
      "eol",
      "language",
      "path",
      "topLine",
    ]);
  });

  test("the debounced writer waits for the pause and can be flushed", async () => {
    let calls = 0;
    const write = debounce(() => {
      calls += 1;
    }, 5);
    write();
    write();
    expect(calls).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);

    write();
    write.flush();
    expect(calls).toBe(2);
    write.cancel();
  });
});
