import { createApi } from "../../api";
import type { SurfaceLink } from "../../bridge";
import { createDocuments } from "../../documents";
import { mountEditor, type EditorUpdate, type SurfaceEditor } from "../../editor";
import { dirName } from "../../files";
import { detectPlatform, editorKeymap, installAppKeymap, type KeymapHost, type Platform } from "../../keymap";
import { createNavigator } from "../../navigation";
import {
  browserStorage,
  debounce,
  persistedTabs,
  readSession,
  readSettings,
  writeSession,
  writeSettings,
  type EditorSettings,
  type StorageLike,
} from "../../session";
import { createTabModel } from "../../tabs";
import { createChrome } from "./chrome";
import { copyText, revealPath, type NotifyHost } from "./clipboard";
import { registerCommands } from "./commands";
import { createCommandRegistry, type CommandRegistry } from "../commands";
import { createDialogHost } from "../dialog";
import { createExplorer } from "../explorer";
import { installLifecycle, restoreSession, wireLink } from "./lifecycle";
import { showEditorMenu, showTabMenu, type MenuHost } from "./menus";
import { createOpener } from "./opening";
import { createOutline } from "../outline";
import { isPaletteOpen, createCommandPalette } from "../palette";
import { createPeek } from "../peek";
import { createPreview } from "../preview";
import { createQuickOpen } from "../quickopen";
import { createRenderer } from "./rendering";
import { createSearchPanel } from "../search";
import { createSettingsSheet } from "../settings";
import { createSidebar } from "../sidebar";
import { createStatusBar } from "../statusbar";
import { createTabStrip } from "../tabs";
import type { AppState } from "./state";

export interface EditorAppOptions {
  root: HTMLElement;
  link: SurfaceLink;
  storage?: StorageLike | null;
  platform?: Platform;
}

export interface EditorApp {
  destroy(): void;
  tabs(): ReturnType<typeof createTabModel>;
  render(): void;
}

