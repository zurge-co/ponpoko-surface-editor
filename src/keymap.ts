import type { KeyBinding } from "@codemirror/view";

export type Platform = "mac" | "other";

export interface KeyBindingSpec {
  key: string;
  command: string;
  label: string;
}

export const APP_KEYBINDINGS: readonly KeyBindingSpec[] = [
  { key: "Mod-s", command: "file.save", label: "Save" },
  { key: "Mod-Shift-s", command: "file.saveAs", label: "Save As…" },
  { key: "Mod-Alt-s", command: "file.saveAll", label: "Save All" },
  { key: "Mod-o", command: "file.open", label: "Open File…" },
  { key: "Mod-Alt-o", command: "workspace.openFolder", label: "Open Folder…" },
  { key: "Mod-p", command: "quickopen.files", label: "Go to File…" },
  { key: "Mod-Shift-p", command: "command.palette", label: "Command Palette…" },
  { key: "Mod-b", command: "view.toggleSidebar", label: "Toggle Sidebar" },
  { key: "Mod-Shift-e", command: "view.explorer", label: "Explorer" },
  { key: "Mod-Shift-o", command: "view.outline", label: "Outline" },
  { key: "Mod-w", command: "file.close", label: "Close Tab" },
  { key: "Mod-Shift-w", command: "file.closeAll", label: "Close All Tabs" },
  { key: "Mod-Shift-t", command: "file.reopenClosed", label: "Reopen Closed Tab" },
  { key: "Mod-Shift-f", command: "search.inFiles", label: "Search in Files" },
  { key: "Mod-Shift-v", command: "preview.toggle", label: "Toggle Preview" },
  { key: "Ctrl-Tab", command: "tab.next", label: "Next Tab" },
  { key: "Ctrl-Shift-Tab", command: "tab.previous", label: "Previous Tab" },
  { key: "Alt-z", command: "view.toggleWrap", label: "Toggle Word Wrap" },
  { key: "Mod-Equal", command: "view.zoomIn", label: "Zoom In" },
  { key: "Mod-Minus", command: "view.zoomOut", label: "Zoom Out" },
  { key: "Mod-Digit0", command: "view.zoomReset", label: "Reset Zoom" },
  { key: "Mod-Comma", command: "view.settings", label: "Settings" },
  ...Array.from({ length: 9 }, (_, index) => ({
    key: `Mod-Digit${index + 1}`,
    command: `tab.activate${index + 1}`,
    label: `Go to Tab ${index + 1}`,
  })),
];

export const EDITOR_KEYBINDINGS: readonly KeyBindingSpec[] = [
  { key: "Mod-f", command: "editor.find", label: "Find" },
  { key: "Mod-h", command: "editor.replace", label: "Replace" },
  { key: "Mod-g", command: "editor.gotoLine", label: "Go to Line…" },
  { key: "Mod-Slash", command: "editor.toggleComment", label: "Toggle Line Comment" },
  { key: "Mod-BracketLeft", command: "editor.indentLess", label: "Outdent" },
  { key: "Mod-BracketRight", command: "editor.indentMore", label: "Indent" },
  { key: "Alt-ArrowUp", command: "editor.moveLineUp", label: "Move Line Up" },
  { key: "Alt-ArrowDown", command: "editor.moveLineDown", label: "Move Line Down" },
  { key: "Shift-Alt-ArrowUp", command: "editor.copyLineUp", label: "Copy Line Up" },
  { key: "Shift-Alt-ArrowDown", command: "editor.copyLineDown", label: "Copy Line Down" },
  { key: "Mod-Shift-k", command: "editor.deleteLine", label: "Delete Line" },
  { key: "Mod-d", command: "editor.nextOccurrence", label: "Add Next Occurrence" },
  { key: "F12", command: "editor.definition", label: "Go to Definition" },
  { key: "Shift-F12", command: "editor.references", label: "Find All References" },
  { key: "Shift-Alt-f", command: "editor.formatDocument", label: "Format Document" },
];

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const platform = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(platform) ? "mac" : "other";
}

interface ParsedKey {
  code: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

const NAMED_CODES: Record<string, string> = {
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Tab: "Tab",
  Enter: "Enter",
  Escape: "Escape",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

const PUNCTUATION_CODES: Record<string, string> = {
  Minus: "Minus",
  Equal: "Equal",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Slash: "Slash",
  Backslash: "Backslash",
  Comma: "Comma",
  Period: "Period",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Backquote: "Backquote",
};

function codeFor(name: string): string {
  if (name.length === 1 && /[a-z]/i.test(name)) return `Key${name.toUpperCase()}`;
  if (name.startsWith("Digit") && name.length === 6) return name;
  const punctuation = PUNCTUATION_CODES[name];
  if (punctuation) return punctuation;
  const named = NAMED_CODES[name];
  if (named) return named;
  return name;
}

export function parseKey(key: string): ParsedKey {
  const parts = key.split("-");
  const name = parts.pop() ?? "";
  return {
    code: codeFor(name),
    mod: parts.includes("Mod"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    ctrl: parts.includes("Ctrl"),
  };
}

export function matchesKey(event: KeyboardEvent, key: string, platform: Platform): boolean {
  const parsed = parseKey(key);
  const isMac = platform === "mac";
  const wantMeta = parsed.mod && isMac;
  const wantCtrl = isMac ? parsed.ctrl : parsed.mod || parsed.ctrl;
  if (event.metaKey !== wantMeta) return false;
  if (event.ctrlKey !== wantCtrl) return false;
  if (event.shiftKey !== parsed.shift) return false;
  if (event.altKey !== parsed.alt) return false;

  if (event.code === parsed.code) return true;
  const aliases: Record<string, string> = {
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Slash: "/",
    Backslash: "\\",
    Comma: ",",
    Period: ".",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Space: " ",
  };
  if (parsed.code.startsWith("Key")) return event.key.toUpperCase() === parsed.code.slice(3);
  if (parsed.code.startsWith("Digit")) return event.key === parsed.code.slice(5);
  return (aliases[parsed.code] ?? parsed.code) === event.key;
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Ctrl: "⌃",
};

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "−",
  Equal: "+",
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
};

export function keyLabel(key: string, platform: Platform = detectPlatform()): string {
  const parts = key.split("-");
  const name = parts.pop() ?? "";
  const modifierNames = parts.map((part) => (platform === "mac" ? MAC_SYMBOLS[part] ?? part : part));
  const keyName = KEY_NAMES[name] ?? (name.length === 1 ? name.toUpperCase() : name);
  return platform === "mac" ? `${modifierNames.join("")}${keyName}` : [...modifierNames, keyName].join("+");
}

export interface KeymapHost {
  run(command: string): void;
}

export function editorKeymap(host: KeymapHost): KeyBinding[] {
  return EDITOR_KEYBINDINGS.map((binding) => ({
    key: binding.key,
    run: () => {
      host.run(binding.command);
      return true;
    },
  }));
}

export function installAppKeymap(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  host: KeymapHost,
  platform: Platform = detectPlatform(),
): () => void {
  const listener = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.defaultPrevented) return;
    if (event.isComposing) return;
    for (const binding of APP_KEYBINDINGS) {
      if (!matchesKey(event, binding.key, platform)) continue;
      host.run(binding.command);
      event.preventDefault();
      return;
    }
  };
  target.addEventListener("keydown", listener, true);
  return () => target.removeEventListener("keydown", listener, true);
}
