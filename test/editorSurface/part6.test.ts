import { EDITOR_KEYBINDINGS, SURFACE_BRIDGE_CHANNEL, VIEW, createApi, createFolderLoads, createNavigator, declaredMethods, dedupeLocations, describe, expect, fakeHost, isNavigationClick, keyEvent, link, locationDetail, locationLabel, matchesKey, navigationClickLabel, navigationMenuEntries, peekSummary, settle, test, wordAt } from "../editorSurfaceCommon";

describe("navigation finds a symbol with the static index, not a language server", () => {
  test("the word under the cursor is the identifier, and punctuation has none", () => {
    const text = "const greeting = greet(user);\n";
    expect(wordAt(text, 1, 7)).toEqual({ word: "greeting", start: 6, end: 14 });
    expect(wordAt(text, 1, 18)).toEqual({ word: "greet", start: 17, end: 22 });
    expect(wordAt(text, 1, 24)).toEqual({ word: "user", start: 23, end: 27 });
    expect(wordAt(text, 1, 15)?.word).toBe("greeting");
    expect(wordAt("a.b", 1, 3)?.word).toBe("b");
    expect(wordAt("()", 1, 1)).toBeNull();
    expect(wordAt("const x = 1;", 9, 1)).toBeNull();
  });

  test("Cmd+click and Ctrl+click navigate; a plain click and a right click do not", () => {
    expect(isNavigationClick({ button: 0, metaKey: true, ctrlKey: false })).toBe(true);
    expect(isNavigationClick({ button: 0, metaKey: false, ctrlKey: true })).toBe(true);
    expect(isNavigationClick({ button: 0, metaKey: false, ctrlKey: false })).toBe(false);
    expect(isNavigationClick({ button: 2, metaKey: true, ctrlKey: true })).toBe(false);
    expect(navigationClickLabel("mac")).toContain("⌘");
    expect(navigationClickLabel("other")).toContain("Ctrl");
  });

  test("places are de-duplicated, and a label names the folder-relative path", () => {
    const first = {
      path: "/w/src/a.ts",
      relative: "src/a.ts",
      name: "greet",
      kind: "function",
      line: 3,
      column: 17,
      length: 5,
    };
    const second = { ...first, column: 9 };
    expect(dedupeLocations([first, second, { ...first }])).toHaveLength(2);
    expect(locationLabel(first)).toBe("src/a.ts:3");
    expect(locationLabel({ ...first, relative: undefined })).toBe("a.ts:3");
  });

  test("a peek list counts its results and says where every one is", () => {
    expect(peekSummary(1, "definition")).toBe("1 definition");
    expect(peekSummary(3, "reference")).toBe("3 references");
    const location = {
      path: "/w/src/a.ts",
      relative: "src/a.ts",
      name: "greet",
      kind: "function",
      line: 3,
      column: 17,
      length: 5,
      source: "import \"./a\"",
    };
    expect(locationDetail(location)).toBe("src/a.ts:3:17 · import \"./a\"");
  });

  test("the context menu offers definition, references and go to symbol", () => {
    const ran: string[] = [];
    const entries = navigationMenuEntries({
      definition: () => ran.push("definition"),
      references: () => ran.push("references"),
      symbols: () => ran.push("symbols"),
      definitionKey: "F12",
      referencesKey: "⇧F12",
    });
    const labels = entries.flatMap((entry) => (entry.type === "item" ? [entry.label] : []));
    expect(labels).toContain("Go to Definition");
    expect(labels).toContain("Find All References");
    expect(labels).toContain("Go to Symbol in File…");
    for (const entry of entries) if (entry.type === "item") entry.run();
    expect(ran).toEqual(["definition", "references", "symbols"]);
  });

  test("F12 and Shift+F12 are the editor's navigation chords", () => {
    const editor = new Map(EDITOR_KEYBINDINGS.map((binding) => [binding.key, binding.command]));
    expect(editor.get("F12")).toBe("editor.definition");
    expect(editor.get("Shift-F12")).toBe("editor.references");
    expect(matchesKey(keyEvent({ key: "F12", code: "F12" }), "F12", "mac")).toBe(true);
    expect(matchesKey(keyEvent({ key: "F12", code: "F12", shift: true }), "Shift-F12", "mac")).toBe(true);
  });

  test("a definition call carries the buffer, the position and the folder", async () => {
    const host = fakeHost();
    const api = createApi(link(host));
    const promise = api.definition({
      path: "/w/src/a.ts",
      text: "greet();\n",
      root: "/w",
      line: 1,
      column: 1,
      word: "greet",
    });
    const posted = host.posted[0]!.payload as { method: string; params: unknown };
    expect(declaredMethods()).toContain(posted.method);
    expect(posted.params).toEqual({
      path: "/w/src/a.ts",
      text: "greet();\n",
      root: "/w",
      line: 1,
      column: 1,
      word: "greet",
    });
    host.deliver({
      channel: SURFACE_BRIDGE_CHANNEL,
      view: VIEW,
      id: "call-1",
      ok: true,
      result: { path: "/w/src/a.ts", word: "greet", language: "typescript", definitions: [], notes: [] },
    });
    await expect(promise).resolves.toMatchObject({ word: "greet" });
  });

  test("one answer opens, several peek, and nothing says why", async () => {
    const location = {
      path: "/w/src/thing.ts",
      relative: "src/thing.ts",
      name: "greet",
      kind: "function",
      line: 2,
      column: 17,
      length: 5,
      language: "typescript",
      source: "import \"./thing\"",
      excerpt: "export function greet() {}",
    };
    const opened: unknown[] = [];
    const peeked: unknown[] = [];
    const notes: string[] = [];
    const navigation = (definitions: unknown[], noteList: string[] = []) =>
      createNavigator({
        api: {
          definition: async () => ({
            path: "/w/src/a.ts",
            word: "greet",
            language: "typescript",
            definitions: definitions as never[],
            notes: noteList,
          }),
          references: async () => ({
            root: "/w",
            path: "/w/src/a.ts",
            word: "greet",
            language: "typescript",
            references: [],
            files_searched: 1,
            truncated: false,
            notes: [],
          }),
          symbols: async () => ({ path: "/w/src/a.ts", language: "typescript", symbols: [] }),
        },
        active: () => ({ path: "/w/src/a.ts", text: "greet();\n" }),
        root: () => "/w",
        cursor: () => ({ line: 1, column: 1 }),
        positionAt: () => ({ line: 1, column: 1 }),
        open: (found) => opened.push(found),
        peek: (request) => peeked.push(request),
        onError: (message) => notes.push(message),
        onNote: (message) => notes.push(message),
      });

    await navigation([location]).goToDefinition();
    expect(opened).toHaveLength(1);
    expect(peeked).toHaveLength(0);

    await navigation([location, { ...location, line: 40 }]).goToDefinition();
    expect(opened).toHaveLength(1);
    expect(peeked).toHaveLength(1);

    await navigation([], ["No definition of “greet” was found."]).goToDefinition();
    expect(notes).toContain("No definition of “greet” was found.");
  });

  test("go to symbol in file turns the outline's 0-based column into an editor column", async () => {
    const peeked: Array<{ locations: Array<{ line: number; column: number; name: string }> }> = [];
    const navigation = createNavigator({
      api: {
        definition: async () => ({ path: "", word: "", language: "", definitions: [], notes: [] }),
        references: async () => ({
          root: "",
          path: "",
          word: "",
          language: "",
          references: [],
          files_searched: 0,
          truncated: false,
          notes: [],
        }),
        symbols: async () => ({
          path: "/w/src/a.ts",
          language: "typescript",
          symbols: [
            { name: "greet", kind: "function", line: 4, column: 16, container: null, exported: true },
          ],
        }),
      },
      active: () => ({ path: "/w/src/a.ts", text: "export function greet() {}\n" }),
      root: () => "/w",
      cursor: () => ({ line: 1, column: 1 }),
      positionAt: () => null,
      open: () => undefined,
      peek: (request) => peeked.push(request),
      onError: () => undefined,
      onNote: () => undefined,
    });
    await navigation.goToSymbol();
    expect(peeked[0]!.locations[0]).toMatchObject({ name: "greet", line: 4, column: 17 });
  });

  test("a modifier click asks for a definition; a plain click leaves the caret alone", async () => {
    let calls = 0;
    const navigation = createNavigator({
      api: {
        definition: async () => {
          calls += 1;
          return {
            path: "/w/src/a.ts",
            word: "greet",
            language: "typescript",
            definitions: [
              {
                path: "/w/src/thing.ts",
                relative: "src/thing.ts",
                name: "greet",
                kind: "function",
                line: 2,
                column: 17,
                length: 5,
                language: "typescript",
                source: "import \"./thing\"",
                excerpt: "export function greet() {}",
              },
            ],
            notes: [],
          };
        },
        references: async () => ({
          root: "/w",
          path: "/w/src/a.ts",
          word: "greet",
          language: "typescript",
          references: [],
          files_searched: 1,
          truncated: false,
          notes: [],
        }),
        symbols: async () => ({ path: "", language: "text", symbols: [] }),
      },
      active: () => ({ path: "/w/src/a.ts", text: "greet();\n" }),
      root: () => "/w",
      cursor: () => ({ line: 1, column: 1 }),
      positionAt: () => ({ line: 1, column: 1 }),
      open: () => undefined,
      peek: () => undefined,
      onError: () => undefined,
      onNote: () => undefined,
    });

    const plain = { button: 0, metaKey: false, ctrlKey: false, clientX: 5, clientY: 5, preventDefault() {} };
    navigation.handlePointer(plain as unknown as MouseEvent);
    expect(calls).toBe(0);

    const modified = { button: 0, metaKey: true, ctrlKey: false, clientX: 5, clientY: 5, preventDefault() {} };
    navigation.handlePointer(modified as unknown as MouseEvent);
    await settle();
    expect(calls).toBe(1);
  });
});

describe("a folder listing paints only while it is the newest", () => {
  test("a folder listing paints only while it is the newest for that folder, and other folders never cancel it", () => {
    const loads = createFolderLoads();
    const first = loads.start("/w/src");
    const second = loads.start("/w/src");
    expect(loads.isCurrent("/w/src", first)).toBe(false);
    expect(loads.isCurrent("/w/src", second)).toBe(true);

    const docs = loads.start("/w/docs");
    expect(loads.isCurrent("/w/src", second)).toBe(true);
    expect(loads.isCurrent("/w/docs", docs)).toBe(true);

    loads.start("/w/app");
    expect(loads.isCurrent("/w/src", second)).toBe(true);
    expect(loads.isCurrent("/w/unopened", 1)).toBe(false);
  });
});
