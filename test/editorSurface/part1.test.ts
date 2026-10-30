import { HOST_HELLO, LANGUAGES, SURFACE_BRIDGE_CHANNEL, SURFACE_BRIDGE_VERBS, SURFACE_READY, SURFACE_VERBS, VIEW, baseName, describe, dirName, expect, fakeHost, formatBytes, isLanguageId, joinPath, languageChoices, languageExtension, languageFor, languageLabel, link, relativePath, settle, shortenPath, test, viewTokenFromLocation } from "../editorSurfaceCommon";

describe("the editor surface speaks the host's wire exactly", () => {
  test("the frame's URL is where the view token comes from", () => {
    expect(viewTokenFromLocation(new URL("ponpoko-surface://localhost/editor/index.html?view=abc123"))).toBe(
      "abc123",
    );
    expect(viewTokenFromLocation(new URL("ponpoko-surface://localhost/editor/index.html"))).toBe("");
    expect(viewTokenFromLocation(new URL("ponpoko-surface://localhost/editor/?view=%20"))).toBe("");
  });

  test("a call carries the channel, the view token, an id and the verb", async () => {
    const host = fakeHost();
    const surface = link(host);

    const promise = surface.call("tool.file", { mode: "open", title: "Open" });
    expect(host.posted).toHaveLength(1);
    expect(host.posted[0]).toEqual({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      verb: "tool.file",
      payload: { mode: "open", title: "Open" },
    });

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { path: "/tmp/picked.md" },
    });
    expect(await promise).toEqual({ path: "/tmp/picked.md" });
  });

  test("an answer for another channel, view or id is not this call's answer", async () => {
    const host = fakeHost();
    const surface = link(host);

    let answered: unknown;
    const promise = surface.call("tool.file", { mode: "open" }).then((value) => {
      answered = value;
      return value;
    });

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: "another-view",
      id: "call-1",
      ok: true,
      result: { leaked: "into the wrong view" },
    });
    host.deliver({
      channel: "someone.else",
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { leaked: "from the wrong protocol" },
    });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-9",
      ok: true,
      result: { leaked: "for another request" },
    });
    await settle();
    expect(answered).toBeUndefined();

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { workspaces: [] },
    });
    expect(await promise).toEqual({ workspaces: [] });
  });

  test("a refusal arrives as the host's own sentence", async () => {
    const host = fakeHost();
    const surface = link(host);

    const promise = surface.call("backend.call", { method: "demo.read" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: false,
      error: "'backend.call' is not in this surface's manifest",
    });
    await expect(promise).rejects.toThrow("not in this surface's manifest");

    const silent = surface.call("tool.file", { mode: "save" });
    host.deliver({ channel: SURFACE_BRIDGE_CHANNEL, view: VIEW, id: "call-2", ok: false });
    await expect(silent).rejects.toThrow("did not say why");
  });

  test("a backend call is relayed as a method and its params, and answers with the result", async () => {
    const host = fakeHost();
    const surface = link(host);

    const promise = surface.callBackend<{ bytes: number }>("demo.write", {
      path: "/tmp/a.txt",
      content: "hello",
    });
    expect(host.posted[0]!.verb).toBe("backend.call");
    expect(host.posted[0]!.payload).toEqual({
      method: "demo.write",
      params: { path: "/tmp/a.txt", content: "hello" },
    });

    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { bytes: 5 },
    });
    expect(await promise).toEqual({ bytes: 5 });
  });

  test("a file pick answers with a path, or with null when the human cancelled", async () => {
    const host = fakeHost();
    const surface = link(host);

    const chosen = surface.pickFile({ mode: "save" });
    expect(host.posted[0]!.payload).toEqual({ mode: "save" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { path: "/tmp/saved.md" },
    });
    expect(await chosen).toBe("/tmp/saved.md");

    const cancelled = surface.pickFile({ mode: "open" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-2",
      ok: true,
      result: { path: null },
    });
    expect(await cancelled).toBeNull();

    const nonsense = surface.pickFile({ mode: "open" });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-3",
      ok: true,
      result: "not an answer shape",
    });
    expect(await nonsense).toBeNull();
  });

  test("a folder pick carries the directory flag and the seeded path", async () => {
    const host = fakeHost();
    const surface = link(host);

    const promise = surface.pickFile({
      mode: "open",
      directory: true,
      defaultPath: "/Users/someone/work",
    });
    expect(host.posted[0]!.payload).toEqual({
      mode: "open",
      directory: true,
      defaultPath: "/Users/someone/work",
    });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { path: "/Users/someone/work" },
    });
    expect(await promise).toBe("/Users/someone/work");
  });

  test("readiness and the greeting are transport, not requests", async () => {
    const host = fakeHost();
    const surface = link(host);

    surface.announceReady();
    expect(host.posted[0]).toEqual({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      control: SURFACE_READY,
    });

    const greetings: unknown[] = [];
    surface.onHello((doors) => greetings.push(doors));
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      control: HOST_HELLO,
      doors: ["tool.file", "backend.call", 7],
    });
    expect(greetings).toEqual([["tool.file", "backend.call"]]);

    host.deliver({ channel: SURFACE_BRIDGE_CHANNEL, view: "elsewhere", control: HOST_HELLO, grants: [] });
    expect(greetings).toHaveLength(1);
  });

  test("the surface's vocabulary is the host's vocabulary: tool.file, tool.paste and backend.call", () => {
    expect([...SURFACE_VERBS]).toEqual([...SURFACE_BRIDGE_VERBS]);
    expect([...SURFACE_VERBS]).toEqual(["tool.file", "tool.paste", "backend.call"]);
  });
});

