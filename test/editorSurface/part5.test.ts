import { FormatError, HTML_PREVIEW_SANDBOX, IMAGE_EXTENSIONS, SETTINGS, dataUrl, describe, editorConfigMatch, expect, formatDocument, groupMatches, headingSlug, languageFromFence, nearestPosition, parseEditorConfig, parseJsonLoose, previewKindFor, previewPolicy, replaceConfirmMessage, replacementSummary, resolveEditorConfig, resolvePrettierOptions, resolveReference, searchOptions, searchSummary, test } from "../editorSurfaceCommon";

describe(".editorconfig is parsed and matched, not approximated", () => {
  const DOC = parseEditorConfig(`# the project's own editor settings
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
`);

  test("sections, the preamble and comments read the way the spec says", () => {
    expect(DOC.root).toBe(true);
    expect(DOC.sections.map((section) => section.pattern)).toEqual(["*", "*.md", "Makefile"]);
    expect(parseEditorConfig("indent_size = 8")).toEqual({ root: false, sections: [] });
    expect(parseEditorConfig("root = false\n[*]\nindent_size=8")).toEqual({
      root: false,
      sections: [{ pattern: "*", properties: { indent_size: "8" } }],
    });
  });

  test("a pattern without a slash matches the name in any folder", () => {
    expect(editorConfigMatch("*.ts", "src/a.ts")).toBe(true);
    expect(editorConfigMatch("*.ts", "src/lib/deep/a.ts")).toBe(true);
    expect(editorConfigMatch("src/*.ts", "src/a.ts")).toBe(true);
    expect(editorConfigMatch("src/*.ts", "src/lib/a.ts")).toBe(false);
    expect(editorConfigMatch("**/lib/*.ts", "src/lib/a.ts")).toBe(true);
    expect(editorConfigMatch("*.{js,ts}", "a.ts")).toBe(true);
    expect(editorConfigMatch("*.{js,ts}", "a.tsx")).toBe(false);
    expect(editorConfigMatch("file{1..3}.txt", "file2.txt")).toBe(true);
    expect(editorConfigMatch("[!a]*.md", "b.md")).toBe(true);
    expect(editorConfigMatch("[!a]*.md", "a.md")).toBe(false);
    expect(editorConfigMatch("", "a.ts")).toBe(false);
  });

  test("later sections win, and only what the formatter understands is kept", () => {
    expect(resolveEditorConfig(DOC, "src/README.md")).toEqual({
      charset: "utf-8",
      indentStyle: "space",
      indentSize: 2,
      endOfLine: "lf",
      trimTrailingWhitespace: false,
    });
    expect(resolveEditorConfig(DOC, "Makefile")).toEqual({
      charset: "utf-8",
      indentStyle: "tab",
      indentSize: 2,
      endOfLine: "lf",
    });
    expect(
      resolveEditorConfig(parseEditorConfig("[*]\nindent_size = tab\ntab_width = 8\nmax_line_length = off"), "a.ts"),
    ).toEqual({ indentSize: "tab", tabWidth: 8, maxLineLength: "off" });
    expect(resolveEditorConfig(null, "a.ts")).toEqual({});
  });
});