export function createEditorApp(options: EditorAppOptions): EditorApp {
  const platform = options.platform ?? detectPlatform();
  const storage = options.storage === undefined ? browserStorage() : options.storage;

  const persisted = readSession(storage);
  const state: AppState = {
    settings: readSettings(storage),
    workspace: persisted.workspace,
    recentFolders: [...persisted.recentFolders],
    recentFiles: [...persisted.recentFiles],
    note: "",
    error: null,
    cursor: { line: 1, column: 1, selected: 0, selections: 1 },
    outlinePath: null,
    documents: null,
  };
  let registry: CommandRegistry;

  const api = createApi(options.link);
  const tabs = createTabModel();

  const chrome = createChrome(options.root, platform);
  const { body, main, editorHost, tabstripHost } = chrome;

  const statusBar = createStatusBar({
    setLanguage(language) {
      const active = tabs.active();
      if (active) state.documents?.setLanguage(active.id, language);
    },
    setEol(eol) {
      const active = tabs.active();
      if (active) state.documents?.setEol(active.id, eol);
    },
    openSettings() {
      settingsSheet.open(state.settings);
    },
  });
  chrome.statusHost.append(statusBar.element);

  const dialogs = createDialogHost(document.body);
  const tabStrip = createTabStrip({
    activate(id) {
      state.documents?.activate(id);
    },
    close(id) {
      void state.documents?.close(id);
    },
    contextMenu(id, event) {
      const tab = tabs.list().find((candidate) => candidate.id === id);
      if (!tab) return;
      showTabMenu(tab, { x: event.clientX, y: event.clientY }, menus);
    },
  });
  tabstripHost.append(tabStrip.element);

  const sink: KeymapHost = {
    run(command) {
      if (isPaletteOpen()) return;
      if ((dialogs.isOpen() || settingsSheet.isOpen()) && command !== "view.settings") return;
      void registry.run(command);
    },
  };

  const editor: SurfaceEditor = mountEditor(
    editorHost,
    {
      onUpdate(update: EditorUpdate) {
        const active = tabs.active();
        if (!active) return;
        tabs.update(active.id, update.state);
        state.cursor = update.cursor;
        tabs.remember(active.id, { cursorLine: update.cursor.line, cursorColumn: update.cursor.column });
        if (update.docChanged || update.selectionChanged) {
          const current = tabs.active();
          tabStrip.setDirty(active.id, current !== null && tabs.dirty(current));
          renderer.title();
          renderer.status();
          schedulePersist();
          if (update.docChanged) scheduleOutlineRefresh();
          if (update.docChanged) preview.schedule();
        }
      },
      onScroll() {
        schedulePersist();
      },
      onContextMenu(event) {
        showEditorMenu({ x: event.clientX, y: event.clientY }, menus);
      },
    },
    { settings: state.settings, keymap: editorKeymap(sink) },
  );

  const settingsSheet = createSettingsSheet({
    change(next) {
      updateSettings(next, "");
    },
  });
  document.body.append(settingsSheet.element);
  chrome.buttons.settings.addEventListener("click", () => settingsSheet.open(state.settings));

  const sidebar = createSidebar({ storage });

  const outline = createOutline({
    symbols: (path, text) => api.symbols(path, text),
    active() {
      const tab = tabs.active();
      if (tab === null) return null;
      return { path: tab.path, text: tab.state.doc.toString() };
    },
    reveal(line) {
      editor.reveal(line);
    },
    onError: showError,
  });

  const explorer = createExplorer({
    fs: {
      list: (path, options) => api.list(path, options),
      create: (path, kind) => api.create(path, kind),
      copy: (from, to) => api.copy(from, to),
      writeAsset: (path, base64) => api.writeAsset(path, base64),
      rename: (path, to) => api.rename(path, to),
      remove: (path, options) => api.remove(path, options),
      stat: (path) => api.stat(path),
      reveal: (path) => api.reveal(path),
    },
    root: () => state.workspace,
    activePath: () => tabs.active()?.path ?? null,
    openFile: (path) => opener.openRecentFile(path),
    openFolder: () => opener.chooseFolder(),
    askName: (request) => dialogs.prompt(request),
    confirm: (request) => dialogs.confirm(request),
    onRenamed: (from, to) => {
      state.documents?.applyRenamed(from, to);
    },
    onDeleted: (path) => {
      state.documents?.applyDeleted(path);
    },
    onReveal: (path) => reveal(path),
    onCopyPath: (text) => copy(text),
    onError: showError,
    onNote: showNote,
  });

  const quickOpen = createQuickOpen({
    workspace: () => state.workspace,
    files: (root) => api.files(root),
    open: (path) => opener.openRecentFile(path),
    onError: showError,
  });

  const preview = createPreview({
    readAsset: (path) => api.readAsset(path),
    read: (path) => api.read(path),
    openFile: (path) => void opener.openRecentFile(path),
    onError: showError,
    onNote: showNote,
  });
  main.insertBefore(preview.element, chrome.welcome);

  const peek = createPeek(main);

  const navigation = createNavigator({
    api,
    active() {
      const tab = tabs.active();
      return tab === null ? null : { path: tab.path, text: tab.state.doc.toString() };
    },
    root: () => state.workspace,
    cursor: () => ({ line: state.cursor.line, column: state.cursor.column }),
    positionAt: editorPositionAt,
    open: (location) => void opener.openLocation(location),
    peek: (request) => peek.show(request),
    onError: showError,
    onNote: showNote,
  });
  const onNavigatePointer = (event: MouseEvent) => navigation.handlePointer(event);
  editor.view().contentDOM.addEventListener("mousedown", onNavigatePointer, true);

  const search = createSearchPanel({
    workspace: () => state.workspace,
    search: (options) => api.search(options),
    replace: (options) => api.replace(options),
    openMatch: (match) => opener.openMatch(match),
    confirm: (question) =>
      dialogs.confirm({
        title: question.title,
        message: question.message,
        confirmLabel: question.confirmLabel,
        danger: question.danger,
      }),
    onReplaced: (changed) => {
      void state.documents?.applyExternalWrite(changed);
    },
    onError: showError,
    onNote: showNote,
  });

  const commandPalette = createCommandPalette({
    commands: () => registry.all(),
    run: (id) => registry.run(id),
  });

  sidebar.add({
    id: "explorer",
    label: "Explorer",
    icon: "folder",
    element: explorer.element,
    onShow: () => void explorer.refresh(),
  });
  sidebar.add({
    id: "search",
    label: "Search",
    icon: "search",
    element: search.element,
    onShow: () => search.focus(),
  });
  sidebar.add({
    id: "outline",
    label: "Outline",
    icon: "symbols",
    element: outline.element,
    onShow: () => void outline.refresh(),
  });
  sidebar.settle();
  body.prepend(sidebar.element);

  const scheduleOutlineRefresh = debounce(() => {
    if (sidebar.isOpen() && sidebar.active() === "outline" && tabs.active() !== null) void outline.refresh();
  }, 700);

  const persistNow = (): void => {
    const activeTab = tabs.active();
    if (activeTab !== null) tabs.remember(activeTab.id, editor.capture());
    const { tabs: restorable, activePath } = persistedTabs(tabs.list(), tabs.activeId());
    writeSession(storage, {
      version: 1,
      workspace: state.workspace,
      activePath,
      tabs: state.settings.restoreSession ? restorable : [],
      recentFolders: state.recentFolders,
      recentFiles: state.recentFiles,
    });
  };
  const schedulePersist = debounce(persistNow, 400);

  function showNote(message: string): void {
    state.note = message;
    renderer.status();
  }

  function showError(message: string): void {
    state.error = message;
    renderer.banner();
  }

  function clearError(): void {
    state.error = null;
    renderer.banner();
  }

  const notify: NotifyHost = { showNote, showError };
  const copy = (text: string): Promise<void> => copyText(notify, text);
  const reveal = (path: string): Promise<void> => revealPath({ ...notify, api }, path);

  function updateSettings(next: EditorSettings, message: string): void {
    state.settings = next;
    writeSettings(storage, next);
    editor.configure(next);
    renderer.status();
    schedulePersist();
    if (message.length > 0) showNote(message);
  }

  const renderer = createRenderer({
    chrome,
    platform,
    state,
    tabs,
    tabStrip,
    editor,
    explorer,
    outline,
    preview,
    sidebar,
    statusBar,
    openFolder: (folder) => opener.openFolder(folder),
    openFile: (path) => void opener.openRecentFile(path),
    schedulePersist,
  });

  const opener = createOpener({
    state,
    link: options.link,
    tabs,
    editor,
    explorer,
    sidebar,
    peek,
    render: () => renderer.all(),
    persistNow,
    showNote,
    showError,
  });

  function editorPositionAt(clientX: number, clientY: number): { line: number; column: number } | null {
    const at = editor.view().posAtCoords({ x: clientX, y: clientY });
    if (at === null) return null;
    const line = editor.view().state.doc.lineAt(at);
    return { line: line.number, column: at - line.from + 1 };
  }

  const menus: MenuHost = {
    platform,
    tabs,
    documents: () => state.documents,
    run: (command) => void registry.run(command),
    navigation,
    positionAt: editorPositionAt,
    copyText: copy,
    revealPath: reveal,
  };

  registry = createCommandRegistry({ onError: showError });
  registerCommands({
    registry,
    platform,
    tabs,
    editor,
    api,
    navigation,
    explorer,
    sidebar,
    search,
    quickOpen,
    commandPalette,
    preview,
    settingsSheet,
    settings: () => state.settings,
    updateSettings,
    documents: () => state.documents,
    workspace: () => state.workspace,
    showNote,
    showError,
    openFile: opener.openFile,
    openFolder: opener.chooseFolder,
    copyText: copy,
    revealPath: reveal,
  });

  chrome.buttons.openFolder.addEventListener("click", () => void opener.chooseFolder());
  chrome.buttons.welcomeFolder.addEventListener("click", () => void opener.chooseFolder());
  chrome.buttons.openFile.addEventListener("click", () => void opener.openFile());
  chrome.buttons.welcomeFile.addEventListener("click", () => void opener.openFile());
  chrome.buttons.goToFile.addEventListener("click", () => void registry.run("quickopen.files"));
  chrome.buttons.preview.addEventListener("click", () => void registry.run("preview.toggle"));
  chrome.buttons.saveAll.addEventListener("click", () => void registry.run("file.saveAll"));
  chrome.bannerDismiss.addEventListener("click", clearError);

  const removeKeymap = installAppKeymap(window, sink, platform);

  state.documents = createDocuments({
    api,
    tabs,
    createState: (text, language, nextSettings, view) => editor.createState(text, language, nextSettings, view),
    capture: () => editor.capture(),
    settings: () => state.settings,
    pickFile: (request) => options.link.pickFile(request),
    askUnsaved: (name) => dialogs.askUnsaved(name),
    askConflict: (kind, name) => dialogs.askConflict(kind, name),
    confirm: (question) =>
      dialogs.confirm({
        title: question.title,
        message: question.message,
        confirmLabel: question.confirmLabel,
        cancelLabel: question.cancelLabel,
        danger: question.danger,
      }),
    reconfigureLanguage: (language) => editor.setLanguage(language),
    preferredDirectory: () => {
      const active = tabs.active();
      if (active) return dirName(active.path);
      return state.workspace;
    },
    onChange: () => renderer.all(),
    onError: showError,
    onNote: showNote,
  });

  const cleanupLifecycle = installLifecycle({
    state,
    tabs,
    editor,
    persistNow,
    cancelPersist: () => schedulePersist.cancel(),
    render: () => renderer.all(),
    showError,
  });

  wireLink(options.link, showError);

  if (state.workspace !== null) explorer.setRoot(state.workspace);

  renderer.all();

  void restoreSession(
    {
      state,
      tabs,
      editor,
      persistNow,
      cancelPersist: () => schedulePersist.cancel(),
      render: () => renderer.all(),
      showError,
    },
    persisted,
  );

  return {
    tabs: () => tabs,
    render: () => renderer.all(),
    destroy() {
      removeKeymap();
      cleanupLifecycle();
      settingsSheet.element.remove();
      schedulePersist.cancel();
      scheduleOutlineRefresh.cancel();
      editor.view().contentDOM.removeEventListener("mousedown", onNavigatePointer, true);
      peek.destroy();
      preview.destroy();
      search.destroy();
      quickOpen.destroy();
      commandPalette.destroy();
      outline.destroy();
      explorer.destroy();
      sidebar.destroy();
      editor.destroy();
      chrome.workbench.remove();
    },
  };
}
