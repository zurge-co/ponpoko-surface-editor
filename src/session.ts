import { isLanguageId, type LanguageId } from "./languages";
import type { Eol, Tab } from "./tabs";

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  restoreSession: boolean;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  restoreSession: true,
};

export const SETTINGS_STORAGE_KEY = "ponpoko.editor.settings.v1";
export const SESSION_STORAGE_KEY = "ponpoko.editor.session.v1";
export const SIDEBAR_STORAGE_KEY = "ponpoko.editor.sidebar.v1";

export interface SidebarState {
  open: boolean;
  active: string | null;
  width: number;
}

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 640;

export const DEFAULT_SIDEBAR: SidebarState = { open: true, active: "explorer", width: 250 };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export interface PersistedTab {
  path: string;
  language: LanguageId | null;
  eol: Eol;
  topLine: number;
  cursorLine: number;
  cursorColumn: number;
}

export interface PersistedSession {
  version: 1;
  workspace: string | null;
  activePath: string | null;
  tabs: PersistedTab[];
  recentFolders: string[];
  recentFiles: string[];
}

export function emptySession(): PersistedSession {
  return {
    version: 1,
    workspace: null,
    activePath: null,
    tabs: [],
    recentFolders: [],
    recentFiles: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = trimmedString(item);
    if (text === null || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

export const RECENT_LIMIT = 12;

export function rememberRecent(recent: readonly string[], value: string, limit = RECENT_LIMIT): string[] {
  const text = value.trim();
  if (text.length === 0) return [...recent].slice(0, limit);
  const without = recent.filter((entry) => entry !== text);
  return [text, ...without].slice(0, limit);
}

export function normalizeSettings(raw: unknown): EditorSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  return {
    fontSize: finiteNumber(raw.fontSize, DEFAULT_SETTINGS.fontSize, 10, 32),
    tabSize: Math.round(finiteNumber(raw.tabSize, DEFAULT_SETTINGS.tabSize, 1, 16)),
    insertSpaces: typeof raw.insertSpaces === "boolean" ? raw.insertSpaces : DEFAULT_SETTINGS.insertSpaces,
    wordWrap: typeof raw.wordWrap === "boolean" ? raw.wordWrap : DEFAULT_SETTINGS.wordWrap,
    restoreSession:
      typeof raw.restoreSession === "boolean" ? raw.restoreSession : DEFAULT_SETTINGS.restoreSession,
  };
}

export function normalizeSession(raw: unknown): PersistedSession {
  if (!isRecord(raw)) return emptySession();
  const tabs: PersistedTab[] = [];
  if (Array.isArray(raw.tabs)) {
    for (const entry of raw.tabs) {
      if (!isRecord(entry)) continue;
      const path = trimmedString(entry.path);
      if (path === null) continue;
      if (tabs.some((tab) => tab.path === path)) continue;
      const language = typeof entry.language === "string" && isLanguageId(entry.language) ? entry.language : null;
      const eol: Eol = entry.eol === "crlf" ? "crlf" : "lf";
      tabs.push({
        path,
        language,
        eol,
        topLine: Math.round(finiteNumber(entry.topLine, 1, 1, 50_000_000)),
        cursorLine: Math.round(finiteNumber(entry.cursorLine, 1, 1, 50_000_000)),
        cursorColumn: Math.round(finiteNumber(entry.cursorColumn, 1, 1, 5_000_000)),
      });
      if (tabs.length >= 200) break;
    }
  }
  const activePath = trimmedString(raw.activePath);
  return {
    version: 1,
    workspace: trimmedString(raw.workspace),
    activePath: activePath !== null && tabs.some((tab) => tab.path === activePath) ? activePath : null,
    tabs,
    recentFolders: stringList(raw.recentFolders, RECENT_LIMIT),
    recentFiles: stringList(raw.recentFiles, RECENT_LIMIT),
  };
}

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const text = storage.getItem(key);
    if (text === null) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function keySuffix(key: string): string {
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(dot);
}

function keysEndingWith(storage: StorageLike, suffix: string): string[] {
  const total = typeof storage.length === "number" ? storage.length : 0;
  const found: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const name = storage.key?.(index) ?? null;
    if (name === null || name.length <= suffix.length) continue;
    if (name.slice(name.length - suffix.length) !== suffix) continue;
    found.push(name);
  }
  return found;
}

function readCarried(storage: StorageLike, key: string): unknown {
  const current = readJson(storage, key);
  if (current !== null) return current;
  for (const retired of keysEndingWith(storage, keySuffix(key))) {
    const carried = readJson(storage, retired);
    if (carried === null) continue;
    try {
      storage.setItem(key, JSON.stringify(carried));
    } catch {
    }
    return carried;
  }
  return null;
}

export function readSettings(storage: StorageLike | null): EditorSettings {
  if (storage === null) return { ...DEFAULT_SETTINGS };
  return normalizeSettings(
    readCarried(storage, SETTINGS_STORAGE_KEY),
  );
}

export function writeSettings(storage: StorageLike | null, settings: EditorSettings): void {
  if (storage === null) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}

export function readSession(storage: StorageLike | null): PersistedSession {
  if (storage === null) return emptySession();
  return normalizeSession(readCarried(storage, SESSION_STORAGE_KEY));
}

export function normalizeSidebarState(raw: unknown): SidebarState {
  if (!isRecord(raw)) return { ...DEFAULT_SIDEBAR };
  const active = trimmedString(raw.active);
  return {
    open: typeof raw.open === "boolean" ? raw.open : DEFAULT_SIDEBAR.open,
    active,
    width: Math.round(
      finiteNumber(raw.width, DEFAULT_SIDEBAR.width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
    ),
  };
}

export function readSidebar(storage: StorageLike | null): SidebarState {
  if (storage === null) return { ...DEFAULT_SIDEBAR };
  return normalizeSidebarState(
    readCarried(storage, SIDEBAR_STORAGE_KEY),
  );
}

export function writeSidebar(storage: StorageLike | null, state: SidebarState): void {
  if (storage === null) return;
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

export function writeSession(storage: StorageLike | null, session: PersistedSession): void {
  if (storage === null) return;
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
  }
}

export function persistedTabs(tabs: readonly Tab[], activeId: string | null): {
  tabs: PersistedTab[];
  activePath: string | null;
} {
  return {
    tabs: tabs.map((tab) => ({
      path: tab.path,
      language: tab.languageOverridden ? tab.language : null,
      eol: tab.eol,
      topLine: Math.max(1, Math.round(tab.view.topLine)),
      cursorLine: Math.max(1, Math.round(tab.view.cursorLine)),
      cursorColumn: Math.max(1, Math.round(tab.view.cursorColumn)),
    })),
    activePath: tabs.find((tab) => tab.id === activeId)?.path ?? null,
  };
}

export function debounce<Args extends unknown[]>(
  action: (...args: Args) => void,
  waitMs: number,
): { (...args: Args): void; flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;

  const run = () => {
    timer = null;
    const args = pending;
    pending = null;
    if (args !== null) action(...args);
  };

  const debounced = (...args: Args) => {
    pending = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  };
  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return debounced;
}

export function browserStorage(): StorageLike | null {
  try {
    const probe = "__ponpoko_editor_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
