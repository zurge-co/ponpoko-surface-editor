export const { describe, test, expect } = await import("bun:test");

import type { HostTransport } from "../src/bridge";
import type { EditorApi } from "../src/api";
import type { ConflictChoice, Documents, UnsavedChoice } from "../src/documents";
import type { EditorSettings, StorageLike } from "../src/session";


export const {
  SURFACE_VERBS,
  HOST_HELLO,
  SURFACE_BRIDGE_CHANNEL,
  SURFACE_READY,
  createSurfaceLink,
  viewTokenFromLocation,
} = await import("../src/bridge");
export const { SURFACE_BRIDGE_VERBS } = await import("./hostContract");

export const EDITOR_MANIFEST = (await Bun.file(
  new URL("../surface.json", import.meta.url),
).json()) as { methods: string[] };
export const declaredMethods = (): string[] => EDITOR_MANIFEST.methods;
export const { LARGE_FILE_BYTES, baseName, dirName, formatBytes, isLargeFile, joinPath, relativePath, shortenPath } =
  await import("../src/files");
export const {
  LANGUAGES,
  isLanguageId,
  languageChoices,
  languageExtension,
  languageFor,
  languageLabel,
} = await import("../src/languages");
export const { createDocumentState } = await import("../src/state");
export const { createTabModel } = await import("../src/tabs");
export const { createDocuments, detectEol, normalizeEol, toDiskText } = await import(
  "../src/documents"
);
export const { APP_KEYBINDINGS, EDITOR_KEYBINDINGS, installAppKeymap, keyLabel, matchesKey, parseKey } = await import(
  "../src/keymap"
);
export const {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  DEFAULT_SIDEBAR,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_STORAGE_KEY,
  debounce,
  normalizeSession,
  normalizeSettings,
  normalizeSidebarState,
  persistedTabs,
  readSession,
  readSettings,
  readSidebar,
  rememberRecent,
  writeSession,
  writeSettings,
  writeSidebar,
} = await import("../src/session");
export const { createCommandRegistry } = await import("../src/ui/commands");
export const { fuzzyMatch, rankCandidates } = await import("../src/ui/palette");
export const { fileCandidates } = await import("../src/ui/quickopen");
export const { compareEntries, createFolderLoads, entryIcon, explorerRows, nameProblem, visibleEntries } = await import(
  "../src/ui/explorer"
);
export const { createOps } = await import("../src/ui/explorer/ops");
export const { attachTransfer, entriesToItems, itemsFromDataTransfer } = await import(
  "../src/ui/explorer/transfer"
);
export const {
  assignNames,
  bytesToBase64,
  countItems,
  pasteDirectory,
  pathsFromUriList,
  uniqueName,
} = await import("../src/transfer");
export const { filterOutline, outlineRows, symbolIcon } = await import("../src/ui/outline");
export const { PONPOKO_COLORS } = await import("../src/theme");
export const { editorConfigMatch, parseEditorConfig, resolveEditorConfig } = await import(
  "../src/editorconfig"
);
export const {
  FormatError,
  formatDocument,
  formatEngineLabel,
  formatTarget,
  nearestPosition,
  noFormatterSentence,
  parseJsonLoose,
  resolvePrettierOptions,
} = await import("../src/format");
export const {
  HTML_PREVIEW_SANDBOX,
  IMAGE_EXTENSIONS,
  dataUrl,
  languageFromFence,
  previewKindFor,
  headingSlug,
  previewPolicy,
  resolveReference,
} = await import("../src/ui/preview");
export const {
  groupMatches,
  replaceConfirmMessage,
  replacementSummary,
  searchOptions,
  searchSummary,
} = await import("../src/ui/search");
export const { createApi } = await import("../src/api");
export const {
  createNavigator,
  dedupeLocations,
  isNavigationClick,
  locationLabel,
  navigationClickLabel,
  wordAt,
} = await import("../src/navigation");
export const { locationDetail, peekSummary } = await import("../src/ui/peek");
export const { navigationMenuEntries } = await import("../src/ui/menu");

export const VIEW = "view-token-editor";

export const SETTINGS: EditorSettings = {
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  restoreSession: true,
};

