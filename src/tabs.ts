import type { EditorState, Text } from "@codemirror/state";

import { baseName, isUnder, pathKey } from "./files";
import { languageFor, isLanguageId, type LanguageId } from "./languages";

export type Eol = "lf" | "crlf";

export interface TabView {
  scrollTop: number;
  topLine: number;
  cursorLine: number;
  cursorColumn: number;
}

export interface Tab {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly state: EditorState;
  readonly saved: Text;
  readonly language: LanguageId;
  readonly languageOverridden: boolean;
  readonly eol: Eol;
  readonly modifiedMs: number | null;
  readonly bytes: number;
  readonly view: TabView;
}

export interface OpenTabInput {
  path: string;
  state: EditorState;
  savedText?: string;
  language?: LanguageId;
  languageOverridden?: boolean;
  eol?: Eol;
  modifiedMs?: number | null;
  bytes?: number;
  view?: Partial<TabView>;
  activate?: boolean;
}

export interface ClosedTab {
  path: string;
  savedText: string;
  language: LanguageId;
  languageOverridden: boolean;
  eol: Eol;
  modifiedMs: number | null;
  bytes: number;
}

export interface TabModel {
  list(): readonly Tab[];
  active(): Tab | null;
  activeId(): string | null;
  findPath(path: string): Tab | null;
  open(input: OpenTabInput): { tab: Tab; created: boolean };
  activate(id: string): Tab | null;
  activateIndex(index: number): Tab | null;
  next(): Tab | null;
  previous(): Tab | null;
  close(id: string): Tab | null;
  closeOthers(id: string): void;
  closeAll(): void;
  takeClosed(): ClosedTab | null;
  closedCount(): number;
  update(id: string, state: EditorState): void;
  remember(id: string, view: Partial<TabView>): void;
  markSaved(id: string, info: { bytes: number; modifiedMs: number | null }): void;
  setLanguage(id: string, language: LanguageId, overridden: boolean): void;
  setEol(id: string, eol: Eol): void;
  renamePath(id: string, path: string): void;
  renamePrefix(from: string, to: string): readonly Tab[];
  tabsUnder(path: string): readonly Tab[];
  drop(id: string): Tab | null;
  dirty(tab: Tab): boolean;
  dirtyTabs(): readonly Tab[];
  isDirty(id: string): boolean;
}

const samePath = (a: string, b: string): boolean => pathKey(a) === pathKey(b);

const EMPTY_VIEW: TabView = { scrollTop: 0, topLine: 1, cursorLine: 1, cursorColumn: 1 };

function clampNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface TabModelOptions {
  nextId?: () => string;
  closedLimit?: number;
}

