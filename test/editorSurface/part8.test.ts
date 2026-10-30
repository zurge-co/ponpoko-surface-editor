import {
  SURFACE_BRIDGE_CHANNEL,
  VIEW,
  createOps,
  describe,
  expect,
  fakeHost,
  link,
  settle,
  test,
} from "../editorSurfaceCommon";

const { createPasteDoor } = await import("../../src/ui/explorer/paste");
const { pasteItems, pathItems } = await import("../../src/paste");
const { dropPaths } = await import("../../src/bridge");

type Item = { kind: string; name: string; base64?: string; path?: string };

function answer(overrides: Record<string, unknown> = {}) {
  return {
    kind: "nothing",
    name: "",
    mime: "",
    bytes: 0,
    base64: "",
    paths: [] as string[],
    text: "",
    ...overrides,
  };
}

type Call = { call: string; path: string; detail?: string };

function fakeFs(calls: Call[]) {
  return {
    list: async () => ({ path: "/w", entries: [] }),
    create: async (path: string, kind: string) => {
      calls.push({ call: `create:${kind}`, path });
      return { path, exists: true, is_file: kind === "file", is_dir: kind === "directory", bytes: 0 };
    },
    rename: async () => {
      throw new Error("rename is not part of a paste");
    },
    remove: async () => {
      throw new Error("delete is not part of a paste");
    },
    stat: async (path: string) => ({
      path,
      exists: false,
      is_file: false,
      is_dir: false,
      bytes: 0,
      modified_ms: 0,
    }),
    reveal: async () => ({ revealed: true }),
    writeAsset: async (path: string, base64: string) => {
      calls.push({ call: "writeAsset", path, detail: base64 });
      return { path, bytes: base64.length };
    },
    copy: async (from: string, to: string) => {
      calls.push({ call: "copy", path: to, detail: from });
      return { from, to, is_dir: false, bytes: 0, files: 1 };
    },
  };
}

function fakeElement(classes: Set<string> = new Set()) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const element = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((kept) => kept !== handler));
    },
    classList: {
      add: (name: string) => classes.set(name, true),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, on?: boolean) => {
        if (on === false) classes.delete(name);
        else classes.set(name, true);
      },
    },
  };
  const fire = (type: string, event: unknown) =>
    [...(listeners.get(type) ?? [])].forEach((handler) => handler(event));
  return { element: element as unknown as HTMLElement, fire, listeners, classes };
}

function doorOver(options: {
  calls: Call[];
  existing?: string[];
  answer?: Record<string, unknown>;
  root?: string | null;
  target?: string | null;
  element?: ReturnType<typeof fakeElement>;
  onRead?: () => void;
}) {
  const notes: string[] = [];
  const errors: string[] = [];
  const calls = options.calls;
  const fs = fakeFs(calls);
  const root = options.root === undefined ? "/w" : options.root;
  const target = options.target === undefined ? root : options.target;
  const ops = createOps({
    deps: {
      fs,
      root: () => root,
      activePath: () => null,
      openFile: () => undefined,
      askName: async () => null,
      confirm: async () => true,
      onRenamed: () => undefined,
      onDeleted: () => undefined,
      onReveal: () => undefined,
      onCopyPath: () => undefined,
      onError: (message: string) => errors.push(message),
      onNote: (message: string) => notes.push(message),
    },
    expanded: new Set<string>(),
    root: () => root,
    selected: () => null,
    select: () => undefined,
    selectedRow: () => null,
    targetDirectory: () => target,
    siblingsOf: (folder: string) => (folder === target ? (options.existing ?? []) : []),
    refresh: async () => undefined,
    focusRow: () => undefined,
    remap: () => undefined,
    forget: () => undefined,
  });

  const drops: Array<(paths: readonly string[]) => void> = [];
  const ui = options.element ?? fakeElement();
  const pasteDoor = createPasteDoor({
    element: ui.element,
    read: async () => {
      options.onRead?.();
      return answer(options.answer ?? {});
    },
    onDrop: (handler) => {
      drops.push(handler);
      return () => {
        const index = drops.indexOf(handler);
        if (index >= 0) drops.splice(index, 1);
      };
    },
    root: () => root,
    target: () => target,
    transfer: (items) => ops.transfer(items),
    onNote: (message: string) => notes.push(message),
    onError: (message: string) => errors.push(message),
  });
  return {
    pasteDoor,
    notes,
    errors,
    ui,
    drop: (paths: readonly string[]) => drops.forEach((handler) => handler(paths)),
    liveDrops: () => drops.length,
  };
}

