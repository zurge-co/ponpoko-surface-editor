import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  toggleComment,
} from "@codemirror/commands";
import { gotoLine, openSearchPanel, selectNextOccurrence } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

import type { EditorApi } from "../../api";
import type { Documents } from "../../documents";
import type { SurfaceEditor } from "../../editor";
import { FormatError, formatDocument, nearestPosition } from "../../format";
import {
  APP_KEYBINDINGS,
  EDITOR_KEYBINDINGS,
  keyLabel,
  type Platform,
} from "../../keymap";
import { languageLabel } from "../../languages";
import type { Navigator } from "../../navigation";
import { DEFAULT_SETTINGS, type EditorSettings } from "../../session";
import type { TabModel } from "../../tabs";
import type { CommandRegistry } from "../commands";
import type { Explorer } from "../explorer";
import type { Palette } from "../palette";
import { canPreview, noPreviewSentence, type Preview } from "../preview";
import type { QuickOpen } from "../quickopen";
import type { SearchPanel } from "../search";
import type { SettingsSheet } from "../settings";
import type { Sidebar } from "../sidebar";

export interface CommandHost {
  registry: CommandRegistry;
  platform: Platform;
  tabs: TabModel;
  editor: SurfaceEditor;
  api: EditorApi;
  navigation: Navigator;
  explorer: Explorer;
  sidebar: Sidebar;
  search: SearchPanel;
  quickOpen: QuickOpen;
  commandPalette: Palette;
  preview: Preview;
  settingsSheet: SettingsSheet;
  settings(): EditorSettings;
  updateSettings(next: EditorSettings, note: string): void;
  documents(): Documents | null;
  workspace(): string | null;
  showNote(message: string): void;
  showError(message: string): void;
  openFile(): Promise<void>;
  openFolder(): Promise<void>;
  copyText(text: string): Promise<void>;
  revealPath(path: string): Promise<void>;
}

