import { createTabModel, describe, detectEol, expect, harness, normalizeEol, stateOf, test, toDiskText } from "../editorSurfaceCommon";
import type { RestorableTab, Tab } from "../editorSurfaceCommon";

describe("the tab model keeps one editor state per file and remembers the view", () => {
  function harness() {
    const tabs = createTabModel();
    const open = (path: string, text: string, language = "text") => {
      const state = stateOf(text, language);
      return tabs.open({ path, state, savedText: text, language: language as Tab["language"] });
    };
    return { tabs, open };
  }

  test("opening the same file twice is one tab, and the second open brings it forward", () => {
    const h = harness();
    const first = h.open("/tmp/a.ts", "const a = 1;\n");
    const second = h.open("/tmp/b.ts", "const b = 2;\n");
    expect(h.tabs.list()).toHaveLength(2);
    expect(h.tabs.activeId()).toBe(second.tab.id);

    const again = h.open("/tmp/a.ts", "ignored");
    expect(again.created).toBe(false);
    expect(again.tab.id).toBe(first.tab.id);
    expect(h.tabs.list()).toHaveLength(2);
    expect(h.tabs.activeId()).toBe(first.tab.id);

    const windows = h.tabs.findPath("C:\\work\\a.ts");
    expect(windows).toBeNull();
    const mixed = h.open("/tmp//a.ts", "x");
    expect(mixed.created).toBe(false);
  });

  test("dirty is a fact about the buffer, not a flag someone set", () => {
    const h = harness();
    const { tab } = h.open("/tmp/a.ts", "one\n");
    expect(h.tabs.dirty(tab)).toBe(false);

    const edited = tab.state.update({ changes: { from: tab.state.doc.length, insert: "two\n" } }).state;
    h.tabs.update(tab.id, edited);
    const afterEdit = h.tabs.active()!;
    expect(h.tabs.dirty(afterEdit)).toBe(true);
    expect(h.tabs.dirtyTabs()).toHaveLength(1);

    h.tabs.markSaved(tab.id, { bytes: 8, modifiedMs: 1234 });
    const afterSave = h.tabs.active()!;
    expect(h.tabs.dirty(afterSave)).toBe(false);
    expect(afterSave.bytes).toBe(8);
    expect(afterSave.modifiedMs).toBe(1234);
  });

  test("scroll and cursor are remembered per tab and forgotten when a tab is closed", () => {
    const h = harness();
    const a = h.open("/tmp/a.ts", Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")).tab;
    const b = h.open("/tmp/b.ts", "b\n").tab;

    h.tabs.remember(a.id, { scrollTop: 640, topLine: 31, cursorLine: 42, cursorColumn: 7 });
    h.tabs.activate(b.id);
    expect(h.tabs.active()!.id).toBe(b.id);
    expect(h.tabs.active()!.view.scrollTop).toBe(0);

    h.tabs.activate(a.id);
    const restored = h.tabs.active()!;
    expect(restored.view.scrollTop).toBe(640);
    expect(restored.view.topLine).toBe(31);
    expect(restored.view.cursorLine).toBe(42);
    expect(restored.view.cursorColumn).toBe(7);

    const closed = h.tabs.close(a.id);
    expect(closed?.id).toBe(b.id);
    const record = h.tabs.takeClosed();
    expect(record?.path).toBe("/tmp/a.ts");
    expect(record !== null && "scrollTop" in record).toBe(false);
  });

  test("closing brings the neighbour forward, and cycling wraps", () => {
    const h = harness();
    const a = h.open("/tmp/a.ts", "a\n").tab;
    const b = h.open("/tmp/b.ts", "b\n").tab;
    const c = h.open("/tmp/c.ts", "c\n").tab;

    h.tabs.activate(b.id);
    expect(h.tabs.close(b.id)?.id).toBe(c.id);
    expect(h.tabs.list().map((tab) => tab.name)).toEqual(["a.ts", "c.ts"]);

    expect(h.tabs.next()?.id).toBe(a.id);
    expect(h.tabs.previous()?.id).toBe(c.id);
    expect(h.tabs.activateIndex(0)?.id).toBe(a.id);
    expect(h.tabs.activateIndex(9)).toBeNull();
  });

  test("close others and close all keep the closed stack for reopening", () => {
    const h = harness();
    const a = h.open("/tmp/a.ts", "a\n").tab;
    h.open("/tmp/b.ts", "b\n");
    h.open("/tmp/c.ts", "c\n");

    h.tabs.closeOthers(a.id);
    expect(h.tabs.list().map((tab) => tab.name)).toEqual(["a.ts"]);
    expect(h.tabs.closedCount()).toBe(2);

    h.tabs.closeAll();
    expect(h.tabs.list()).toHaveLength(0);
    expect(h.tabs.active()).toBeNull();
    expect(h.tabs.closedCount()).toBe(3);
    expect(h.tabs.takeClosed()?.path).toBe("/tmp/a.ts");
  });

  test("a rename re-infers the language unless the human chose one", () => {
    const h = harness();
    const inferred = h.open("/tmp/a.ts", "x\n").tab;
    h.tabs.renamePath(inferred.id, "/tmp/a.rs");
    expect(h.tabs.active()!.language).toBe("rust");
    expect(h.tabs.active()!.name).toBe("a.rs");

    h.tabs.setLanguage(inferred.id, "markdown", true);
    h.tabs.renamePath(inferred.id, "/tmp/a.ts");
    expect(h.tabs.active()!.language).toBe("markdown");
    expect(h.tabs.active()!.languageOverridden).toBe(true);
  });
});

describe("the document flows: open, save, save as, close", () => {
  test("opening reads the file, detects its line endings and normalizes the buffer", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "const a = 1;\r\nconst b = 2;\r\n");
    h.modified.set("/tmp/a.ts", 99);

    const tab = await h.documents.openPath("/tmp/a.ts");

    expect(tab).not.toBeNull();
    expect(tab!.language).toBe("typescript");
    expect(tab!.eol).toBe("crlf");
    expect(tab!.state.doc.toString()).toBe("const a = 1;\nconst b = 2;\n");
    expect(tab!.state.doc.toString().includes("\r")).toBe(false);
    expect(tab!.modifiedMs).toBe(99);
    expect(h.tabs.list()).toHaveLength(1);
    expect(h.log).toEqual(["read:/tmp/a.ts"]);
  });

  test("a failed open is a sentence naming the file, and leaves nothing open", async () => {
    const h = harness();
    h.failRead("permission denied");
    const tab = await h.documents.openPath("/tmp/secret.md");
    expect(tab).toBeNull();
    expect(h.tabs.list()).toHaveLength(0);
    expect(h.errors).toEqual(["Could not open secret.md: permission denied"]);
  });

  test("saving writes the buffer to the file it came from, with the file's EOL", async () => {
    const h = harness();
    h.store.set("/tmp/a.md", "# plan\r\n");
    const tab = (await h.documents.openPath("/tmp/a.md"))!;
    h.log.length = 0;

    const edited = tab.state.update({ changes: { from: 0, insert: "intro\r\n" } }).state;
    h.tabs.update(tab.id, edited);
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(true);

    expect(await h.documents.save(tab.id)).toBe(true);

    expect(h.store.get("/tmp/a.md")).toBe("intro\r\n# plan\r\n");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(false);
    expect(h.tabs.active()!.eol).toBe("crlf");
    expect(h.notes).toEqual(["saved a.md"]);
    expect(h.errors).toEqual([]);
  });

  test("a failed write keeps the tab dirty and says what happened", async () => {
    const h = harness();
    h.store.set("/tmp/a.md", "a\n");
    const tab = (await h.documents.openPath("/tmp/a.md"))!;
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "b" } }).state);
    h.failWrite("the disk is full");

    expect(await h.documents.save(tab.id)).toBe(false);
    expect(h.errors).toEqual(["Could not save a.md: the disk is full"]);
    expect(h.store.get("/tmp/a.md")).toBe("a\n");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(true);
  });

  test("save as writes to the chosen path and keeps writing there", async () => {
    const h = harness();
    h.store.set("/tmp/a.md", "original\n");
    const tab = (await h.documents.openPath("/tmp/a.md"))!;
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "edited\n" } }).state);

    h.pick("/tmp/b.rs");
    expect(await h.documents.saveAs(tab.id)).toBe(true);

    expect(h.store.get("/tmp/b.rs")).toBe("edited\noriginal\n");
    expect(h.store.get("/tmp/a.md")).toBe("original\n");
    expect(h.tabs.active()!.path).toBe("/tmp/b.rs");
    expect(h.tabs.active()!.language).toBe("rust");

    h.tabs.update(
      h.tabs.active()!.id,
      h.tabs.active()!.state.update({ changes: { from: 0, insert: "again\n" } }).state,
    );
    expect(await h.documents.saveActive()).toBe(true);
    expect(h.store.get("/tmp/b.rs")).toBe("again\nedited\noriginal\n");
  });

  test("a completed save writes the same line endings it read, never a mix", () => {
    expect(detectEol("a\r\nb\r\n")).toBe("crlf");
    expect(detectEol("a\nb\n")).toBe("lf");
    expect(detectEol("a\r\nb\n")).toBe("lf");
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
    expect(toDiskText("a\nb\n", "crlf")).toBe("a\r\nb\r\n");
    expect(toDiskText("a\nb\n", "lf")).toBe("a\nb\n");
  });

  test("closing a dirty tab asks first: Cancel keeps it, Don't Save discards the buffer", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "const a = 1;\n");
    const tab = (await h.documents.openPath("/tmp/a.ts"))!;
    h.tabs.update(
      tab.id,
      tab.state.update({ changes: { from: tab.state.doc.length, insert: "const b = 2;\n" } }).state,
    );

    h.answerDialog("cancel");
    expect(await h.documents.close(tab.id)).toBe(false);
    expect(h.tabs.list()).toHaveLength(1);
    expect(h.log.some((entry) => entry.startsWith("ask:a.ts"))).toBe(true);

    h.answerDialog("discard");
    expect(await h.documents.close(tab.id)).toBe(true);
    expect(h.tabs.list()).toHaveLength(0);
    expect(h.store.get("/tmp/a.ts")).toBe("const a = 1;\n");
  });

  test("closing a dirty tab with Save writes it before it goes away", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "one\n");
    const tab = (await h.documents.openPath("/tmp/a.ts"))!;
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "zero\n" } }).state);

    h.answerDialog("save");
    expect(await h.documents.close(tab.id)).toBe(true);
    expect(h.store.get("/tmp/a.ts")).toBe("zero\none\n");
    expect(h.tabs.list()).toHaveLength(0);
  });

  test("a reopened tab comes back clean, at the top, with what was saved", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "saved\n");
    const tab = (await h.documents.openPath("/tmp/a.ts"))!;
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "discarded\n" } }).state);
    h.tabs.remember(tab.id, { scrollTop: 900 });
    h.answerDialog("discard");
    await h.documents.close(tab.id);

    h.documents.reopenClosed();

    const reopened = h.tabs.active()!;
    expect(reopened.path).toBe("/tmp/a.ts");
    expect(reopened.state.doc.toString()).toBe("saved\n");
    expect(reopened.view.scrollTop).toBe(0);
    expect(h.tabs.dirty(reopened)).toBe(false);
    expect(h.tabs.list()).toHaveLength(1);
    expect(h.log.filter((entry) => entry === "read:/tmp/a.ts")).toHaveLength(1);
  });

  test("close all asks once per dirty tab and stops at Cancel", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "a\n");
    h.store.set("/tmp/b.ts", "b\n");
    const a = (await h.documents.openPath("/tmp/a.ts"))!;
    const b = (await h.documents.openPath("/tmp/b.ts"))!;
    h.tabs.update(a.id, a.state.update({ changes: { from: 0, insert: "x" } }).state);
    h.tabs.update(b.id, b.state.update({ changes: { from: 0, insert: "y" } }).state);

    h.answerDialog("save", "cancel");
    expect(await h.documents.closeAll()).toBe(false);
    expect(h.store.get("/tmp/a.ts")).toBe("xa\n");
    expect(h.tabs.list().map((tab) => tab.path)).toEqual(["/tmp/b.ts"]);
  });

  test("save all reports how many files it wrote, and says when there was nothing", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "a\n");
    h.store.set("/tmp/b.ts", "b\n");
    await h.documents.openPath("/tmp/a.ts");
    const b = (await h.documents.openPath("/tmp/b.ts"))!;
    h.tabs.update(b.id, b.state.update({ changes: { from: 0, insert: "y" } }).state);

    expect(await h.documents.saveAll()).toBe(1);
    expect(h.store.get("/tmp/b.ts")).toBe("yb\n");

    expect(await h.documents.saveAll()).toBe(0);
    expect(h.notes[h.notes.length - 1]).toBe("there was nothing to save");
  });

  test("opening through the dialog asks for a file, and a cancel saves nothing", async () => {
    const h = harness();
    h.pick(null);
    await h.documents.openViaDialog();
    expect(h.log).toEqual(["pick:open"]);
    expect(h.notes).toEqual(["nothing was opened"]);

    h.store.set("/tmp/notes.md", "# hi\n");
    h.pick("/tmp/notes.md");
    await h.documents.openViaDialog();
    expect(h.tabs.active()!.path).toBe("/tmp/notes.md");
    expect(h.notes[h.notes.length - 1]).toBe("opened notes.md");
  });

  test("a session restore reopens what is still there and names what is gone", async () => {
    const h = harness();
    h.store.set("/tmp/a.ts", "a\n");
    h.store.set("/tmp/b.ts", "b\n");
    const entries: RestorableTab[] = [
      { path: "/tmp/a.ts", language: null, eol: "lf", topLine: 12, cursorLine: 3, cursorColumn: 4 },
      { path: "/tmp/gone.ts", language: null, eol: "lf", topLine: 1, cursorLine: 1, cursorColumn: 1 },
      { path: "/tmp/b.ts", language: "markdown", eol: "crlf", topLine: 1, cursorLine: 1, cursorColumn: 1 },
    ];

    await h.documents.restore(entries, "/tmp/b.ts");

    expect(h.tabs.list().map((tab) => tab.path)).toEqual(["/tmp/a.ts", "/tmp/b.ts"]);
    expect(h.tabs.active()!.path).toBe("/tmp/b.ts");
    expect(h.tabs.findPath("/tmp/a.ts")!.view.topLine).toBe(12);
    expect(h.tabs.findPath("/tmp/a.ts")!.view.cursorLine).toBe(3);
    expect(h.tabs.findPath("/tmp/b.ts")!.language).toBe("markdown");
    expect(h.tabs.findPath("/tmp/b.ts")!.languageOverridden).toBe(true);
    expect(h.errors[0]).toContain("Could not reopen a file from the last session: gone.ts");
  });
});
