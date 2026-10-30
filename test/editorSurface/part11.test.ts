import {
  INTERNAL_MOVE_TYPE,
  createOps,
  describe,
  expect,
  moveTargetFolder,
  test,
} from "../editorSurfaceCommon";

const ROOT = "/w";

describe("a dragged row lands in a folder, never somewhere it cannot be", () => {
  test("a folder means into it; a file means into the folder that holds it", () => {
    expect(moveTargetFolder("/w/src/a.ts", { path: "/w/lib", isDir: true }, ROOT)).toBe("/w/lib");
    expect(moveTargetFolder("/w/src/a.ts", { path: "/w/lib/b.ts", isDir: false }, ROOT)).toBe("/w/lib");
  });

  test("dropping back where it already is does nothing", () => {
    expect(moveTargetFolder("/w/src/a.ts", { path: "/w/src/b.ts", isDir: false }, ROOT)).toBeNull();
    expect(moveTargetFolder("/w/src/a.ts", { path: "/w/src", isDir: true }, ROOT)).toBeNull();
    expect(moveTargetFolder("/w/a.ts", null, ROOT)).toBeNull();
  });

  test("a folder cannot be moved into itself or below itself", () => {
    expect(moveTargetFolder("/w/src", { path: "/w/src", isDir: true }, ROOT)).toBeNull();
    expect(moveTargetFolder("/w/src", { path: "/w/src/deep", isDir: true }, ROOT)).toBeNull();
    expect(moveTargetFolder("/w/src", { path: "/w/src2", isDir: true }, ROOT)).toBe("/w/src2");
  });

  test("the empty part of the tree means the root, and the root is not dragged", () => {
    expect(moveTargetFolder("/w/src/a.ts", null, ROOT)).toBe("/w");
    expect(moveTargetFolder("/w", { path: "/w/lib", isDir: true }, ROOT)).toBeNull();
    expect(moveTargetFolder("/w/src/a.ts", { path: "/w/lib", isDir: true }, null)).toBeNull();
  });

  test("the drag type is the explorer's own, not a file from the OS", () => {
    expect(INTERNAL_MOVE_TYPE).toBe("application/x-ponpoko-editor-path");
  });
});

interface Call {
  call: string;
  from?: string;
  to?: string;
}

function moveHarness(options: {
  siblings?: Record<string, string[]>;
  disk?: string[];
  failRename?: boolean;
} = {}) {
  const calls: Call[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const renamed: string[] = [];
  const remapped: string[] = [];
  const selected: string[] = [];
  const expanded = new Set<string>();

  const entries = (folder: string) =>
    (options.disk ?? []).map((name) => ({
      name,
      path: `${folder}/${name}`,
      is_dir: false,
      is_symlink: false,
      bytes: 0,
      modified_ms: 0,
    }));

  const fs = {
    list: async (path: string) => ({ path, entries: entries(path) }),
    create: async (path: string, kind: "file" | "directory") => ({
      path,
      exists: true,
      is_file: kind === "file",
      is_dir: kind === "directory",
      bytes: 0,
    }),
    copy: async (from: string, to: string) => ({ from, to, is_dir: false, bytes: 0, files: 0 }),
    writeAsset: async (path: string) => ({ path, bytes: 0 }),
    rename: async (from: string, to: string) => {
      calls.push({ call: "rename", from, to });
      if (options.failRename === true) throw new Error("permission denied");
      return { from, to, is_dir: false };
    },
    remove: async (path: string) => ({ path, deleted: true, recursive: false }),
    stat: async (path: string) => ({
      path,
      exists: true,
      is_file: true,
      is_dir: false,
      bytes: 0,
      modified_ms: 0,
    }),
    reveal: async () => ({ revealed: true }),
  };

  const ops = createOps({
    deps: {
      fs,
      root: () => ROOT,
      activePath: () => null,
      openFile: () => undefined,
      askName: async () => null,
      confirm: async () => true,
      onRenamed: (from, to) => renamed.push(`${from}->${to}`),
      onDeleted: () => undefined,
      onReveal: () => undefined,
      onCopyPath: () => undefined,
      onError: (message) => errors.push(message),
      onNote: (message) => notes.push(message),
    },
    expanded,
    root: () => ROOT,
    selected: () => null,
    select: (path) => selected.push(path ?? ""),
    selectedRow: () => null,
    targetDirectory: () => ROOT,
    siblingsOf: (folder) => options.siblings?.[folder] ?? [],
    refresh: async () => undefined,
    focusRow: () => undefined,
    remap: (from, to) => remapped.push(`${from}->${to}`),
    forget: () => undefined,
  });

  return { ops, calls, notes, errors, renamed, remapped, selected, expanded };
}

describe("moving a row renames it in place and keeps everything in step", () => {
  test("a file moved into a folder is a rename, and its tab follows", async () => {
    const h = moveHarness();

    await h.ops.move("/w/src/a.txt", "/w/lib");

    expect(h.calls).toEqual([{ call: "rename", from: "/w/src/a.txt", to: "/w/lib/a.txt" }]);
    expect(h.renamed).toEqual(["/w/src/a.txt->/w/lib/a.txt"]);
    expect(h.remapped).toEqual(["/w/src/a.txt->/w/lib/a.txt"]);
    expect(h.selected.at(-1)).toBe("/w/lib/a.txt");
    expect(h.expanded.has("/w/lib")).toBe(true);
    expect(h.notes.at(-1)).toContain("moved a.txt");
    expect(h.errors).toEqual([]);
  });

  test("a taken name becomes the next free one instead of overwriting", async () => {
    const h = moveHarness({ siblings: { "/w/lib": ["a.txt"] } });

    await h.ops.move("/w/src/a.txt", "/w/lib");

    expect(h.calls[0]).toEqual({
      call: "rename",
      from: "/w/src/a.txt",
      to: "/w/lib/a (2).txt",
    });
    expect(h.notes.at(-1)).toContain("as a (2).txt");
  });

  test("a name that is on disk but not loaded in the tree is still respected", async () => {
    const h = moveHarness({ disk: ["a.txt"] });

    await h.ops.move("/w/src/a.txt", "/w/lib");

    expect(h.calls[0]!.to).toBe("/w/lib/a (2).txt");
  });

  test("moving a folder carries its path, and opens the destination folder", async () => {
    const h = moveHarness();

    await h.ops.move("/w/src", "/w/lib");

    expect(h.calls[0]).toEqual({ call: "rename", from: "/w/src", to: "/w/lib/src" });
    expect(h.expanded.has("/w/lib")).toBe(true);
    expect(h.selected.at(-1)).toBe("/w/lib/src");
  });

  test("a move into itself, into the same folder, or of the root is refused before the backend", async () => {
    const inside = moveHarness();
    await inside.ops.move("/w/src", "/w/src/deep");
    expect(inside.calls).toEqual([]);
    expect(inside.notes.at(-1)).toContain("inside itself");

    const same = moveHarness();
    await same.ops.move("/w/src/a.txt", "/w/src");
    expect(same.calls).toEqual([]);
    expect(same.notes.at(-1)).toContain("already in that folder");

    const root = moveHarness();
    await root.ops.move("/w", "/w/lib");
    expect(root.calls).toEqual([]);
    expect(root.notes.at(-1)).toContain("open folder itself");
  });

  test("a refused rename is a sentence, and the tree is left alone", async () => {
    const h = moveHarness({ failRename: true });

    await h.ops.move("/w/src/a.txt", "/w/lib");

    expect(h.errors.at(-1)).toContain("Could not move a.txt");
    expect(h.renamed).toEqual([]);
    expect(h.remapped).toEqual([]);
  });
});