describe("Prettier is called with the project's own options", () => {
  const BASE = {
    settings: SETTINGS,
    eol: "lf" as const,
    editorconfig: {},
    prettier: {},
    prettierSource: null,
    editorconfigSource: null,
  };

  test("the editor's settings are the floor, .editorconfig and .prettierrc win over them", () => {
    expect(resolvePrettierOptions(BASE).options).toEqual({
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      endOfLine: "lf",
    });

    const resolved = resolvePrettierOptions({
      ...BASE,
      editorconfig: { indentStyle: "tab", tabWidth: 8, maxLineLength: 120 },
      prettier: { semi: false, printWidth: 80 },
      prettierSource: ".prettierrc",
      editorconfigSource: ".editorconfig",
    });
    expect(resolved.options).toEqual({
      printWidth: 80,
      tabWidth: 8,
      useTabs: true,
      endOfLine: "lf",
      semi: false,
    });
  });

  test("a config the editor cannot honour is reported, not applied partially", () => {
    const resolved = resolvePrettierOptions({
      ...BASE,
      editorconfig: { insertFinalNewline: false, charset: "latin1", endOfLine: "crlf" },
      prettier: { overrides: [], endOfLine: "crlf", unknownThing: true, proseWrap: "always" },
      prettierSource: ".prettierrc",
    });
    expect(resolved.options.proseWrap).toBe("always");
    expect(resolved.options.endOfLine).toBe("lf");
    const notes = resolved.notes.join(" ");
    expect(notes).toContain("insert_final_newline = false");
    expect(notes).toContain("latin1");
    expect(notes).toContain("overrides");
    expect(notes).toContain('"unknownThing"');
  });

  test("a .prettierrc may carry comments and trailing commas", () => {
    expect(parseJsonLoose('{\n  // keep it short\n  "semi": false, /* no dots */\n  "tabWidth": 4,\n}')).toEqual({
      semi: false,
      tabWidth: 4,
    });
    expect(parseJsonLoose('{"a": ",}", "b": "http://x"}')).toEqual({ a: ",}", b: "http://x" });
  });
});

describe("formatting a document runs the engine and keeps the caret near", () => {
  function formatFs(files: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(files));
    const calls: string[] = [];
    return {
      store,
      calls,
      fs: {
        async stat(path: string) {
          const content = store.get(path);
          return { exists: content !== undefined, is_file: content !== undefined };
        },
        async read(path: string) {
          const content = store.get(path);
          if (content === undefined) throw new Error(`there is no file at ${path}`);
          calls.push(`read:${path}`);
          return { content };
        },
        async formatRust(content: string, path?: string) {
          calls.push(`rustfmt:${path ?? ""}`);
          return { content: content.replace(/\n/g, "\r\n"), warnings: "" };
        },
        async formatToml(content: string) {
          calls.push("taplo");
          return { content: content.trim() + "\n" };
        },
      },
    };
  }

  const REQUEST = {
    path: "/work/a.ts",
    text: "const value =    1;\nconst other = 2\n",
    language: "typescript" as const,
    eol: "lf" as const,
    settings: SETTINGS,
    workspace: "/work" as string | null,
  };

  test("Prettier runs in this page, offline, and the project's config decides the style", async () => {
    const h = formatFs({ "/work/.prettierrc": '{ "semi": false }' });
    const outcome = await formatDocument(REQUEST, h.fs);
    expect(outcome.engine).toBe("prettier");
    expect(outcome.engineLabel).toBe("Prettier");
    expect(outcome.content).toBe("const value = 1\nconst other = 2\n");
    expect(outcome.changed).toBe(true);
    expect(outcome.configSource).toBe(".prettierrc");
  });

  test(".editorconfig decides tabs and width when .prettierrc says nothing", async () => {
    const h = formatFs({ "/work/.editorconfig": "[*.ts]\nindent_style = tab\nindent_size = 4\n" });
    const outcome = await formatDocument(
      { ...REQUEST, text: "function f(){if(true){return 1}}\n" },
      h.fs,
    );
    expect(outcome.content).toContain("\tif (true) {");
    expect(outcome.configSource).toBe(".editorconfig");
  });

  test("Rust and TOML are formatted by the backend, and CRLF from a tool never reaches the buffer", async () => {
    const h = formatFs();
    const rust = await formatDocument(
      { ...REQUEST, path: "/work/a.rs", language: "rust", text: "fn  main(){}\n" },
      h.fs,
    );
    expect(rust.engine).toBe("rustfmt");
    expect(rust.content.includes("\r")).toBe(false);
    expect(h.calls).toContain("rustfmt:/work/a.rs");

    const toml = await formatDocument(
      { ...REQUEST, path: "/work/Cargo.toml", language: "toml", text: "[package]\nname='x'\n\n" },
      h.fs,
    );
    expect(toml.engine).toBe("taplo");
    expect(toml.content).toBe("[package]\nname='x'\n");
    expect(h.calls).toContain("taplo");
  });

  test("a .prettierrc that cannot be read is a sentence naming the file", async () => {
    const h = formatFs({ "/work/.prettierrc": "{ semi: " });
    let failure: unknown = null;
    try {
      await formatDocument(REQUEST, h.fs);
    } catch (error) {
      failure = error;
    }
    expect(failure instanceof FormatError).toBe(true);
    expect((failure as Error).message).toContain(".prettierrc is not valid JSON");
    expect((failure as Error).message).toContain("nothing was formatted");
  });

  test("a language without a formatter is refused with a sentence naming what works", async () => {
    const h = formatFs();
    let failure: unknown = null;
    try {
      await formatDocument({ ...REQUEST, path: "/work/a.py", language: "python" }, h.fs);
    } catch (error) {
      failure = error;
    }
    expect(failure instanceof FormatError).toBe(true);
    expect((failure as Error).message).toContain("no formatter for Python");
    expect(h.calls).toEqual([]);
  });

  test("the caret keeps the word it was on when formatting moves it", () => {
    const before = "const a=1\nfunction  greet ( ) { return 2 }\n";
    const after = "const a = 1;\n\nfunction greet() {\n  return 2;\n}\n";
    const position = nearestPosition(before, { line: 2, column: 12 }, after);
    expect(position.line).toBe(3);
    const line = after.split("\n")[position.line - 1];
    expect(line.slice(position.column - 2, position.column + 3)).toBe("greet");

    expect(nearestPosition("a\nb\nc\n", { line: 2, column: 1 }, "only")).toEqual({ line: 1, column: 1 });
  });
});