describe("the surface asks the host for the clipboard instead of reading it itself", () => {
  test("⌘V in the explorer is one tool.paste call on the wire, and nothing else", async () => {
    const host = fakeHost();
    const surface = link(host);

    const reading = surface.paste();
    expect(host.posted).toHaveLength(1);
    expect(host.posted[0]).toEqual({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      verb: "tool.paste",
      payload: {},
    });

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: answer({ kind: "image", name: "pasted-image-1.png", mime: "image/png", base64: "iVBORw==" }),
    });
    await expect(reading).resolves.toMatchObject({ kind: "image", base64: "iVBORw==" });
  });

  test("a host that refuses the clipboard is an error the explorer can say out loud", async () => {
    const host = fakeHost();
    const surface = link(host);

    const reading = surface.paste();
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: false,
      error: "the clipboard handed over bytes that are not a PNG",
    });
    await expect(reading).rejects.toThrow("not a PNG");
  });

  test("a payload that is not a paste answer is nothing to paste, never a half-paste", async () => {
    const host = fakeHost();
    const surface = link(host);

    for (const result of [null, "file", { kind: "screenshot" }, { kind: "file", paths: "not a list" }]) {
      const reading = surface.paste();
      const posted = host.posted[host.posted.length - 1]!;
      host.deliver({ channel: SURFACE_BRIDGE_CHANNEL, view: VIEW, id: posted.id, ok: true, result });
      const settled = await reading;
      expect(settled.paths).toEqual([]);
      expect(settled.base64).toBe("");
      expect(settled.text).toBe("");
      expect(pasteItems(settled)).toEqual([]);
    }
  });
});

describe("what the host hands over becomes the items the explorer writes", () => {
  test("an image paste is one asset holding the host's own bytes", () => {
    const items = pasteItems(answer({ kind: "image", name: "shot.png", base64: "iVBORw==" })) as Item[];
    expect(items).toEqual([{ kind: "asset", name: "shot.png", base64: "iVBORw==" }]);
  });

  test("a file paste is one path per file, so the bytes never cross into the page", () => {
    const items = pasteItems(
      answer({ kind: "file", paths: ["/Users/saint/a.txt", "/Users/saint/proj"] }),
    ) as Item[];
    expect(items.map((item) => item.kind)).toEqual(["path", "path"]);
    expect(items.map((item) => item.name)).toEqual(["a.txt", "proj"]);
    expect(items.map((item) => item.path)).toEqual(["/Users/saint/a.txt", "/Users/saint/proj"]);
  });

  test("a text paste keeps its chars, and an unnamed paste still gets a name", () => {
    const items = pasteItems(answer({ kind: "text", text: "สวัสดี" })) as Item[];
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("asset");
    expect(items[0]!.name).toBe("pasted.txt");
    expect(Buffer.from(items[0]!.base64!, "base64").toString("utf8")).toBe("สวัสดี");
  });

  test("nothing on the clipboard is nothing to write, and blank paths are not files", () => {
    expect(pasteItems(answer())).toEqual([]);
    expect(pasteItems(answer({ kind: "image" }))).toEqual([]);
    expect(pasteItems(answer({ kind: "text" }))).toEqual([]);
    expect(pasteItems(answer({ kind: "file", paths: [] }))).toEqual([]);
    expect(pathItems(["", "/a", ""])).toEqual([{ kind: "path", name: "a", path: "/a" }]);
    expect(dropPaths({ paths: ["", "/a", 4] })).toEqual(["/a"]);
    expect(dropPaths(null)).toEqual([]);
    expect(dropPaths({ paths: "nope" })).toEqual([]);
  });
});

