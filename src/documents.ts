import type { EditorState } from "@codemirror/state";

import type { EditorApi } from "./api";
import type { FilePickRequest } from "./bridge";
import { LARGE_FILE_BYTES, baseName, formatBytes, isLargeFile, pathKey } from "./files";
import { languageFor, languageLabel, type LanguageId } from "./languages";
import type { EditorSettings } from "./session";
import { detectEol, messageOf, normalizeEol, toDiskText } from "./documents/text";

export { detectEol, normalizeEol, toDiskText } from "./documents/text";
import { createDiskWatcher } from "./documents/watch";
import { createExternalOps } from "./documents/external";
import type { Eol, Tab, TabModel, TabView } from "./tabs";

export type UnsavedChoice = "save" | "discard" | "cancel";

export type ConflictChoice = "overwrite" | "reload" | "keep" | "cancel";

export type ConflictKind = "save" | "reload";

export type ReconcileOutcome = "unchanged" | "reloaded" | "kept" | "missing" | "skipped";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface DocumentsDeps {
  api: Pick<EditorApi, "read" | "write" | "stat">;
  tabs: TabModel;
  createState(
    text: string,
    language: LanguageId,
    settings: EditorSettings,
    view?: Partial<TabView>,
    options?: { largeFile?: boolean },
  ): EditorState;
  capture(): TabView;
  settings(): EditorSettings;
  pickFile(request: FilePickRequest): Promise<string | null>;
  askUnsaved(name: string): Promise<UnsavedChoice>;
  askConflict?(kind: ConflictKind, name: string): Promise<ConflictChoice>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  reconfigureLanguage(language: LanguageId): void;
  preferredDirectory(): string | null;
  onChange(): void;
  onError(message: string): void;
  onNote(message: string): void;
}

export interface Documents {
  openPath(path: string, options?: OpenPathOptions): Promise<Tab | null>;
  openViaDialog(): Promise<void>;
  save(tabId: string): Promise<boolean>;
  saveActive(): Promise<boolean>;
  saveAs(tabId: string): Promise<boolean>;
  saveAsActive(): Promise<boolean>;
  saveAll(): Promise<number>;
  close(tabId: string): Promise<boolean>;
  closeActive(): Promise<boolean>;
  closeOthers(tabId: string): Promise<boolean>;
  closeAll(): Promise<boolean>;
  reopenClosed(): void;
  activate(tabId: string): void;
  next(): void;
  previous(): void;
  activateIndex(index: number): void;
  setLanguage(tabId: string, language: LanguageId): void;
  setEol(tabId: string, eol: Eol): void;
  restore(entries: readonly RestorableTab[], activePath: string | null): Promise<void>;
  rememberActive(): void;
  applyRenamed(from: string, to: string): number;
  applyDeleted(path: string): { closed: number; kept: readonly string[] };
  applyExternalWrite(paths: readonly string[]): Promise<{ reloaded: readonly string[]; kept: readonly string[] }>;
  reconcile(tabId: string): Promise<ReconcileOutcome>;
}

export interface OpenPathOptions {
  activate?: boolean;
  view?: Partial<TabView>;
  language?: LanguageId | null;
  quiet?: boolean;
}

export interface RestorableTab {
  path: string;
  language: LanguageId | null;
  eol: Eol;
  topLine: number;
  cursorLine: number;
  cursorColumn: number;
}