describe("a path is read the way a human reads it", () => {
  test("the last segment is the name, with either separator", () => {
    expect(baseName("/Users/someone/notes/plan.md")).toBe("plan.md");
    expect(baseName("C:\\work\\Ponpoko\\src\\main.ts")).toBe("main.ts");
    expect(baseName("/tmp/dir/")).toBe("dir");
    expect(baseName("plain.txt")).toBe("plain.txt");
  });

  test("a folder, a child and a relative path are one vocabulary", () => {
    expect(dirName("/Users/someone/notes/plan.md")).toBe("/Users/someone/notes");
    expect(dirName("C:\\work\\Ponpoko\\src\\main.ts")).toBe("C:\\work\\Ponpoko\\src");
    expect(joinPath("/tmp/work", "src/main.ts")).toBe("/tmp/work/src/main.ts");
    expect(joinPath("C:\\work", "src\\main.ts")).toBe("C:\\work\\src\\main.ts");
    expect(relativePath("/tmp/work", "/tmp/work/src/main.ts")).toBe("src/main.ts");
    expect(relativePath("/tmp/other", "/tmp/work/src/main.ts")).toBe("/tmp/work/src/main.ts");
  });

  test("a size reads in the unit it deserves, and a long path keeps its ends", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(shortenPath("/a/very/long/path/to/a/file.ts", 24)).toContain("file.ts");
    expect(shortenPath("/a/very/long/path/to/a/file.ts", 24).startsWith("…")).toBe(false);
    expect(shortenPath("/tmp/a.ts", 64)).toBe("/tmp/a.ts");
  });
});

describe("the language registry knows what each file is", () => {
  test("extension, file name, dotfile and unknown-path cases", () => {
    const cases: Array<[string, string]> = [
      ["/tmp/a.ts", "typescript"],
      ["/tmp/a.tsx", "tsx"],
      ["/tmp/a.mjs", "javascript"],
      ["/tmp/a.jsx", "jsx"],
      ["/tmp/a.rs", "rust"],
      ["/tmp/a.yml", "yaml"],
      ["/tmp/a.yaml", "yaml"],
      ["/tmp/a.json", "json"],
      ["/tmp/tsconfig.json", "jsonc"],
      ["/tmp/a.jsonc", "jsonc"],
      ["/tmp/README.md", "markdown"],
      ["/tmp/a.mdx", "mdx"],
      ["/tmp/Cargo.toml", "toml"],
      ["/tmp/a.toml", "toml"],
      ["/tmp/a.html", "html"],
      ["/tmp/a.svg", "xml"],
      ["/tmp/a.scss", "scss"],
      ["/tmp/a.less", "less"],
      ["/tmp/a.py", "python"],
      ["/tmp/a.go", "go"],
      ["/tmp/a.c", "c"],
      ["/tmp/a.hpp", "cpp"],
      ["/tmp/a.java", "java"],
      ["/tmp/a.php", "php"],
      ["/tmp/a.sql", "sql"],
      ["/tmp/run.sh", "shell"],
      ["/tmp/Makefile", "shell"],
      ["/tmp/Dockerfile", "dockerfile"],
      ["/tmp/Dockerfile.dev", "dockerfile"],
      ["/tmp/.editorconfig", "properties"],
      ["/tmp/app.ini", "properties"],
      ["/tmp/a.diff", "diff"],
      ["/tmp/a.txt", "text"],
      ["/tmp/.gitignore", "text"],
      ["/tmp/archive.tar.gz", "text"],
      ["/tmp/A.TS", "typescript"],
      ["", "text"],
    ];
    for (const [path, language] of cases) {
      expect(languageFor(path)).toBe(language);
    }
  });

  test("every entry has a label, a parser and no duplicate id", () => {
    const ids = new Set<string>();
    for (const definition of LANGUAGES) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(ids.has(definition.id)).toBe(false);
      ids.add(definition.id);
      expect(isLanguageId(definition.id)).toBe(true);
      expect(languageExtension(definition.id)).toBeDefined();
    }
    expect(languageLabel("rust")).toBe("Rust");
    expect(languageLabel("yaml")).toBe("YAML");
    expect(languageLabel("text")).toBe("Plain text");
    expect(languageChoices().map((choice) => choice.id)).toEqual([...ids]);
  });

  test("an unknown id falls back to plain text instead of throwing", () => {
    expect(languageExtension("klingon" as Parameters<typeof languageExtension>[0])).toEqual([]);
  });
});