describe("the paste door writes real files and never overwrites", () => {
  test("⌘V with an image on the clipboard writes the host's bytes into the selected folder", async () => {
    const calls: Call[] = [];
    const { pasteDoor, notes, errors } = doorOver({
      calls,
      answer: { kind: "image", name: "shot.png", base64: "iVBORw==" },
    });

    await pasteDoor.pasteFromClipboard();
    expect(calls).toEqual([{ call: "writeAsset", path: "/w/shot.png", detail: "iVBORw==" }]);
    expect(errors).toEqual([]);
    expect(notes).toEqual(["pasted 1 item"]);
  });

  test("a file on the clipboard is copied by the backend, so a huge file never enters the page", async () => {
    const calls: Call[] = [];
    const { pasteDoor } = doorOver({
      calls,
      answer: { kind: "file", paths: ["/Users/saint/big.iso"] },
    });

    await pasteDoor.pasteFromClipboard();
    expect(calls).toEqual([{ call: "copy", path: "/w/big.iso", detail: "/Users/saint/big.iso" }]);
  });

  test("a name already in the folder becomes the next free one — both for a paste and a drop", async () => {
    const calls: Call[] = [];
    const { pasteDoor, drop } = doorOver({
      calls,
      existing: ["shot.png", "notes.txt"],
      answer: { kind: "image", name: "shot.png", base64: "iVBORw==" },
    });

    await pasteDoor.pasteFromClipboard();
    drop(["/Users/saint/notes.txt"]);
    await settle();

    expect(calls).toEqual([
      { call: "writeAsset", path: "/w/shot (2).png", detail: "iVBORw==" },
      { call: "copy", path: "/w/notes (2).txt", detail: "/Users/saint/notes.txt" },
    ]);
    expect(calls.some((call) => call.path === "/w/shot.png")).toBe(false);
    expect(calls.some((call) => call.path === "/w/notes.txt")).toBe(false);
  });

  test("a drop from Finder lands in the selected folder as a copy of each path", async () => {
    const calls: Call[] = [];
    const { drop } = doorOver({ calls, target: "/w/src" });

    drop(["/Users/saint/a.txt", "/Users/saint/proj"]);
    await settle();

    expect(calls).toEqual([
      { call: "copy", path: "/w/src/a.txt", detail: "/Users/saint/a.txt" },
      { call: "copy", path: "/w/src/proj", detail: "/Users/saint/proj" },
    ]);
  });

  test("with no folder open nothing is asked of the host and nothing is written", async () => {
    const calls: Call[] = [];
    let asked = 0;
    const element = fakeElement();
    const ops = createOps({
      deps: {
        fs: fakeFs(calls),
        root: () => null,
        activePath: () => null,
        openFile: () => undefined,
        askName: async () => null,
        confirm: async () => true,
        onRenamed: () => undefined,
        onDeleted: () => undefined,
        onReveal: () => undefined,
        onCopyPath: () => undefined,
        onError: () => undefined,
        onNote: () => undefined,
      },
      expanded: new Set<string>(),
      root: () => null,
      selected: () => null,
      select: () => undefined,
      selectedRow: () => null,
      targetDirectory: () => null,
      siblingsOf: () => [],
      refresh: async () => undefined,
      focusRow: () => undefined,
      remap: () => undefined,
      forget: () => undefined,
    });
    const notes: string[] = [];
    const drops: Array<(paths: readonly string[]) => void> = [];
    const pasteDoor = createPasteDoor({
      element: element.element,
      read: async () => {
        asked += 1;
        return answer({ kind: "image", name: "shot.png", base64: "iVBORw==" });
      },
      onDrop: (handler) => {
        drops.push(handler);
        return () => undefined;
      },
      root: () => null,
      target: () => null,
      transfer: (items) => ops.transfer(items),
      onNote: (message: string) => notes.push(message),
      onError: () => undefined,
    });

    await pasteDoor.pasteFromClipboard();
    expect(asked).toBe(0);
    expect(calls).toEqual([]);
    expect(notes).toEqual(["Open a folder first"]);
  });

  test("a clipboard the host cannot read is a sentence, and the tree is left alone", async () => {
    const calls: Call[] = [];
    const element = fakeElement();
    const errors: string[] = [];
    const pasteDoor = createPasteDoor({
      element: element.element,
      read: async () => {
        throw new Error("no clipboard access on this machine");
      },
      onDrop: () => () => undefined,
      root: () => "/w",
      target: () => "/w",
      transfer: async () => undefined,
      onNote: () => undefined,
      onError: (message: string) => errors.push(message),
    });

    await pasteDoor.pasteFromClipboard();
    expect(calls).toEqual([]);
    expect(errors).toEqual(["Could not read the clipboard: no clipboard access on this machine"]);
  });

  test("⌘V pressed over the tree writes the clipboard's file into the selected folder", async () => {
    const calls: Call[] = [];
    const { ui, notes } = doorOver({ calls, target: "/w/src" });

    let prevented = 0;
    ui.fire("paste", {
      target: { tagName: "DIV", isContentEditable: false },
      clipboardData: {
        types: ["Files"],
        files: [{ name: "shot.png" }],
        items: [
          {
            kind: "file",
            webkitGetAsEntry: () => null,
            getAsFile: () => ({
              name: "shot.png",
              arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            }),
          },
        ],
        getData: () => "",
      },
      preventDefault: () => {
        prevented += 1;
      },
    });
    await settle();

    expect(prevented).toBe(1);
    expect(calls).toEqual([{ call: "writeAsset", path: "/w/src/shot.png", detail: "AQID" }]);
    expect(notes).toEqual(["pasted 1 item"]);
  });

  test("⌘V with a screenshot on the clipboard asks the host, then writes its bytes", async () => {
    const calls: Call[] = [];
    let asked = 0;
    const { ui, notes, errors } = doorOver({
      calls,
      answer: { kind: "image", name: "shot.png", base64: "iVBORw==" },
      onRead: () => {
        asked += 1;
      },
    });

    let prevented = 0;
    ui.fire("paste", {
      target: { tagName: "DIV", isContentEditable: false },
      clipboardData: { types: [], files: [], items: [], getData: () => "" },
      preventDefault: () => {
        prevented += 1;
      },
    });
    await settle();

    expect(asked).toBe(1);
    expect(prevented).toBe(1);
    expect(calls).toEqual([{ call: "writeAsset", path: "/w/shot.png", detail: "iVBORw==" }]);
    expect(errors).toEqual([]);
    expect(notes).toEqual(["pasted 1 item"]);
  });

  test("⌘V typed into a name field stays in the field instead of pasting into the tree", async () => {
    const calls: Call[] = [];
    const { ui, pasteDoor } = doorOver({ calls, answer: { kind: "image", name: "shot.png", base64: "x" } });

    const field = { tagName: "INPUT", isContentEditable: false };
    let prevented = 0;
    ui.fire("paste", {
      target: field,
      clipboardData: { items: [], files: [], getData: () => "" },
      preventDefault: () => {
        prevented += 1;
      },
    });
    await settle();

    expect(prevented).toBe(0);
    expect(calls).toEqual([]);
    expect(typeof pasteDoor.pasteFromClipboard).toBe("function");
  });

  test("detaching a destroyed explorer leaves no drop listener behind", () => {
    const { pasteDoor, liveDrops, drop } = doorOver({ calls: [], answer: answer() });
    expect(liveDrops()).toBe(1);
    pasteDoor.detach();
    expect(liveDrops()).toBe(0);
    expect(() => drop(["/a"])).not.toThrow();
  });
});
