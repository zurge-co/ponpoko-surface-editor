import { redoDepth, undoDepth } from "@codemirror/commands";

import type { Documents } from "../../documents";
import type { SurfaceEditor } from "../../editor";
import { keyLabel, type Platform } from "../../keymap";
import type { Navigator } from "../../navigation";
import type { Tab, TabModel } from "../../tabs";
import { navigationMenuEntries, showMenu, type MenuEntry } from "../menu";

export interface MenuHost {
  platform: Platform;
  tabs: TabModel;
  editor: SurfaceEditor;
  documents(): Documents | null;
  run(command: string): void;
  navigation: Navigator;
  positionAt(clientX: number, clientY: number): { line: number; column: number } | null;
  copyText(text: string): Promise<boolean>;
  revealPath(path: string): Promise<void>;
}

function tabMenuEntries(tab: Tab, host: MenuHost): MenuEntry[] {
  const isDirty = host.tabs.dirty(tab);
  return [
    {
      type: "item",
      label: "Save",
      keybinding: keyLabel("Mod-s", host.platform),
      run: () => void host.documents()?.save(tab.id),
      disabled: !isDirty,
    },
    {
      type: "item",
      label: "Save As…",
      keybinding: keyLabel("Mod-Shift-s", host.platform),
      run: () => void host.documents()?.saveAs(tab.id),
      disabled: tab.asset,
    },
    {
      type: "item",
      label: "Revert File",
      run: () => void host.documents()?.revert(tab.id),
      disabled: !isDirty || tab.path.length === 0,
    },
    { type: "separator" },
    {
      type: "item",
      label: "Close",
      keybinding: keyLabel("Mod-w", host.platform),
      run: () => void host.documents()?.close(tab.id),
    },
    {
      type: "item",
      label: "Close Others",
      run: () => void host.documents()?.closeOthers(tab.id),
    },
    {
      type: "item",
      label: "Close All",
      keybinding: keyLabel("Mod-Shift-w", host.platform),
      run: () => void host.documents()?.closeAll(),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Copy Path",
      run: () => void host.copyText(tab.path),
    },
    {
      type: "item",
      label: "Reveal in File Manager",
      run: () => void host.revealPath(tab.path),
    },
  ];
}

export function showTabMenu(tab: Tab, at: { x: number; y: number }, host: MenuHost): void {
  host.documents()?.activate(tab.id);
  showMenu({ x: at.x, y: at.y, label: `Actions for ${tab.name}`, entries: tabMenuEntries(tab, host) });
}

export function showEditorMenu(at: { x: number; y: number }, host: MenuHost): void {
  const active = host.tabs.active();
  if (!active) return;
  const position = host.positionAt(at.x, at.y) ?? undefined;
  const entries: MenuEntry[] = [
    {
      type: "item",
      label: "Save",
      keybinding: keyLabel("Mod-s", host.platform),
      run: () => void host.documents()?.save(active.id),
    },
    {
      type: "item",
      label: "Save As…",
      keybinding: keyLabel("Mod-Shift-s", host.platform),
      run: () => void host.documents()?.saveAs(active.id),
    },
    {
      type: "item",
      label: "Revert File",
      run: () => void host.documents()?.revert(active.id),
      disabled: active.path.length === 0 || !host.tabs.dirty(active),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Undo",
      keybinding: keyLabel("Mod-z", host.platform),
      run: () => void host.run("editor.undo"),
      disabled: undoDepth(host.editor.view().state) === 0,
    },
    {
      type: "item",
      label: "Redo",
      keybinding: keyLabel(host.platform === "mac" ? "Mod-Shift-z" : "Ctrl-y", host.platform),
      run: () => void host.run("editor.redo"),
      disabled: redoDepth(host.editor.view().state) === 0,
    },
    { type: "separator" },
    {
      type: "item",
      label: "Cut",
      keybinding: keyLabel("Mod-x", host.platform),
      run: () => void host.run("editor.cut"),
    },
    {
      type: "item",
      label: "Copy",
      keybinding: keyLabel("Mod-c", host.platform),
      run: () => void host.run("editor.copy"),
    },
    {
      type: "item",
      label: "Paste",
      keybinding: keyLabel("Mod-v", host.platform),
      run: () => void host.run("editor.paste"),
    },
    {
      type: "item",
      label: "Select All",
      keybinding: keyLabel("Mod-a", host.platform),
      run: () => void host.run("editor.selectAll"),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Toggle Line Comment",
      keybinding: keyLabel("Mod-Slash", host.platform),
      run: () => void host.run("editor.toggleComment"),
    },
    {
      type: "item",
      label: "Go to Line…",
      keybinding: keyLabel("Mod-g", host.platform),
      run: () => void host.run("editor.gotoLine"),
    },
    {
      type: "item",
      label: "Find in File",
      keybinding: keyLabel("Mod-f", host.platform),
      run: () => void host.run("editor.find"),
    },
    {
      type: "item",
      label: "Search in Files",
      keybinding: keyLabel("Mod-Shift-f", host.platform),
      run: () => void host.run("search.inFiles"),
    },
    { type: "separator" },
    ...navigationMenuEntries({
      definition: () => void host.navigation.goToDefinition(position),
      references: () => void host.navigation.findReferences(position),
      symbols: () => void host.navigation.goToSymbol(),
      definitionKey: keyLabel("F12", host.platform),
      referencesKey: keyLabel("Shift-F12", host.platform),
    }),
    { type: "separator" },
    {
      type: "item",
      label: "Format Document",
      keybinding: keyLabel("Shift-Alt-f", host.platform),
      run: () => void host.run("editor.formatDocument"),
    },
    {
      type: "item",
      label: "Toggle Preview",
      keybinding: keyLabel("Mod-Shift-v", host.platform),
      run: () => void host.run("preview.toggle"),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Close Tab",
      keybinding: keyLabel("Mod-w", host.platform),
      run: () => void host.documents()?.close(active.id),
    },
  ];
  showMenu({ x: at.x, y: at.y, label: `Actions for ${active.name}`, entries });
}
