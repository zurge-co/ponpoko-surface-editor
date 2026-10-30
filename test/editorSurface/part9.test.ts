import {
  APP_KEYBINDINGS,
  EDITOR_KEYBINDINGS,
  SETTINGS,
  createTabModel,
  describe,
  detectIndentation,
  expect,
  harness,
  nextUntitledName,
  persistedTabs,
  resolveIndentation,
  searchStateKey,
  stateOf,
  test,
} from "../editorSurfaceCommon";

describe("a new file starts as an untitled buffer", () => {
  test("each new buffer gets its own name and no two share a path", () => {
    const h = harness();
    const first = h.documents.newUntitled();
    const second = h.documents.newUntitled();

    expect(first.path).toBe("");
    expect(first.name).toBe("Untitled-1");
    expect(second.name).toBe("Untitled-2");
    expect(h.tabs.list()).toHaveLength(2);
    expect(h.tabs.activeId()).toBe(second.id);
    expect(h.tabs.dirty(first)).toBe(false);
    expect(first.state.doc.toString()).toBe("");
    expect(first.language).toBe("text");
    expect(h.notes[0]).toContain("Untitled-1");
  });

  test("nextUntitledName skips names that are already open", () => {
    const tabs = createTabModel();
    tabs.open({ path: "", name: "Untitled-1", state: stateOf("") });
    tabs.open({ path: "", name: "Untitled-3", state: stateOf("") });
    expect(nextUntitledName(tabs.list())).toBe("Untitled-2");

    tabs.open({ path: "", name: "Untitled-2", state: stateOf("") });
    expect(nextUntitledName(tabs.list())).toBe("Untitled-4");
  });

  test("Save on an untitled buffer asks where it goes, then it is an ordinary file", async () => {
    const h = harness();
    const tab = h.documents.newUntitled();
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "hello\n" } }).state);
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(true);

    h.pick("/tmp/hello.txt");
    expect(await h.documents.save(tab.id)).toBe(true);

    expect(h.log).toContain("pick:save");
    expect(h.store.get("/tmp/hello.txt")).toBe("hello\n");
    expect(h.tabs.active()!.path).toBe("/tmp/hello.txt");
    expect(h.tabs.active()!.name).toBe("hello.txt");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(false);
    expect(h.tabs.findPath("/tmp/hello.txt")!.id).toBe(tab.id);
  });

  test("a closed untitled buffer comes back with its name, still unsaved", async () => {
    const h = harness();
    const tab = h.documents.newUntitled();
    expect(await h.documents.close(tab.id)).toBe(true);
    expect(h.tabs.list()).toHaveLength(0);

    h.documents.reopenClosed();

    expect(h.tabs.active()!.path).toBe("");
    expect(h.tabs.active()!.name).toBe("Untitled-1");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(false);
  });

  test("an untitled buffer is left out of the session instead of coming back empty", () => {
    const tabs = createTabModel();
    tabs.open({ path: "/tmp/a.ts", state: stateOf("a") });
    const untitled = tabs.open({ path: "", name: "Untitled-1", state: stateOf("") });

    const persisted = persistedTabs(tabs.list(), untitled.tab.id);

    expect(persisted.tabs.map((entry) => entry.path)).toEqual(["/tmp/a.ts"]);
    expect(persisted.activePath).toBeNull();
  });
});

