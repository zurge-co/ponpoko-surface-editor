import type { EditorApi } from "../api";
import type { TabModel } from "../tabs";
import type { DocumentsDeps } from "../documents";
import { baseName } from "../files";
import { normalizeEol } from "./text";

export interface ExternalPorts {
  api: Pick<EditorApi, "read">;
  createState: DocumentsDeps["createState"];
  settings: DocumentsDeps["settings"];
  onChange: DocumentsDeps["onChange"];
  onError: DocumentsDeps["onError"];
  onNote: DocumentsDeps["onNote"];
}

export function createExternalOps(ports: ExternalPorts, tabs: TabModel) {
  const deps = ports;
  function applyRenamed(from: string, to: string): number {
    const moved = tabs.renamePrefix(from, to);
    if (moved.length > 0) {
      deps.onNote(
        `${baseName(from)} is now ${baseName(to)}, and ${moved.length === 1 ? "an open tab followed it" : `${moved.length} open tabs followed it`}`,
      );
      deps.onChange();
    }
    return moved.length;
  }

  function applyDeleted(path: string): { closed: number; kept: readonly string[] } {
    const kept: string[] = [];
    let closed = 0;
    for (const tab of tabs.tabsUnder(path)) {
      if (tabs.dirty(tab)) {
        kept.push(tab.name);
        continue;
      }
      tabs.drop(tab.id);
      closed += 1;
    }
    if (closed > 0) {
      deps.onNote(
        `${closed === 1 ? "a tab was closed" : `${closed} tabs were closed`} because ${baseName(path)} was deleted`,
      );
    }
    if (kept.length > 0) {
      deps.onError(
        `${baseName(path)} was deleted, but ${kept.length === 1 ? `the tab for ${kept[0]} still has unsaved changes` : `${kept.length} open tabs still have unsaved changes (${kept.join(", ")})`}. Use Save As to keep them.`,
      );
    }
    if (closed > 0 || kept.length > 0) deps.onChange();
    return { closed, kept };
  }

  async function applyExternalWrite(
    paths: readonly string[],
  ): Promise<{ reloaded: readonly string[]; kept: readonly string[] }> {
    const reloaded: string[] = [];
    const kept: string[] = [];
    for (const path of paths) {
      const tab = tabs.findPath(path);
      if (tab === null) continue;
      if (tabs.dirty(tab)) {
        kept.push(tab.name);
        continue;
      }
      try {
        const read = await deps.api.read(tab.path);
        const text = normalizeEol(read.content);
        const state = deps.createState(text, tab.language, deps.settings(), {
          topLine: tab.view.topLine,
          cursorLine: tab.view.cursorLine,
          cursorColumn: tab.view.cursorColumn,
        });
        tabs.update(tab.id, state);
        tabs.markSaved(tab.id, { bytes: read.bytes, modifiedMs: read.modified_ms ?? null });
        reloaded.push(tab.name);
      } catch {
        kept.push(tab.name);
      }
    }
    if (reloaded.length > 0) {
      deps.onNote(
        `${reloaded.length === 1 ? "a tab was reloaded" : `${reloaded.length} tabs were reloaded`} from disk after a change outside the editor (${reloaded.join(", ")})`,
      );
    }
    if (kept.length > 0) {
      deps.onError(
        `${kept.length === 1 ? `${kept[0]} has unsaved edits` : `${kept.join(", ")} have unsaved edits`} and was not reloaded from disk. Saving ${kept.length === 1 ? "it" : "them"} would undo the change that just happened outside the editor.`,
      );
    }
    if (reloaded.length > 0 || kept.length > 0) deps.onChange();
    return { reloaded, kept };
  }

  return { applyRenamed, applyDeleted, applyExternalWrite };
}