export function createTabModel(options: TabModelOptions = {}): TabModel {
  let counter = 0;
  const nextId = options.nextId ?? (() => `tab-${++counter}`);
  const closedLimit = options.closedLimit ?? 20;
  let tabs: Tab[] = [];
  let activeId: string | null = null;
  const closed: ClosedTab[] = [];

  const active = (): Tab | null => (activeId === null ? null : tabs.find((tab) => tab.id === activeId) ?? null);

  const replace = (id: string, next: (tab: Tab) => Tab): void => {
    tabs = tabs.map((tab) => (tab.id === id ? next(tab) : tab));
  };

  const pushClosed = (tab: Tab): void => {
    closed.push({
      path: tab.path,
      savedText: tab.saved.toString(),
      language: tab.language,
      languageOverridden: tab.languageOverridden,
      eol: tab.eol,
      modifiedMs: tab.modifiedMs,
      bytes: tab.bytes,
    });
    if (closed.length > closedLimit) closed.splice(0, closed.length - closedLimit);
  };

  const model: TabModel = {
    list: () => tabs,
    active,
    activeId: () => activeId,

    findPath(path) {
      return tabs.find((tab) => samePath(tab.path, path)) ?? null;
    },

    open(input) {
      const existing = model.findPath(input.path);
      if (existing) {
        if (input.activate !== false) activeId = existing.id;
        return { tab: existing, created: false };
      }
      const savedText = input.savedText ?? input.state.doc.toString();
      const tab: Tab = Object.freeze({
        id: nextId(),
        path: input.path,
        name: baseName(input.path),
        state: input.state,
        saved: input.state.toText(savedText),
        language: input.language ?? languageFor(input.path),
        languageOverridden: input.languageOverridden === true,
        eol: input.eol ?? "lf",
        modifiedMs: input.modifiedMs ?? null,
        bytes: clampNumber(input.bytes, savedText.length),
        view: {
          scrollTop: clampNumber(input.view?.scrollTop, EMPTY_VIEW.scrollTop),
          topLine: Math.max(1, clampNumber(input.view?.topLine, EMPTY_VIEW.topLine)),
          cursorLine: Math.max(1, clampNumber(input.view?.cursorLine, EMPTY_VIEW.cursorLine)),
          cursorColumn: Math.max(1, clampNumber(input.view?.cursorColumn, EMPTY_VIEW.cursorColumn)),
        },
      });
      tabs = [...tabs, tab];
      if (input.activate !== false) activeId = tab.id;
      return { tab, created: true };
    },

    activate(id) {
      const tab = tabs.find((candidate) => candidate.id === id);
      if (!tab) return null;
      activeId = tab.id;
      return tab;
    },

    activateIndex(index) {
      const tab = tabs[index];
      if (!tab) return null;
      activeId = tab.id;
      return tab;
    },

    next() {
      if (tabs.length === 0) return null;
      const current = tabs.findIndex((tab) => tab.id === activeId);
      const tab = tabs[(current + 1 + tabs.length) % tabs.length];
      activeId = tab.id;
      return tab;
    },

    previous() {
      if (tabs.length === 0) return null;
      const current = tabs.findIndex((tab) => tab.id === activeId);
      const tab = tabs[(current - 1 + tabs.length) % tabs.length];
      activeId = tab.id;
      return tab;
    },

    close(id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return active();
      const tab = tabs[index];
      pushClosed(tab);
      tabs = tabs.filter((candidate) => candidate.id !== id);
      if (activeId === id) {
        const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
        activeId = neighbour ? neighbour.id : null;
      }
      return active();
    },

    closeOthers(id) {
      const kept = tabs.find((tab) => tab.id === id);
      if (!kept) {
        model.closeAll();
        return;
      }
      for (const tab of tabs) {
        if (tab.id !== id) pushClosed(tab);
      }
      tabs = [kept];
      activeId = kept.id;
    },

    closeAll() {
      for (const tab of tabs) pushClosed(tab);
      tabs = [];
      activeId = null;
    },

    takeClosed() {
      return closed.pop() ?? null;
    },

    closedCount: () => closed.length,

    update(id, state) {
      replace(id, (tab) => (tab.state === state ? tab : Object.freeze({ ...tab, state })));
    },

    remember(id, view) {
      replace(id, (tab) =>
        Object.freeze({
          ...tab,
          view: Object.freeze({
            scrollTop: clampNumber(view.scrollTop ?? tab.view.scrollTop, tab.view.scrollTop),
            topLine: Math.max(1, clampNumber(view.topLine ?? tab.view.topLine, tab.view.topLine)),
            cursorLine: Math.max(1, clampNumber(view.cursorLine ?? tab.view.cursorLine, tab.view.cursorLine)),
            cursorColumn: Math.max(
              1,
              clampNumber(view.cursorColumn ?? tab.view.cursorColumn, tab.view.cursorColumn),
            ),
          }),
        }),
      );
    },

    markSaved(id, info) {
      replace(id, (tab) =>
        Object.freeze({
          ...tab,
          saved: tab.state.doc,
          bytes: info.bytes,
          modifiedMs: info.modifiedMs,
        }),
      );
    },

    setLanguage(id, language, overridden) {
      replace(id, (tab) =>
        isLanguageId(language) ? Object.freeze({ ...tab, language, languageOverridden: overridden }) : tab,
      );
    },

    setEol(id, eol) {
      replace(id, (tab) => Object.freeze({ ...tab, eol }));
    },

    renamePath(id, path) {
      replace(id, (tab) =>
        Object.freeze({
          ...tab,
          path,
          name: baseName(path),
          language: tab.languageOverridden ? tab.language : languageFor(path),
        }),
      );
    },

    renamePrefix(from, to) {
      const source = from.replace(/[/\\]+$/, "");
      const target = to.replace(/[/\\]+$/, "");
      const moved: Tab[] = [];
      for (const tab of tabs) {
        if (!isUnder(tab.path, source)) continue;
        const rest = tab.path.slice(source.length);
        const suffix = rest === "" || rest.startsWith("/") || rest.startsWith("\\") ? rest : pathKey(tab.path).slice(pathKey(source).length);
        model.renamePath(tab.id, `${target}${suffix}`);
        const movedTab = tabs.find((candidate) => candidate.id === tab.id);
        if (movedTab) moved.push(movedTab);
      }
      return moved;
    },

    tabsUnder(path) {
      return tabs.filter((tab) => isUnder(tab.path, path));
    },

    drop(id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return active();
      tabs = tabs.filter((candidate) => candidate.id !== id);
      if (activeId === id) {
        const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
        activeId = neighbour ? neighbour.id : null;
      }
      return active();
    },

    dirty(tab) {
      return !tab.state.doc.eq(tab.saved);
    },

    dirtyTabs() {
      return tabs.filter((tab) => model.dirty(tab));
    },

    isDirty(id) {
      const tab = tabs.find((candidate) => candidate.id === id);
      return tab ? model.dirty(tab) : false;
    },
  };

  return model;
}