describe("Revert File reads the disk and throws the buffer away", () => {
  test("a dirty tab asks first, then reloads the file as it is on disk", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "one\n");
    const tab = (await h.documents.openPath("/tmp/a.txt"))!;
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "mine\n" } }).state);
    h.externalWrite("/tmp/a.txt", "theirs\n");

    expect(await h.documents.revert(tab.id)).toBe(true);

    expect(h.tabs.active()!.state.doc.toString()).toBe("theirs\n");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(false);
    expect(h.notes.at(-1)).toContain("reloaded from disk");
  });

  test("Cancel keeps the buffer exactly as it was", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "one\n");
    const tab = (await h.documents.openPath("/tmp/a.txt"))!;
    const mine = tab.state.update({ changes: { from: 0, insert: "mine\n" } }).state;
    h.tabs.update(tab.id, mine);
    h.externalWrite("/tmp/a.txt", "theirs\n");
    h.answerConfirm(false);

    expect(await h.documents.revert(tab.id)).toBe(false);

    expect(h.tabs.active()!.state.doc.toString()).toBe("mine\none\n");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(true);
    expect(h.notes.at(-1)).toBe("nothing was reverted");
  });

  test("a clean tab follows the disk without a question", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "one\n");
    const tab = (await h.documents.openPath("/tmp/a.txt"))!;
    h.externalWrite("/tmp/a.txt", "two\n");

    expect(await h.documents.revert(tab.id)).toBe(true);
    expect(h.tabs.active()!.state.doc.toString()).toBe("two\n");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(false);
  });

  test("a file rewritten with CRLF comes back normalized, and the tab follows its new EOL", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "one\n");
    const tab = (await h.documents.openPath("/tmp/a.txt"))!;
    expect(tab.eol).toBe("lf");

    h.externalWrite("/tmp/a.txt", "x\r\ny\r\n");
    expect(await h.documents.revert(tab.id)).toBe(true);

    expect(h.tabs.active()!.state.doc.toString()).toBe("x\ny\n");
    expect(h.tabs.active()!.eol).toBe("crlf");
  });

  test("an untitled buffer says there is nothing on disk to go back to", async () => {
    const h = harness();
    const tab = h.documents.newUntitled();

    expect(await h.documents.revert(tab.id)).toBe(false);
    expect(h.notes.at(-1)).toContain("nothing on disk");
  });
});

describe("Save As never leaves two tabs on one file", () => {
  test("a clean tab already on the target yields to the saved tab", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "A\n");
    h.store.set("/tmp/b.txt", "B\n");
    const a = (await h.documents.openPath("/tmp/a.txt"))!;
    await h.documents.openPath("/tmp/b.txt");
    expect(h.tabs.list()).toHaveLength(2);

    h.pick("/tmp/b.txt");
    expect(await h.documents.saveAs(a.id)).toBe(true);

    expect(h.store.get("/tmp/b.txt")).toBe("A\n");
    expect(h.tabs.list().map((tab) => tab.path)).toEqual(["/tmp/b.txt"]);
    expect(h.tabs.activeId()).toBe(a.id);
  });

  test("a dirty tab on the target is not stranded", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "A\n");
    h.store.set("/tmp/b.txt", "B\n");
    const a = (await h.documents.openPath("/tmp/a.txt"))!;
    const b = (await h.documents.openPath("/tmp/b.txt"))!;
    h.tabs.update(b.id, b.state.update({ changes: { from: 0, insert: "unsaved\n" } }).state);

    h.pick("/tmp/b.txt");
    expect(await h.documents.saveAs(a.id)).toBe(false);

    expect(h.errors.at(-1)).toContain("already open in another tab");
    expect(h.store.get("/tmp/b.txt")).toBe("B\n");
    expect(h.tabs.list()).toHaveLength(2);
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(true);
  });
});

describe("the new commands are reachable from the keyboard and the palette", () => {
  test("Cmd+N is New File and the multi-cursor chords exist", () => {
    const app = new Map(APP_KEYBINDINGS.map((binding) => [binding.key, binding.command]));
    expect(app.get("Mod-n")).toBe("file.new");

    const editor = new Map(EDITOR_KEYBINDINGS.map((binding) => [binding.key, binding.command]));
    expect(editor.get("Mod-Alt-ArrowUp")).toBe("editor.addCursorAbove");
    expect(editor.get("Mod-Alt-ArrowDown")).toBe("editor.addCursorBelow");
    expect(editor.get("Mod-Shift-l")).toBe("editor.selectAllOccurrences");
    expect(editor.get("Shift-Alt-a")).toBe("editor.toggleBlockComment");
  });

  test("the Replace All guard treats every search option as part of the query", () => {
    const base = {
      query: "x",
      replacement: "",
      regex: false,
      caseSensitive: false,
      wholeWord: false,
      includeHidden: false,
    };
    expect(searchStateKey({ ...base })).toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, regex: true })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, caseSensitive: true })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, wholeWord: true })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, includeHidden: true })).not.toBe(searchStateKey(base));
  });
});