export function createDocuments(deps: DocumentsDeps): Documents {
  const { tabs } = deps;
  let busy = false;
  const writing = new Set<string>();
  const acknowledged = new Map<string, number>();
  const checking = new Set<string>();

  const askConflict = (kind: ConflictKind, name: string): Promise<ConflictChoice> =>
    deps.askConflict === undefined ? Promise.resolve("cancel") : deps.askConflict(kind, name);

  const rememberActive = (): void => {
    const active = tabs.active();
    if (active) tabs.remember(active.id, deps.capture());
  };

  const watcher = createDiskWatcher(deps, { acknowledged, checking, writing }, askConflict);
  const reconcile = watcher.reconcile;

  async function openPath(path: string, options: OpenPathOptions = {}): Promise<Tab | null> {
    const existing = tabs.findPath(path);
    if (existing) {
      if (options.activate !== false) {
        rememberActive();
        tabs.activate(existing.id);
        deps.onChange();
        void reconcile(existing.id);
      }
      return existing;
    }

    try {
      const [read, info] = await Promise.all([deps.api.read(path), deps.api.stat(path)]);
      const eol = detectEol(read.content);
      const text = normalizeEol(read.content);
      const language = options.language ?? languageFor(path);
      const bytes = read.bytes;
      const largeFile = isLargeFile(bytes);
      const state = deps.createState(text, language, deps.settings(), options.view, { largeFile });
      const { tab } = tabs.open({
        path,
        state,
        savedText: text,
        language,
        languageOverridden: options.language !== undefined && options.language !== null,
        eol,
        modifiedMs: info.exists ? info.modified_ms ?? null : read.modified_ms ?? null,
        bytes,
        view: options.view,
        activate: options.activate,
      });
      if (largeFile && options.quiet !== true) {
        deps.onNote(
          `${baseName(path)} is ${formatBytes(bytes)}; syntax highlighting is off above ${formatBytes(LARGE_FILE_BYTES)} so that typing stays responsive.`,
        );
      }
      deps.onChange();
      return tab;
    } catch (error) {
      if (options.quiet !== true) deps.onError(`Could not open ${baseName(path)}: ${messageOf(error)}`);
      return null;
    }
  }

  async function openViaDialog(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const directory = deps.preferredDirectory();
      const chosen = await deps.pickFile({
        mode: "open",
        title: "Open a file in the Editor",
        ...(directory === null ? {} : { defaultPath: directory }),
      });
      if (chosen === null) {
        deps.onNote("nothing was opened");
        return;
      }
      await openPath(chosen);
      deps.onNote(`opened ${baseName(chosen)}`);
    } catch (error) {
      deps.onError(`Could not open a file: ${messageOf(error)}`);
    } finally {
      busy = false;
    }
  }

  async function writeTab(tab: Tab, target: string): Promise<boolean> {
    if (writing.has(tab.id)) return false;
    writing.add(tab.id);
    try {
      if (pathKey(target) === pathKey(tab.path)) {
        const disk = await watcher.diskMovedOn(tab);
        if (disk.changed && disk.exists) {
          const choice = await askConflict("save", tab.name);
          if (choice === "cancel") {
            deps.onNote(
              `${tab.name} was not saved: it changed on disk and the overwrite was cancelled. Reload it to see what is there now.`,
            );
            return false;
          }
          if (choice === "reload") {
            const reloaded = await watcher.reloadFromDisk(tab);
            deps.onNote(
              reloaded
                ? `${tab.name} was reloaded from disk; nothing was saved over it`
                : `${tab.name} could not be reloaded, so nothing was saved over it`,
            );
            return false;
          }
        }
      }
      const diskText = toDiskText(tab.state.doc.toString(), tab.eol);
      const answer = await deps.api.write(target, diskText);
      const info = await deps.api.stat(target).catch(() => null);
      if (target !== tab.path) tabs.renamePath(tab.id, target);
      tabs.markSaved(tab.id, {
        bytes: answer.bytes,
        modifiedMs: info !== null && info.exists ? info.modified_ms ?? null : null,
      });
      acknowledged.delete(tab.id);
      deps.onNote(`saved ${baseName(target)}`);
      deps.onChange();
      return true;
    } catch (error) {
      deps.onError(`Could not save ${baseName(target)}: ${messageOf(error)}`);
      return false;
    } finally {
      writing.delete(tab.id);
    }
  }

  async function save(tabId: string): Promise<boolean> {
    const tab = tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab) return false;
    if (tab.path.length === 0) return saveAs(tabId);
    return writeTab(tab, tab.path);
  }

  async function saveAs(tabId: string): Promise<boolean> {
    const tab = tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab) return false;
    if (busy) return false;
    busy = true;
    try {
      const target = await deps.pickFile({
        mode: "save",
        title: `Save ${tab.name} as…`,
        defaultPath: tab.path.length > 0 ? tab.path : deps.preferredDirectory() ?? undefined,
      });
      if (target === null) {
        deps.onNote("nothing was saved");
        return false;
      }
      return await writeTab(tab, target);
    } catch (error) {
      deps.onError(`Could not save ${tab.name}: ${messageOf(error)}`);
      return false;
    } finally {
      busy = false;
    }
  }

  async function saveAll(): Promise<number> {
    let saved = 0;
    for (const tab of tabs.list()) {
      if (!tabs.dirty(tab)) continue;
      if (!(await save(tab.id))) break;
      saved += 1;
    }
    if (saved === 0) deps.onNote("there was nothing to save");
    return saved;
  }

  async function close(tabId: string): Promise<boolean> {
    const tab = tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab) return false;
    if (busy) return false;
    if (tabs.activeId() === tabId) rememberActive();
    if (tabs.dirty(tab)) {
      busy = true;
      let choice: UnsavedChoice;
      try {
        choice = await deps.askUnsaved(tab.name);
      } finally {
        busy = false;
      }
      if (choice === "cancel") return false;
      if (choice === "save" && !(await save(tab.id))) return false;
    }
    tabs.close(tab.id);
    deps.onChange();
    return true;
  }

  async function closeOthers(tabId: string): Promise<boolean> {
    for (const tab of [...tabs.list()]) {
      if (tab.id === tabId) continue;
      if (!(await close(tab.id))) return false;
    }
    return true;
  }

  async function closeAll(): Promise<boolean> {
    for (const tab of [...tabs.list()]) {
      if (!(await close(tab.id))) return false;
    }
    return true;
  }

  function reopenClosed(): void {
    const closed = tabs.takeClosed();
    if (closed === null) {
      deps.onNote("there is no closed tab to bring back");
      return;
    }
    const state = deps.createState(closed.savedText, closed.language, deps.settings(), {
      scrollTop: 0,
      topLine: 1,
      cursorLine: 1,
      cursorColumn: 1,
    });
    tabs.open({
      path: closed.path,
      state,
      savedText: closed.savedText,
      language: closed.language,
      languageOverridden: closed.languageOverridden,
      eol: closed.eol,
      modifiedMs: closed.modifiedMs,
      bytes: closed.bytes,
      view: { scrollTop: 0, topLine: 1, cursorLine: 1, cursorColumn: 1 },
      activate: true,
    });
    deps.onChange();
  }

  function activate(tabId: string): void {
    const tab = tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab) return;
    rememberActive();
    tabs.activate(tabId);
    deps.onChange();
    void reconcile(tabId);
  }

  function next(): void {
    rememberActive();
    tabs.next();
    deps.onChange();
    const active = tabs.active();
    if (active !== null) void reconcile(active.id);
  }

  function previous(): void {
    rememberActive();
    tabs.previous();
    deps.onChange();
    const active = tabs.active();
    if (active !== null) void reconcile(active.id);
  }

  function activateIndex(index: number): void {
    rememberActive();
    tabs.activateIndex(index);
    deps.onChange();
    const active = tabs.active();
    if (active !== null) void reconcile(active.id);
  }

  function setLanguage(tabId: string, language: LanguageId): void {
    const tab = tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab || tab.language === language) return;
    tabs.setLanguage(tabId, language, true);
    if (tabs.activeId() === tabId) deps.reconfigureLanguage(language);
    deps.onNote(`${tab.name}: language is now ${languageLabel(language)}`);
    deps.onChange();
  }

  function setEol(tabId: string, eol: Eol): void {
    const tab = tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab) return;
    tabs.setEol(tabId, eol);
    deps.onNote(`${tab.name} will be saved with ${eol === "crlf" ? "CRLF" : "LF"} line endings`);
    deps.onChange();
  }

  const external = createExternalOps(deps, tabs);
  const applyRenamed = external.applyRenamed;
  const applyDeleted = external.applyDeleted;
  const applyExternalWrite = external.applyExternalWrite;

  async function restore(entries: readonly RestorableTab[], activePath: string | null): Promise<void> {
    const failed: string[] = [];
    for (const entry of entries) {
      const tab = await openPath(entry.path, {
        activate: false,
        quiet: true,
        language: entry.language,
        view: {
          topLine: entry.topLine,
          cursorLine: entry.cursorLine,
          cursorColumn: entry.cursorColumn,
        },
      });
      if (tab === null) failed.push(baseName(entry.path));
    }
    if (activePath !== null) {
      const active = tabs.findPath(activePath);
      if (active) tabs.activate(active.id);
    } else if (tabs.activeId() === null) {
      const first = tabs.list()[0];
      if (first) tabs.activate(first.id);
    }
    if (failed.length > 0) {
      deps.onError(
        `Could not reopen ${failed.length === 1 ? "a file" : `${failed.length} files`} from the last session: ${failed.join(", ")}. It may have been moved or deleted.`,
      );
    }
    deps.onChange();
  }

  return {
    openPath,
    openViaDialog,
    save,
    saveActive: () => {
      const active = tabs.active();
      return active ? save(active.id) : Promise.resolve(false);
    },
    saveAs,
    saveAsActive: () => {
      const active = tabs.active();
      return active ? saveAs(active.id) : Promise.resolve(false);
    },
    saveAll,
    close,
    closeActive: () => {
      const active = tabs.active();
      return active ? close(active.id) : Promise.resolve(false);
    },
    closeOthers,
    closeAll,
    reopenClosed,
    activate,
    next,
    previous,
    activateIndex,
    setLanguage,
    setEol,
    restore,
    rememberActive,
    applyRenamed,
    applyDeleted,
    applyExternalWrite,
    reconcile,
  };
}
