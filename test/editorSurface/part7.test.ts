import {
  SURFACE_BRIDGE_CHANNEL,
  VIEW,
  assignNames,
  attachTransfer,
  bytesToBase64,
  countItems,
  createApi,
  createOps,
  declaredMethods,
  describe,
  entriesToItems,
  expect,
  fakeHost,
  link,
  pasteDirectory,
  pathsFromUriList,
  settle,
  test,
  uniqueName,
} from "../editorSurfaceCommon";

type Item = { kind: string; name: string; bytes?: Uint8Array; children?: Item[]; path?: string };

describe("pasting files and folders into the folder tree", () => {
  test("a name that is already there becomes the next free one, keeping its extension", () => {
    expect(uniqueName("notes.txt", [])).toBe("notes.txt");
    expect(uniqueName("notes.txt", ["notes.txt"])).toBe("notes (2).txt");
    expect(uniqueName("notes.txt", ["notes.txt", "notes (2).txt"])).toBe("notes (3).txt");
    expect(uniqueName("notes", ["notes"])).toBe("notes (2)");
    expect(uniqueName("README.md", ["readme.md"])).toBe("README (2).md");
    expect(uniqueName(".env", [".env"])).toBe(".env (2)");
    expect(uniqueName("a.b.c", ["a.b.c"])).toBe("a.b (2).c");
  });

  test("two files with one name in the same paste never land on the same path", () => {
    const files: Item[] = ["a.txt", "a.txt", "b.txt"].map((name) => ({
      kind: "file",
      name,
      bytes: new Uint8Array([1]),
    }));
    const assigned = assignNames(files as never, ["a.txt"]);
    const names = assigned.map((entry) => entry.name);
    expect(names).toEqual(["a (2).txt", "a (3).txt", "b.txt"]);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
  });

  test("every byte survives the trip through base64", () => {
    const bytes = new Uint8Array(512).map((_, index) => index % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
    expect(bytesToBase64(new TextEncoder().encode("สวัสดี"))).toBe(
      Buffer.from("สวัสดี").toString("base64"),
    );
  });

  test("a paste lands in the selected folder, in its parent, or in the open folder", () => {
    expect(pasteDirectory("/w", { path: "/w/src", isDir: true })).toBe("/w/src");
    expect(pasteDirectory("/w", { path: "/w/src/a.ts", isDir: false })).toBe("/w/src");
    expect(pasteDirectory("/w", null)).toBe("/w");
    expect(pasteDirectory(null, { path: "/w/src", isDir: true })).toBeNull();
  });

  test("only file uris become paths, and escapes and repeats are handled", () => {
    const list = [
      "file:///Users/saint/a%20b.txt",
      "https://example.com/x.txt",
      "",
      "# a comment",
      "file:///Users/saint/a%20b.txt",
    ].join("\r\n");
    expect(pathsFromUriList(list)).toEqual(["/Users/saint/a b.txt"]);
  });
});

type Call = { call: string; path: string; detail?: string };

function fakeFs(calls: Call[], store: Map<string, string>) {
  return {
    list: async () => ({ path: "/w", entries: [] }),
    create: async (path: string, kind: string) => {
      calls.push({ call: `create:${kind}`, path });
      store.set(path, "");
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
      store.set(path, base64);
      return { path, bytes: base64.length };
    },
    copy: async (from: string, to: string) => {
      calls.push({ call: "copy", path: to, detail: from });
      return { from, to, is_dir: false, bytes: 0, files: 1 };
    },
  };
}

function opsWith(fs: ReturnType<typeof fakeFs>, existing: string[]) {
  const notes: string[] = [];
  const errors: string[] = [];
  const expanded = new Set<string>();
  const ops = createOps({
    deps: {
      fs,
      root: () => "/w",
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
    expanded,
    root: () => "/w",
    selected: () => null,
    select: () => undefined,
    selectedRow: () => null,
    targetDirectory: () => "/w",
    siblingsOf: (folder: string) => (folder === "/w" ? existing : []),
    refresh: async () => undefined,
    focusRow: () => undefined,
    remap: () => undefined,
    forget: () => undefined,
  });
  return { ops, notes, errors, expanded };
}

describe("a paste writes the tree it was given, and never overwrites", () => {
  test("a folder keeps its shape, a taken name becomes a free one, and nothing is written twice", async () => {
    const calls: Call[] = [];
    const store = new Map<string, string>();
    const { ops, notes, errors, expanded } = opsWith(fakeFs(calls, store), ["notes.txt"]);

    await ops.transfer([
      { kind: "file", name: "notes.txt", bytes: new Uint8Array([104, 105]) },
      {
        kind: "directory",
        name: "src",
        children: [
          { kind: "file", name: "a.ts", bytes: new Uint8Array([97]) },
          {
            kind: "directory",
            name: "deep",
            children: [{ kind: "file", name: "b.txt", bytes: new Uint8Array([98]) }],
          },
        ],
      },
    ]);

    expect(errors).toEqual([]);
    expect(calls.map((call) => `${call.call} ${call.path}`)).toEqual([
      "writeAsset /w/notes (2).txt",
      "create:directory /w/src",
      "writeAsset /w/src/a.ts",
      "create:directory /w/src/deep",
      "writeAsset /w/src/deep/b.txt",
    ]);
    expect(calls[0]!.detail).toBe("aGk=");
    expect(calls[2]!.detail).toBe("YQ==");
    expect(new Set(calls.map((call) => call.path)).size).toBe(calls.length);
    expect(store.has("/w/notes.txt")).toBe(false);
    expect(notes[0]).toBe("pasted 2 items");
    expect(expanded.has("/w")).toBe(true);
  });

  test("one refused file is reported and the rest of the paste still lands", async () => {
    const calls: Call[] = [];
    const store = new Map<string, string>();
    const base = fakeFs(calls, store);
    const failing = {
      ...base,
      writeAsset: async (path: string, base64: string) => {
        if (path === "/w/bad.bin") throw new Error("no room on this disk");
        return base.writeAsset(path, base64);
      },
    };
    const { ops, notes, errors } = opsWith(failing, []);

    await ops.transfer([
      { kind: "file", name: "bad.bin", bytes: new Uint8Array([1]) },
      { kind: "file", name: "good.bin", bytes: new Uint8Array([2]) },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bad.bin");
    expect(errors[0]).toContain("no room on this disk");
    expect(store.has("/w/good.bin")).toBe(true);
    expect(notes).toEqual(["pasted 1 item"]);
  });

  test("a dragged path is copied by the backend instead of being read into the page", async () => {
    const calls: Call[] = [];
    const { ops } = opsWith(fakeFs(calls, new Map()), []);
    await ops.transfer([{ kind: "path", name: "big.iso", path: "/Users/saint/big.iso" }]);
    expect(calls).toEqual([
      { call: "copy", path: "/w/big.iso", detail: "/Users/saint/big.iso" },
    ]);
  });

  test("with no folder open nothing is written at all", async () => {
    const calls: Call[] = [];
    const notes: string[] = [];
    const ops = createOps({
      deps: {
        fs: fakeFs(calls, new Map()),
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
        onNote: (message: string) => notes.push(message),
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
    await ops.transfer([{ kind: "file", name: "a.txt", bytes: new Uint8Array([1]) }]);
    expect(calls).toEqual([]);
    expect(notes).toEqual(["Open a folder first"]);
  });
});

function fileEntry(name: string, text: string) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (file: unknown) => void) =>
      ok({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer }),
  };
}

function dirEntry(name: string, kids: unknown[]) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let sent = false;
      return {
        readEntries: (ok: (entries: unknown[]) => void) => {
          if (sent) return ok([]);
          sent = true;
          ok(kids);
        },
      };
    },
  };
}

function fileItem(name: string, text: string) {
  return {
    kind: "file",
    webkitGetAsEntry: () => null,
    getAsFile: () => ({
      name,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    }),
  };
}

function fakeElement() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const classes = new Set<string>();
  const element = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((kept) => kept !== handler));
    },
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      toggle: (name: string, on?: boolean) => {
        if (on === false) classes.delete(name);
        else classes.add(name);
      },
    },
  };
  const fire = (type: string, event: unknown) =>
    [...(listeners.get(type) ?? [])].forEach((handler) => handler(event));
  return { element: element as unknown as HTMLElement, fire, listeners, classes };
}