describe("a file keeps the indentation it already uses", () => {
  test("four spaces, two spaces and tabs are read from the text", () => {
    const four = ["    one", "        two", "            three"].join("\n");
    expect(detectIndentation(four)).toEqual({ tabSize: 4, insertSpaces: true });

    const two = ["  one", "    two", "      three"].join("\n");
    expect(detectIndentation(two)).toEqual({ tabSize: 2, insertSpaces: true });

    const tabs = ["\tone", "\t\ttwo", "\t\t\tthree"].join("\n");
    expect(detectIndentation(tabs)).toEqual({ tabSize: null, insertSpaces: false });
  });

  test("too little evidence is left to the editor's settings", () => {
    expect(detectIndentation("  one\n    two\n")).toBeNull();
    expect(detectIndentation("no indentation here\nat all\n")).toBeNull();
    expect(detectIndentation("\tone\n  two\n\tthree\n  four\n")).toBeNull();

    expect(resolveIndentation("  one\n    two\n", SETTINGS)).toEqual({
      tabSize: 2,
      insertSpaces: true,
      detected: false,
      settings: SETTINGS,
    });
  });

  test("opening a four-space file gives that tab its own width", async () => {
    const h = harness();
    h.store.set(
      "/tmp/a.ts",
      "function f() {\n    if (x) {\n        return 1;\n    }\n    return 2;\n}\n",
    );

    const tab = (await h.documents.openPath("/tmp/a.ts"))!;

    expect(tab.tabSize).toBe(4);
    expect(tab.insertSpaces).toBe(true);
    expect(tab.indentationDetected).toBe(true);
    expect(h.tabs.active()!.tabSize).toBe(4);
  });

  test("an ambiguous file keeps the editor's setting and says it is not detected", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "  one\n");

    const tab = (await h.documents.openPath("/tmp/a.txt"))!;

    expect(tab.tabSize).toBe(SETTINGS.tabSize);
    expect(tab.insertSpaces).toBe(SETTINGS.insertSpaces);
    expect(tab.indentationDetected).toBe(false);
  });

  test("an indentation chosen for a file is kept when the disk is read again", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "function f() {\n    if (x) {\n        return 1;\n    }\n    return 2;\n}\n");
    const tab = (await h.documents.openPath("/tmp/a.ts"))!;
    expect(tab.indentationDetected).toBe(true);

    h.documents.setIndentation(tab.id, 3, true);
    const chosen = h.tabs.active()!;
    expect(chosen.tabSize).toBe(3);
    expect(chosen.insertSpaces).toBe(true);
    expect(chosen.indentationDetected).toBe(false);
    expect(chosen.indentationPinned).toBe(true);
    expect(h.notes.at(-1)).toContain("for this file");

    h.externalWrite("/tmp/a.ts", "\tone\n\t\ttwo\n\t\t\tthree\n");
    expect(await h.documents.revert(tab.id)).toBe(true);

    expect(h.tabs.active()!.tabSize).toBe(3);
    expect(h.tabs.active()!.insertSpaces).toBe(true);
    expect(h.tabs.active()!.indentationPinned).toBe(true);
  });

  test("Revert reads the indentation of the file on disk as well", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "function f() {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\n");
    const tab = (await h.documents.openPath("/tmp/a.ts"))!;
    expect(tab.tabSize).toBe(2);

    h.externalWrite(
      "/tmp/a.ts",
      "function f() {\n    if (x) {\n        return 1;\n    }\n    return 2;\n}\n",
    );
    expect(await h.documents.revert(tab.id)).toBe(true);

    expect(h.tabs.active()!.tabSize).toBe(4);
    expect(h.tabs.active()!.indentationDetected).toBe(true);
  });
});