describe("search results are grouped, counted and opened", () => {
  const MATCHES = [
    { path: "/w/b.ts", relative: "b.ts", line: 2, column: 0, length: 3, line_text: "foo bar" },
    { path: "/w/a.ts", relative: "a.ts", line: 5, column: 4, length: 3, line_text: "const foo = 1" },
    { path: "/w/b.ts", relative: "b.ts", line: 9, column: 1, length: 3, line_text: "  foo" },
  ];

  test("one group per file, ordered by path, with the matches in line order", () => {
    const groups = groupMatches(MATCHES);
    expect(groups.map((group) => group.relative)).toEqual(["a.ts", "b.ts"]);
    expect(groups[0]!.matches.map((match) => match.line)).toEqual([5]);
    expect(groups[1]!.matches.map((match) => match.line)).toEqual([2, 9]);
    expect(groupMatches([])).toEqual([]);
  });

  test("a summary says how many matches, in how many files, and whether it stopped early", () => {
    expect(searchSummary({ root: "/w", query: "zzz", matches: [], files_searched: 3, truncated: false })).toBe(
      "No matches for “zzz” in 3 files.",
    );
    expect(
      searchSummary({ root: "/w", query: "foo", matches: MATCHES, files_searched: 7, truncated: false }),
    ).toBe("3 matches in 2 files · 7 searched");
    expect(
      searchSummary({ root: "/w", query: "foo", matches: [MATCHES[0]!], files_searched: 1, truncated: true }),
    ).toContain("result limit");
  });

  test("Replace All reports what it wrote, and names what it could not", () => {
    expect(
      replacementSummary({
        root: "/w",
        changed: [
          { path: "/w/a.ts", relative: "a.ts", replacements: 2 },
          { path: "/w/b.ts", relative: "b.ts", replacements: 1 },
        ],
        failed: [],
        total: 3,
        files_searched: 5,
      }),
    ).toBe("Replaced 3 places in 2 files.");
    expect(
      replacementSummary({
        root: "/w",
        changed: [],
        failed: [{ path: "/w/locked.ts", relative: "locked.ts", error: "permission denied" }],
        total: 0,
        files_searched: 5,
      }),
    ).toContain("locked.ts (permission denied)");
    const partial = replacementSummary({
      root: "/w",
      changed: [{ path: "/w/a.ts", relative: "a.ts", replacements: 1 }],
      failed: [{ path: "/w/b.ts", relative: "b.ts", error: "read-only" }],
      total: 1,
      files_searched: 2,
    });
    expect(partial).toContain("Replaced 1 place in 1 file");
    expect(partial).toContain("1 file could not be written (b.ts)");
  });

  test("the question before a replace carries the numbers, and the wire keeps the backend's keys", () => {
    const state = { query: "foo", replacement: "bar", regex: false, caseSensitive: true, wholeWord: true, includeHidden: false };
    expect(replaceConfirmMessage(state, { root: "/w", query: "foo", matches: MATCHES, files_searched: 2, truncated: false })).toContain(
      "Replace 3 matches of “foo” with “bar” in 2 files?",
    );
    expect(
      replaceConfirmMessage(state, { root: "/w", query: "foo", matches: [MATCHES[0]!], files_searched: 2, truncated: true }),
    ).toContain("at least 1 match");
    expect(searchOptions("/w", state)).toEqual({
      root: "/w",
      query: "foo",
      regex: false,
      case_sensitive: true,
      whole_word: true,
      include_hidden: false,
    });
  });
});