describe("a dropped or pasted folder is walked into real files", () => {
  test("nested folders arrive as a tree with their bytes", async () => {
    const items = (await entriesToItems([
      dirEntry("proj", [fileEntry("a.txt", "hi"), dirEntry("src", [fileEntry("b.ts", "x")])]),
    ])) as unknown as Item[];

    expect(items).toHaveLength(1);
    const folder = items[0]!;
    expect(folder.kind).toBe("directory");
    expect(folder.name).toBe("proj");
    expect(folder.children!.map((child) => child.name)).toEqual(["a.txt", "src"]);
    expect(new TextDecoder().decode(folder.children![0]!.bytes)).toBe("hi");
    expect(folder.children![1]!.children!.map((child) => child.name)).toEqual(["b.ts"]);
    expect(countItems(items as never)).toBe(4);
  });

  test("Ctrl+V and a drop both hand files to the explorer, and the drop marks the tree", async () => {
    const accepted: Item[][] = [];
    const { element, fire, classes } = fakeElement();
    let prevented = 0;
    const detach = attachTransfer(element, {
      target: () => "/w",
      accept: (items) => {
        accepted.push(items as unknown as Item[]);
      },
      onNote: () => undefined,
    });

    fire("paste", {
      clipboardData: { items: [fileItem("a.txt", "hi")], files: [], getData: () => "" },
      preventDefault: () => {
        prevented += 1;
      },
    });
    await settle();
    expect(prevented).toBe(1);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]![0]!.name).toBe("a.txt");

    fire("dragenter", { dataTransfer: { types: ["Files"] }, preventDefault: () => undefined });
    expect(classes.has("is-drop-target")).toBe(true);
    fire("drop", {
      dataTransfer: { types: ["Files"], items: [fileItem("b.txt", "yo")], files: [], getData: () => "" },
      preventDefault: () => undefined,
    });
    await settle();
    expect(classes.has("is-drop-target")).toBe(false);
    expect(accepted[1]![0]!.name).toBe("b.txt");

    detach();
  });

  test("a text paste and a drop with no folder open are left alone", async () => {
    const accepted: Item[][] = [];
    const { element, fire, classes, listeners } = fakeElement();
    let prevented = 0;
    const detach = attachTransfer(element, {
      target: () => null,
      accept: (items) => {
        accepted.push(items as unknown as Item[]);
      },
      onNote: () => undefined,
    });

    fire("paste", {
      clipboardData: { items: [], files: [], getData: () => "hello" },
      preventDefault: () => {
        prevented += 1;
      },
    });
    await settle();
    expect(prevented).toBe(0);
    fire("dragenter", { dataTransfer: { types: ["Files"] }, preventDefault: () => undefined });
    expect(classes.has("is-drop-target")).toBe(false);
    expect(accepted).toEqual([]);

    detach();
    expect([...listeners.values()].every((list) => list.length === 0)).toBe(true);
  });
});

