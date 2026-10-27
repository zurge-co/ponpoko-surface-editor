import type { SearchMatch } from "../../api";
import type { SurfaceLink } from "../../bridge";
import type { SurfaceEditor } from "../../editor";
import { baseName } from "../../files";
import type { NavigationLocation } from "../../navigation";
import { locationLabel } from "../../navigation";
import { rememberRecent } from "../../session";
import type { TabModel } from "../../tabs";
import type { Explorer } from "../explorer";
import type { Peek } from "../peek";
import type { Sidebar } from "../sidebar";
import type { AppState } from "./state";

export interface OpenerHost {
  state: AppState;
  link: SurfaceLink;
  tabs: TabModel;
  editor: SurfaceEditor;
  explorer: Explorer;
  sidebar: Sidebar;
  peek: Peek;
  render(): void;
  persistNow(): void;
  showNote(message: string): void;
  showError(message: string): void;
}

export interface Opener {
  openFolder(folder: string): void;
  chooseFolder(): Promise<void>;
  openFile(): Promise<void>;
  openRecentFile(path: string): Promise<void>;
  openLocation(location: NavigationLocation): Promise<void>;
  openMatch(match: SearchMatch): Promise<void>;
}

export function createOpener(host: OpenerHost): Opener {
  const { state, tabs, editor, explorer, sidebar } = host;

  function addRecentFile(path: string): void {
    state.recentFiles = rememberRecent(state.recentFiles, path);
  }

  function openFolder(folder: string): void {
    state.workspace = folder;
    state.recentFolders = rememberRecent(state.recentFolders, folder);
    host.showNote(`folder: ${baseName(folder)}`);
    sidebar.show("explorer");
    explorer.setRoot(folder);
    host.render();
    host.persistNow();
  }

  async function chooseFolder(): Promise<void> {
    try {
      const picked = await host.link.pickFile({
        mode: "open",
        directory: true,
        title: "Open a folder in the Editor",
        ...(state.workspace === null ? {} : { defaultPath: state.workspace }),
      });
      if (picked === null) {
        host.showNote("no folder was opened");
        return;
      }
      openFolder(picked);
    } catch (failure) {
      host.showError(`Could not open a folder: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  async function openFile(): Promise<void> {
    const documents = state.documents;
    if (!documents) return;
    const before = tabs.activeId();
    await documents.openViaDialog();
    const active = tabs.active();
    if (active && active.id !== before) {
      addRecentFile(active.path);
      editor.focus();
      host.persistNow();
    }
  }

  async function openRecentFile(path: string): Promise<void> {
    const documents = state.documents;
    if (!documents) return;
    const tab = await documents.openPath(path);
    if (tab) {
      addRecentFile(path);
      editor.focus();
      host.persistNow();
      void explorer.revealActive();
    }
  }

  async function openLocation(location: NavigationLocation): Promise<void> {
    const documents = state.documents;
    if (!documents) return;
    const tab = await documents.openPath(location.path);
    if (tab === null) return;
    host.peek.hide();
    addRecentFile(tab.path);
    host.persistNow();
    editor.select(location.line, location.column, location.length);
    host.showNote(`${locationLabel(location)} · ${location.kind}`);
  }

  async function openMatch(match: SearchMatch): Promise<void> {
    const documents = state.documents;
    if (!documents) return;
    const tab = await documents.openPath(match.path);
    if (tab === null) return;
    addRecentFile(tab.path);
    host.persistNow();
    editor.select(match.line, match.column + 1, match.length);
  }

  return { openFolder, chooseFolder, openFile, openRecentFile, openLocation, openMatch };
}