describe("a preview knows what it can draw and where a reference points", () => {
  test("Markdown, HTML and the requirement's image formats have a preview; code does not", () => {
    expect(previewKindFor("/w/README.md")).toBe("markdown");
    expect(previewKindFor("/w/notes.MDX")).toBe("markdown");
    expect(previewKindFor("/w/page.html")).toBe("html");
    expect(previewKindFor("/w/pic.JPG")).toBe("image");
    expect(previewKindFor("/w/icon.svg")).toBe("image");
    expect(previewKindFor("/w/a.ts")).toBeNull();
    for (const extension of ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]) {
      expect(IMAGE_EXTENSIONS).toContain(extension);
      expect(previewKindFor(`/w/x.${extension}`)).toBe("image");
    }
  });

  test("a local reference resolves against the document, a web one is refused", () => {
    expect(resolveReference("/w/docs", "img/a.png")).toEqual({ kind: "local", path: "/w/docs/img/a.png" });
    expect(resolveReference("/w/docs", "./a.md?x=1#top")).toEqual({ kind: "local", path: "/w/docs/a.md" });
    expect(resolveReference("/w/docs", "/abs/a.png")).toEqual({ kind: "local", path: "/abs/a.png" });
    expect(resolveReference("/w/docs", "https://example.com/a.png")).toEqual({
      kind: "remote",
      url: "https://example.com/a.png",
    });
    expect(resolveReference("/w/docs", "//cdn.example.com/a.png")).toEqual({
      kind: "remote",
      url: "//cdn.example.com/a.png",
    });
    expect(resolveReference("/w/docs", "#intro")).toEqual({ kind: "anchor", id: "intro" });
    expect(resolveReference("/w/docs", "data:image/png;base64,AAAA")).toEqual({
      kind: "data",
      url: "data:image/png;base64,AAAA",
    });
    expect(resolveReference("/w/docs", "   ")).toEqual({ kind: "empty" });
    expect(dataUrl({ mime: "image/png", base64: "AAAA" })).toBe("data:image/png;base64,AAAA");
  });

  test("a fenced block is highlighted as the language its name means", () => {
    expect(languageFromFence("ts")).toBe("typescript");
    expect(languageFromFence("TSX")).toBe("tsx");
    expect(languageFromFence("js")).toBe("javascript");
    expect(languageFromFence("rust")).toBe("rust");
    expect(languageFromFence("c++")).toBe("cpp");
    expect(languageFromFence("bash")).toBe("shell");
    expect(languageFromFence("docker")).toBe("dockerfile");
    expect(languageFromFence("nonsense")).toBeNull();
    expect(languageFromFence("")).toBeNull();
  });

  test("a heading gets the id its anchors use", () => {
    expect(headingSlug("Hello, World!")).toBe("hello-world");
    expect(headingSlug("  Multiple   spaces  ")).toBe("multiple-spaces");
    expect(headingSlug("ภาษาไทย — section")).toBe("ภาษาไทย-section");
    expect(headingSlug("!!")).toBe("");
  });

  test("the HTML preview withholds scripts twice: an empty sandbox and a policy", () => {
    expect(HTML_PREVIEW_SANDBOX).toBe("");
    const policy = previewPolicy();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain("img-src data:");
  });
});
