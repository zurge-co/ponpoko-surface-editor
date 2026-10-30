import type { EditorApi } from "../api";
import type { Tab, TabModel } from "../tabs";
import { baseName, isLargeFile } from "../files";
import { detectEol, detectIndentation, messageOf, normalizeEol } from "./text";
import type { ConflictChoice, ConflictKind, DocumentsDeps, ReconcileOutcome } from "../documents";

export interface WatchPorts {
  api: Pick<EditorApi, "read" | "stat">;
  tabs: TabModel;
  createState: DocumentsDeps["createState"];
  settings: DocumentsDeps["settings"];
  onChange: DocumentsDeps["onChange"];
  onError: DocumentsDeps["onError"];
  onNote: DocumentsDeps["onNote"];
}

export interface WatchState {
  acknowledged: Map<string, number>;
  checking: Set<string>;
  writing: Set<string>;
}

export function createDiskWatcher(
  ports: WatchPorts,
  watch: WatchState,
  askConflict: (kind: ConflictKind, name: string) => Promise<ConflictChoice>,
) {
  async function diskMovedOn(tab: Tab): Promise<{ changed: boolean; exists: boolean; modifiedMs: number | null }> {
    if (tab.path.length === 0) return { changed: false, exists: true, modifiedMs: null };
    try {
      const info = await ports.api.stat(tab.path);
      const disk = info.modified_ms ?? null;
      if (!info.exists) return { changed: true, exists: false, modifiedMs: disk };
      if (tab.modifiedMs === null || disk === null) return { changed: false, exists: true, modifiedMs: disk };
      return { changed: disk !== tab.modifiedMs, exists: true, modifiedMs: disk };
    } catch {
      return { changed: false, exists: true, modifiedMs: null };
    }
  }

  async function reloadFromDisk(tab: Tab): Promise<boolean> {
    try {
      const read = await ports.api.read(tab.path);
      const text = normalizeEol(read.content);
      // The file may have been rewritten with the other line ending; follow
      // the bytes on disk rather than the line ending the tab remembered.
      const eol = detectEol(read.content);
      ports.tabs.setEol(tab.id, eol);
      const settings = ports.settings();
      let tabSize = settings.tabSize;
      let insertSpaces = settings.insertSpaces;
      if (tab.indentationPinned) {
        // The human chose this file's indentation; re-reading the file must
        // not take that choice away.
        tabSize = tab.tabSize;
        insertSpaces = tab.insertSpaces;
      } else {
        const guess = detectIndentation(text);
        tabSize = guess?.tabSize ?? settings.tabSize;
        insertSpaces = guess?.insertSpaces ?? settings.insertSpaces;
        ports.tabs.setIndentation(tab.id, tabSize, insertSpaces, guess !== null, false);
      }
      const state = ports.createState(
        text,
        tab.language,
        { ...settings, tabSize, insertSpaces },
        {
          topLine: tab.view.topLine,
          cursorLine: tab.view.cursorLine,
          cursorColumn: tab.view.cursorColumn,
        },
        { largeFile: isLargeFile(read.bytes) },
      );
      ports.tabs.update(tab.id, state);
      ports.tabs.markSaved(tab.id, { bytes: read.bytes, modifiedMs: read.modified_ms ?? null });
      watch.acknowledged.delete(tab.id);
      ports.onChange();
      return true;
    } catch (error) {
      ports.onError(`Could not reload ${baseName(tab.path)} from disk: ${messageOf(error)}`);
      return false;
    }
  }

  async function reconcile(tabId: string): Promise<ReconcileOutcome> {
    const tab = ports.tabs.list().find((candidate) => candidate.id === tabId);
    if (!tab || tab.path.length === 0 || watch.checking.has(tabId) || watch.writing.has(tabId)) return "skipped";
    watch.checking.add(tabId);
    try {
      const disk = await diskMovedOn(tab);
      if (!disk.changed) return "unchanged";
      const current = ports.tabs.list().find((candidate) => candidate.id === tabId) ?? null;
      if (current === null) return "skipped";
      if (!disk.exists) {
        ports.onError(
          `${current.name} is no longer on disk. This tab still holds the text that was last saved there; Save As writes it somewhere else.`,
        );
        return "missing";
      }
      if (!ports.tabs.dirty(current)) {
        const reloaded = await reloadFromDisk(current);
        if (reloaded) ports.onNote(`${current.name} was reloaded: it changed on disk`);
        return reloaded ? "reloaded" : "kept";
      }
      if (disk.modifiedMs !== null && watch.acknowledged.get(tabId) === disk.modifiedMs) return "kept";
      const choice = await askConflict("reload", current.name);
      if (choice === "reload") {
        const reloaded = await reloadFromDisk(current);
        if (reloaded) ports.onNote(`${current.name} was reloaded from disk; the unsaved edits in this tab were discarded`);
        return reloaded ? "reloaded" : "kept";
      }
      if (disk.modifiedMs !== null) watch.acknowledged.set(tabId, disk.modifiedMs);
      ports.onNote(
        `${current.name} changed on disk; this tab kept its unsaved edits. Saving will ask before it overwrites the file.`,
      );
      return "kept";
    } finally {
      watch.checking.delete(tabId);
    }
  }

  return { diskMovedOn, reloadFromDisk, reconcile };
}
