import {
  ASSET_IMAGE_EXTENSIONS,
  describe,
  expect,
  harness,
  isAssetPath,
  settle,
  test,
} from "../editorSurfaceCommon";

describe("a binary image opens as a read-only tab, not as broken text", () => {
  test("png, jpg, gif and the rest of the image formats are assets; svg is text", () => {
    for (const extension of ASSET_IMAGE_EXTENSIONS) {
      expect(isAssetPath(`/tmp/picture.${extension}`)).toBe(true);
    }
    expect(isAssetPath("/tmp/picture.PNG")).toBe(true);
    // SVG is XML: it opens in the editor and is also previewable.
    expect(isAssetPath("/tmp/icon.svg")).toBe(false);
    expect(isAssetPath("/tmp/notes.md")).toBe(false);
    expect(isAssetPath("/tmp/no-extension")).toBe(false);
  });

  test("opening a PNG reads no text, keeps the file's size, and says what it is", async () => {
    const h = harness();
    h.store.set("/tmp/pic.png", "PNGDATA");

    const tab = (await h.documents.openPath("/tmp/pic.png"))!;

    expect(tab.asset).toBe(true);
    expect(tab.bytes).toBe(7);
    expect(tab.path).toBe("/tmp/pic.png");
    expect(tab.state.doc.toString()).toBe("");
    expect(h.tabs.dirty(tab)).toBe(false);
    expect(h.log.some((entry) => entry.startsWith("read:"))).toBe(false);
    expect(h.notes.at(-1)).toContain("read-only");
  });

  test("an svg still opens as text and is read through fs.read", async () => {
    const h = harness();
    h.store.set("/tmp/icon.svg", "<svg></svg>");

    const tab = (await h.documents.openPath("/tmp/icon.svg"))!;

    expect(tab.asset).toBe(false);
    expect(tab.state.doc.toString()).toBe("<svg></svg>");
    expect(h.log).toContain("read:/tmp/icon.svg");
  });

  test("Save and Save As refuse to write an image, and Save As never opens a picker", async () => {
    const h = harness();
    h.store.set("/tmp/pic.png", "PNGDATA");
    const tab = (await h.documents.openPath("/tmp/pic.png"))!;

    expect(await h.documents.save(tab.id)).toBe(false);
    expect(await h.documents.saveAs(tab.id)).toBe(false);

    expect(h.errors.at(-1)).toContain("image");
    expect(h.log.some((entry) => entry.startsWith("pick:"))).toBe(false);
    expect(h.log.some((entry) => entry.startsWith("write:"))).toBe(false);
    expect([...h.store.keys()]).toEqual(["/tmp/pic.png"]);
  });

  test("Revert on an image says the preview follows the disk without throwing the pane away", async () => {
    const h = harness();
    h.store.set("/tmp/pic.png", "PNGDATA");
    const tab = (await h.documents.openPath("/tmp/pic.png"))!;

    expect(await h.documents.revert(tab.id)).toBe(false);
    expect(h.notes.at(-1)).toContain("preview");
  });

  test("when an image changes on disk, reconcile refreshes its size instead of reading it as text", async () => {
    const h = harness();
    h.store.set("/tmp/pic.png", "one");
    const tab = (await h.documents.openPath("/tmp/pic.png"))!;
    expect(tab.bytes).toBe(3);

    h.externalWrite("/tmp/pic.png", "two-longer");

    expect(await h.documents.reconcile(tab.id)).toBe("reloaded");
    expect(h.tabs.active()!.bytes).toBe(10);
    expect(h.notes.at(-1)).toContain("changed on disk");
    expect(h.errors).toHaveLength(0);
    expect(h.log.some((entry) => entry.startsWith("read:"))).toBe(false);
  });

  test("a reopened image tab follows what is on disk while it was closed", async () => {
    const h = harness();
    h.store.set("/tmp/pic.png", "one");
    const tab = (await h.documents.openPath("/tmp/pic.png"))!;
    expect(await h.documents.close(tab.id)).toBe(true);

    h.externalWrite("/tmp/pic.png", "changed");
    h.documents.reopenClosed();
    await settle();

    const reopened = h.tabs.active()!;
    expect(reopened.asset).toBe(true);
    expect(reopened.bytes).toBe(7);
    expect(h.notes.at(-1)).toContain("changed on disk");
  });

  test("a session restores an image tab as an image tab", async () => {
    const h = harness();
    h.store.set("/tmp/pic.png", "PNGDATA");

    await h.documents.restore(
      [
        {
          path: "/tmp/pic.png",
          language: null,
          eol: "lf",
          topLine: 1,
          cursorLine: 1,
          cursorColumn: 1,
        },
      ],
      "/tmp/pic.png",
    );

    expect(h.tabs.active()!.asset).toBe(true);
    expect(h.tabs.active()!.bytes).toBe(7);
  });

  test("a missing image is a sentence, not an empty tab", async () => {
    const h = harness();

    expect(await h.documents.openPath("/tmp/gone.png")).toBeNull();
    expect(h.tabs.list()).toHaveLength(0);
    expect(h.errors.at(-1)).toContain("gone.png");
  });
});

describe("a saved file is one the human can come back to", () => {
  test("the path a Save As writes is reported as saved, so it can join the recent list", async () => {
    const h = harness();
    const tab = h.documents.newUntitled();
    h.tabs.update(tab.id, tab.state.update({ changes: { from: 0, insert: "hello\n" } }).state);

    h.pick("/tmp/hello.txt");
    expect(await h.documents.save(tab.id)).toBe(true);
    expect(h.saved).toEqual(["/tmp/hello.txt"]);
  });
});

describe("reopening a closed text tab asks the disk again", () => {
  test("a clean tab closed while its file was rewritten comes back with the file on disk", async () => {
    const h = harness();
    h.store.set("/tmp/a.txt", "before\n");
    const tab = (await h.documents.openPath("/tmp/a.txt"))!;
    expect(await h.documents.close(tab.id)).toBe(true);

    h.externalWrite("/tmp/a.txt", "after\n");
    h.documents.reopenClosed();
    await settle();

    expect(h.tabs.active()!.state.doc.toString()).toBe("after\n");
    expect(h.tabs.dirty(h.tabs.active()!)).toBe(false);
    expect(h.notes.at(-1)).toContain("changed on disk");
  });
});