export function registerCommands(host: CommandHost): void {
  const { registry, tabs, editor, documents, settingsSheet } = host;

  const commandBinding = (id: string): string | undefined => {
    const spec = [...APP_KEYBINDINGS, ...EDITOR_KEYBINDINGS].find((binding) => binding.command === id);
    return spec === undefined ? undefined : keyLabel(spec.key, host.platform);
  };

  const register = (id: string, title: string, detail: string, run: () => void | Promise<void>): void => {
    const keybinding = commandBinding(id);
    registry.register({ id, title, detail, ...(keybinding === undefined ? {} : { keybinding }), run });
  };

  const setFontSize = (next: number): void => {
    const fontSize = Math.min(32, Math.max(10, next));
    host.updateSettings({ ...host.settings(), fontSize }, `text size ${fontSize}px`);
  };

  const toggleWrap = (): void => {
    const wordWrap = !host.settings().wordWrap;
    host.updateSettings({ ...host.settings(), wordWrap }, `word wrap ${wordWrap ? "on" : "off"}`);
  };

  register("file.save", "Save", "Write the active file to disk", async () => {
    if (tabs.active() === null) return host.showNote("no file is open");
    await documents()?.saveActive();
  });
  register("file.saveAs", "Save As…", "Write the active buffer to another path", async () => {
    if (tabs.active() === null) return host.showNote("no file is open");
    await documents()?.saveAsActive();
  });
  register("file.saveAll", "Save All", "Write every changed file to disk", async () => {
    const saved = (await documents()?.saveAll()) ?? 0;
    if (saved > 0) host.showNote(`saved ${saved} ${saved === 1 ? "file" : "files"}`);
  });
  register("file.open", "Open File…", "Choose a file through the OS dialog", host.openFile);
  register("workspace.openFolder", "Open Folder…", "Choose a folder to work in", host.openFolder);
  register("file.close", "Close Tab", "Close the active tab", async () => {
    if (tabs.active() === null) return host.showNote("no tab is open");
    const closed = await documents()?.closeActive();
    if (closed) editor.focus();
  });
  register("file.closeAll", "Close All Tabs", "Close every open tab", async () => {
    const closed = await documents()?.closeAll();
    if (closed) editor.focus();
  });
  register("file.reopenClosed", "Reopen Closed Tab", "Bring back the last closed tab", () => {
    documents()?.reopenClosed();
    editor.focus();
  });
  register("file.copyPath", "Copy Path", "Copy the active file's path", () => {
    const active = tabs.active();
    if (active) return host.copyText(active.path);
    return undefined;
  });
  register("file.reveal", "Reveal in File Manager", "Show the active file in Finder or Explorer", () => {
    const active = tabs.active();
    if (active) return host.revealPath(active.path);
    return undefined;
  });
  register("file.revealInExplorer", "Reveal in Explorer", "Show the active file in the folder tree", async () => {
    const active = tabs.active();
    if (active === null) return host.showNote("no file is open");
    host.sidebar.show("explorer");
    await host.explorer.revealActive();
  });

  register("quickopen.files", "Go to File…", "Open a file in this folder by typing its name", () =>
    host.quickOpen.open(),
  );
  register("command.palette", "Command Palette…", "Every command of this editor, in one list", () =>
    host.commandPalette.open(),
  );

  register("view.toggleSidebar", "Toggle Sidebar", "Show or hide the sidebar", () => host.sidebar.toggle());
  register("view.explorer", "Show Explorer", "Show the folder tree", () => {
    host.sidebar.show("explorer");
    host.explorer.focus();
  });
  register("view.outline", "Show Outline", "Show the symbols of the active file", () => host.sidebar.show("outline"));
  register("explorer.refresh", "Refresh Explorer", "Read the folder tree again", () => host.explorer.refresh());
  register("explorer.newFile", "New File…", "Create a file in the folder tree", () => host.explorer.create("file"));
  register("explorer.newFolder", "New Folder…", "Create a folder in the folder tree", () =>
    host.explorer.create("directory"),
  );
  register("explorer.rename", "Rename…", "Rename the selected file or folder", () => host.explorer.renameSelected());
  register("explorer.delete", "Delete…", "Delete the selected file or folder", () => host.explorer.deleteSelected());
  register("explorer.collapseAll", "Collapse Folders", "Close every expanded folder", () =>
    host.explorer.collapseAll(),
  );
  register("explorer.paste", "Paste Files", "Paste files or folders copied outside this editor", () =>
    host.explorer.pasteFromClipboard()
  );

  register("tab.next", "Next Tab", "Go to the next open tab", () => documents()?.next());
  register("tab.previous", "Previous Tab", "Go to the previous open tab", () => documents()?.previous());
  for (let index = 1; index <= 9; index += 1) {
    register(`tab.activate${index}`, `Go to Tab ${index}`, `Activate the ${index}th tab`, () =>
      documents()?.activateIndex(index - 1),
    );
  }

  register("view.toggleWrap", "Toggle Word Wrap", "Wrap long lines instead of scrolling", toggleWrap);
  register("view.zoomIn", "Zoom In", "Make the text one pixel larger", () => setFontSize(host.settings().fontSize + 1));
  register("view.zoomOut", "Zoom Out", "Make the text one pixel smaller", () => setFontSize(host.settings().fontSize - 1));
  register("view.zoomReset", "Reset Zoom", "Return the text to its default size", () =>
    setFontSize(DEFAULT_SETTINGS.fontSize),
  );
  register("view.settings", "Settings", "Text size, indentation, wrap, session restore", () => {
    if (settingsSheet.isOpen()) settingsSheet.close();
    else settingsSheet.open(host.settings());
  });

  const command = (run: (view: EditorView) => boolean) => () => {
    run(editor.view());
  };

  register("editor.find", "Find in File", "Search the active document", command(openSearchPanel));
  register("editor.replace", "Replace in File", "Search and replace in the active document", () => {
    const view = editor.view();
    openSearchPanel(view);
    requestAnimationFrame(() => {
      view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus();
    });
  });
  register("editor.gotoLine", "Go to Line…", "Jump to a line number", command(gotoLine));
  register("editor.toggleComment", "Toggle Line Comment", "Comment or uncomment the selected lines", () => {
    const active = tabs.active();
    if (!toggleComment(editor.view()) && active) {
      host.showNote(`${languageLabel(active.language)} has no line comment syntax in this editor`);
    }
  });
  register("editor.indentMore", "Indent", "Indent the selected lines", command(indentMore));
  register("editor.indentLess", "Outdent", "Outdent the selected lines", command(indentLess));
  register("editor.moveLineUp", "Move Line Up", "Move the selected lines up", command(moveLineUp));
  register("editor.moveLineDown", "Move Line Down", "Move the selected lines down", command(moveLineDown));
  register("editor.copyLineUp", "Copy Line Up", "Duplicate the selected lines above", command(copyLineUp));
  register("editor.copyLineDown", "Copy Line Down", "Duplicate the selected lines below", command(copyLineDown));
  register("editor.deleteLine", "Delete Line", "Delete the selected lines", command(deleteLine));
  register("editor.nextOccurrence", "Add Next Occurrence", "Add a cursor at the next match", command(selectNextOccurrence));
  register("editor.definition", "Go to Definition", "Jump to where the symbol under the cursor is declared", () =>
    host.navigation.goToDefinition(),
  );
  register("editor.references", "Find All References", "Find every code reference to the symbol under the cursor", () =>
    host.navigation.findReferences(),
  );
  register("editor.symbols", "Go to Symbol in File…", "Jump to a declaration in the active file", () =>
    host.navigation.goToSymbol(),
  );

  register("editor.formatDocument", "Format Document", "Format the active buffer with Prettier, rustfmt or taplo", () => {
    const active = tabs.active();
    if (active === null) return host.showNote("no file is open");
    const before = active.state.doc.toString();
    const caret = editor.capture();
    const work = async (): Promise<void> => {
      try {
        const outcome = await formatDocument(
          {
            path: active.path,
            text: before,
            language: active.language,
            eol: active.eol,
            settings: host.settings(),
            workspace: host.workspace(),
          },
          host.api,
        );
        const current = tabs.active();
        if (current === null || current.id !== active.id) {
          host.showNote(`${active.name} was formatted, but another file came to the front; nothing was changed`);
          return;
        }
        if (current.state.doc.toString() !== before) {
          host.showNote(`${active.name} changed while it was being formatted; nothing was changed`);
          return;
        }
        if (outcome.changed) {
          editor.replaceDocument(
            outcome.content,
            nearestPosition(before, { line: caret.cursorLine, column: caret.cursorColumn }, outcome.content),
          );
        }
        const source = outcome.configSource === null ? "" : ` · ${outcome.configSource}`;
        const state = outcome.changed ? `formatted ${active.name}` : `${active.name} was already formatted`;
        host.showNote(`${outcome.engineLabel}${source}: ${state}`);
        if (outcome.warnings.length > 0) {
          host.showError(`${outcome.engineLabel} formatted ${active.name}, and said: ${outcome.warnings.join(" ")}`);
        }
        if (outcome.notes.length > 0) host.showNote(`${outcome.engineLabel}: ${outcome.notes.join(" ")}`);
      } catch (error) {
        host.showError(
          error instanceof FormatError
            ? error.message
            : `Could not format ${active.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    return work();
  });

  register("preview.toggle", "Toggle Preview", "Preview Markdown, HTML or an image beside the editor", () => {
    const active = tabs.active();
    if (active === null) return host.showNote("no file is open");
    if (!canPreview(active.path)) return host.showNote(noPreviewSentence(active.path));
    host.preview.update({ path: active.path, text: active.state.doc.toString(), dirty: tabs.dirty(active) });
    host.preview.toggle();
  });

  register("search.inFiles", "Search in Files…", "Search every file in the open folder, and replace", () => {
    host.sidebar.show("search");
    host.search.focus();
  });
}