export function fakeHost() {
  const posted: Array<Record<string, unknown>> = [];
  const subscribers: Array<(message: unknown) => void> = [];
  const transport: HostTransport = {
    post: (message) => {
      posted.push(message as Record<string, unknown>);
    },
    subscribe: (handler) => {
      subscribers.push(handler);
      return () => {
        const index = subscribers.indexOf(handler);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
  };
  return {
    transport,
    posted,
    deliver: (message: unknown) => subscribers.forEach((handler) => handler(message)),
  };
}

export function link(host: ReturnType<typeof fakeHost>) {
  let counter = 0;
  return createSurfaceLink({
    view: VIEW,
    transport: host.transport,
    newId: () => `call-${++counter}`,
  });
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export function keyEvent(init: {
  key: string;
  code?: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? "",
    metaKey: init.meta === true,
    ctrlKey: init.ctrl === true,
    shiftKey: init.shift === true,
    altKey: init.alt === true,
  } as KeyboardEvent;
}

export function stateOf(text: string, language: string = "text") {
  return createDocumentState(text, {
    language: language as Parameters<typeof createDocumentState>[1]["language"],
    settings: SETTINGS,
  });
}

export function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}



export interface Harness {
  documents: Documents;
  tabs: ReturnType<typeof createTabModel>;
  store: Map<string, string>;
  modified: Map<string, number>;
  log: string[];
  errors: string[];
  notes: string[];
  conflicts: string[];
  stateOptions: Array<{ largeFile?: boolean } | undefined>;
  pick(value: string | null): void;
  answerDialog(...choices: UnsavedChoice[]): void;
  answerConflict(...choices: ConflictChoice[]): void;
  externalWrite(path: string, content: string): void;
  failRead(message: string): void;
  failWrite(message: string): void;
  renders(): number;
}

export function harness(): Harness {
  const store = new Map<string, string>();
  const modified = new Map<string, number>();
  const log: string[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const conflicts: string[] = [];
  const stateOptions: Array<{ largeFile?: boolean } | undefined> = [];
  const answers: UnsavedChoice[] = [];
  const conflictAnswers: ConflictChoice[] = [];
  let picked: string | null = null;
  let readFailure: string | null = null;
  let writeFailure: string | null = null;
  let renders = 0;
  const tabs = createTabModel();

  const api: Pick<EditorApi, "read" | "write" | "stat"> = {
    async read(path) {
      log.push(`read:${path}`);
      if (readFailure !== null) throw new Error(readFailure);
      const content = store.get(path);
      if (content === undefined) throw new Error(`there is no file at ${path}`);
      return { path, content, bytes: content.length, modified_ms: modified.get(path) ?? 0 };
    },
    async write(path, content) {
      log.push(`write:${path}`);
      if (writeFailure !== null) throw new Error(writeFailure);
      store.set(path, content);
      modified.set(path, (modified.get(path) ?? 0) + 1);
      return { path, bytes: content.length };
    },
    async stat(path) {
      const content = store.get(path);
      return {
        path,
        exists: content !== undefined,
        is_file: content !== undefined,
        is_dir: false,
        bytes: content?.length ?? 0,
        modified_ms: modified.get(path) ?? 0,
      };
    },
  };

  const documents = createDocuments({
    api,
    tabs,
    createState: (text, language, settings, view, options) => {
      stateOptions.push(options);
      const state = createDocumentState(text, { language, settings, largeFile: options?.largeFile });
      if (view?.cursorLine === undefined) return state;
      const line = state.doc.line(Math.min(state.doc.lines, Math.max(1, view.cursorLine)));
      return state.update({ selection: { anchor: line.from } }).state;
    },
    capture: () => ({ scrollTop: 120, topLine: 9, cursorLine: 3, cursorColumn: 4 }),
    settings: () => SETTINGS,
    pickFile: async (request) => {
      log.push(`pick:${request.mode}${request.directory === true ? ":directory" : ""}`);
      return picked;
    },
    askUnsaved: async (name) => {
      log.push(`ask:${name}`);
      return answers.shift() ?? "cancel";
    },
    askConflict: async (kind, name) => {
      conflicts.push(`${kind}:${name}`);
      return conflictAnswers.shift() ?? "cancel";
    },
    confirm: async () => true,
    reconfigureLanguage: (language) => log.push(`language:${language}`),
    preferredDirectory: () => "/tmp",
    onChange: () => {
      renders += 1;
    },
    onError: (message) => errors.push(message),
    onNote: (message) => notes.push(message),
  });

  return {
    documents,
    tabs,
    store,
    modified,
    log,
    errors,
    notes,
    conflicts,
    stateOptions,
    pick: (value) => {
      picked = value;
    },
    answerDialog: (...choices) => {
      answers.push(...choices);
    },
    answerConflict: (...choices) => {
      conflictAnswers.push(...choices);
    },
    externalWrite: (path, content) => {
      store.set(path, content);
      modified.set(path, (modified.get(path) ?? 0) + 1);
    },
    failRead: (message) => {
      readFailure = message;
    },
    failWrite: (message) => {
      writeFailure = message;
    },
    renders: () => renders,
  };
}