describe("the copy and asset methods are declared and travel through the bridge", () => {
  test("fs.copy and fs.write_asset post their own params and are in the manifest", async () => {
    expect(declaredMethods()).toContain("fs.copy");
    expect(declaredMethods()).toContain("fs.write_asset");

    const host = fakeHost();
    const api = createApi(link(host));

    const copying = api.copy("/Users/saint/big.iso", "/w/big.iso");
    const copied = host.posted[0]!.payload as { method: string; params: unknown };
    expect(copied.method).toBe("fs.copy");
    expect(copied.params).toEqual({ from: "/Users/saint/big.iso", to: "/w/big.iso" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { from: "/Users/saint/big.iso", to: "/w/big.iso", is_dir: false, bytes: 3, files: 1 },
    });
    await expect(copying).resolves.toMatchObject({ to: "/w/big.iso" });

    const writing = api.writeAsset("/w/b.bin", "AAEC");
    const written = host.posted[1]!.payload as { method: string; params: unknown };
    expect(written.method).toBe("fs.write_asset");
    expect(written.params).toEqual({ path: "/w/b.bin", base64: "AAEC" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-2",
      ok: true,
      result: { path: "/w/b.bin", bytes: 3 },
    });
    await expect(writing).resolves.toMatchObject({ bytes: 3 });
  });
});
