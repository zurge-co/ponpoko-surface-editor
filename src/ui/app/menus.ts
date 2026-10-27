import type { Documents } from "../../documents";
import { keyLabel, type Platform } from "../../keymap";
import type { Navigator } from "../../navigation";
import type { Tab, TabModel } from "../../tabs";
import { navigationMenuEntries, showMenu, type MenuEntry } from "../menu";

export interface MenuHost {
  platform: Platform;
  tabs: TabModel;
  documents(): Documents | null;
  run(command: string): void;
  navigation: Navigator;
  positionAt(clientX: number, clientY: number): { line: number; column: number } | null;
  copyText(text: string): Promise<void>;
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
