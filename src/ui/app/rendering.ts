import { cursorOf, type SurfaceEditor } from "../../editor";
import type { Platform } from "../../keymap";
import type { TabModel } from "../../tabs";
import type { Explorer } from "../explorer";
import type { Outline } from "../outline";
import type { Preview, PreviewTab } from "../preview";
import type { Sidebar } from "../sidebar";
import type { StatusBar } from "../statusbar";
import type { TabStrip } from "../tabs";
import { renderTitle, type Chrome } from "./chrome";
import type { AppState } from "./state";
import { renderWelcome } from "./welcome";

export interface RendererHost {
  chrome: Chrome;
  platform: Platform;
  state: AppState;
  tabs: TabModel;
  tabStrip: TabStrip;
  editor: SurfaceEditor;
  explorer: Explorer;
  outline: Outline;
  preview: Preview;
  sidebar: Sidebar;
  statusBar: StatusBar;
  openFolder(folder: string): void;
  openFile(path: string): void;
  schedulePersist(): void;
}

export interface Renderer {
  title(): void;
  status(): void;
  banner(): void;
  all(): void;
  syncOutline(force?: boolean): void;
}

export function createRenderer(host: RendererHost): Renderer {
  const { chrome, state, tabs, editor, outline, preview, sidebar } = host;

  function title(): void {
    renderTitle(
      chrome,
      {
        workspace: state.workspace,
        tab: tabs.active(),
        dirtyCount: tabs.dirtyTabs().length,
        previewOpen: preview.isOpen(),
      },
      host.platform,
    );
  }

  function status(): void {
    const active = tabs.active();
    host.statusBar.render({
      tab: active,
      cursor: state.cursor,
      lineCount: editor.view().state.doc.lines,
      dirty: active ? tabs.dirty(active) : false,
      settings: state.settings,
      note: state.note,
    });
  }

  function banner(): void {
    chrome.bannerText.textContent = state.error ?? "";
    chrome.banner.hidden = state.error === null;
  }

  function syncOutline(force = false): void {
    const active = tabs.active();
    const path = active === null || active.path.length === 0 ? null : active.path;
    if (!force && path === state.outlinePath) return;
    state.outlinePath = path;
    if (path === null) {
      outline.clear();
      return;
    }
    if (sidebar.isOpen() && sidebar.active() === "outline") void outline.refresh();
  }

  function all(): void {
    title();
    host.tabStrip.render(tabs.list(), tabs.activeId(), (tab) => tabs.dirty(tab));
    host.tabStrip.scrollActiveIntoView();
    renderWelcome(
      { section: chrome.welcome, editorHost: chrome.editorHost, recent: chrome.welcomeRecent },
      { tabCount: tabs.list().length, recentFolders: state.recentFolders, recentFiles: state.recentFiles },
      { openFolder: host.openFolder, openFile: host.openFile },
    );
    const active = tabs.active();
    const asset = active !== null && active.asset;
    // An image has no buffer to edit. The preview pane takes the whole main
    // area instead of showing an empty editor.
    chrome.main.classList.toggle("asset-mode", asset);
    const wasHidden = chrome.editorHost.hidden;
    if (active !== null && !asset) {
      chrome.editorHost.hidden = false;
      editor.show(active, state.settings);
      state.cursor = cursorOf(active.state);
      if (wasHidden) editor.measure();
    } else {
      chrome.editorHost.hidden = true;
    }
    host.explorer.setActivePath(active !== null && active.path.length > 0 ? active.path : null);
    const previewTab: PreviewTab | null =
      active === null
        ? null
        : {
            path: active.path,
            text: asset ? "" : active.state.doc.toString(),
            dirty: tabs.dirty(active),
            modifiedMs: active.modifiedMs,
          };
    if (active !== null && asset) {
      preview.showAsset({
        path: active.path,
        text: "",
        dirty: false,
        modifiedMs: active.modifiedMs,
      });
    } else {
      preview.endAsset();
      preview.update(previewTab);
    }
    syncOutline();
    status();
    banner();
    host.schedulePersist();
  }

  return { title, status, banner, all, syncOutline };
}
