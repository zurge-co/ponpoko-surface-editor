import { EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
  rectangularSelection,
  type KeyBinding,
  type ViewUpdate,
} from "@codemirror/view";
import { foldGutter } from "@codemirror/language";

import { isLargeFile } from "./files";
import { languageExtension, type LanguageId } from "./languages";
import type { EditorSettings } from "./session";
import {
  commandKeymap,
  createDocumentState,
  indentCompartment,
  indentation,
  languageCompartment,
  tabSizeCompartment,
  wrapCompartment,
  wrapExtension,
} from "./state";
import type { Tab, TabView } from "./tabs";

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
  selections: number;
}

export interface EditorUpdate {
  state: EditorState;
  docChanged: boolean;
  selectionChanged: boolean;
  cursor: CursorInfo;
}

export interface EditorCallbacks {
  onUpdate(update: EditorUpdate): void;
  onScroll(scroll: { scrollTop: number; topLine: number }): void;
  onContextMenu(event: MouseEvent): void;
}

export interface SurfaceEditor {
  createState(
    text: string,
    language: LanguageId,
    settings: EditorSettings,
    view?: Partial<TabView>,
    options?: { largeFile?: boolean },
  ): EditorState;
  show(tab: Tab, settings: EditorSettings): void;
  capture(): TabView;
  configure(settings: EditorSettings): void;
  setLanguage(language: LanguageId): void;
  focus(): void;
  reveal(line: number): void;
  select(line: number, column: number, length: number): void;
  replaceDocument(text: string, caret: { line: number; column: number }): void;
  view(): EditorView;
  dom(): HTMLElement;
  measure(): void;
  destroy(): void;
}

export function cursorOf(state: EditorState): CursorInfo {
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  return {
    line: line.number,
    column: selection.head - line.from + 1,
    selected: Math.abs(selection.to - selection.from),
    selections: state.selection.ranges.length,
  };
}

export function positionAt(state: EditorState, line: number, column: number): number {
  const target = state.doc.line(Math.min(state.doc.lines, Math.max(1, Math.round(line))));
  const offset = Math.min(target.length, Math.max(0, Math.round(column) - 1));
  return target.from + offset;
}

export interface MountOptions {
  settings: EditorSettings;
  keymap: readonly KeyBinding[];
}

export function mountEditor(
  parent: HTMLElement,
  callbacks: EditorCallbacks,
  options: MountOptions,
): SurfaceEditor {
  let settings = options.settings;
  let shownId: string | null = null;
  let shownLanguage: LanguageId | null = null;
  let shownSettings = "";
  let shownLarge = false;

  const settingsKey = (value: EditorSettings): string =>
    `${value.tabSize}:${value.insertSpaces}:${value.wordWrap}:${value.fontSize}`;

  const extra = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter({ openText: "▾", closedText: "▸" }),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    EditorView.updateListener.of((update: ViewUpdate) => {
      callbacks.onUpdate({
        state: update.state,
        docChanged: update.docChanged,
        selectionChanged: update.selectionSet,
        cursor: cursorOf(update.state),
      });
    }),
    commandKeymap(options.keymap),
  ];

  const view = new EditorView({
    state: createDocumentState("", { language: "text", settings, extra }),
  });
  parent.append(view.dom);

  const topLineOf = (): number => {
    try {
      const scroller = view.scrollDOM.getBoundingClientRect();
      const content = view.contentDOM.getBoundingClientRect();
      const at = view.posAtCoords({ x: content.left + 4, y: scroller.top + 2 });
      if (at !== null) return view.state.doc.lineAt(at).number;
    } catch {
    }
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  };

  const onScroll = () => callbacks.onScroll({ scrollTop: view.scrollDOM.scrollTop, topLine: topLineOf() });
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

  const onContextMenu = (event: Event) => {
    if (!(event instanceof MouseEvent)) return;
    event.preventDefault();
    callbacks.onContextMenu(event);
  };
  view.contentDOM.addEventListener("contextmenu", onContextMenu);

  const applyFontSize = () => {
    view.dom.style.setProperty("--ponpoko-editor-font-size", `${settings.fontSize}px`);
  };
  applyFontSize();

  return {
    createState(text, language, nextSettings, seed, options) {
      const state = createDocumentState(text, {
        language,
        settings: nextSettings,
        extra,
        largeFile: options?.largeFile === true,
      });
      if (!seed || (seed.cursorLine === undefined && seed.cursorColumn === undefined)) return state;
      const anchor = positionAt(state, seed.cursorLine ?? 1, seed.cursorColumn ?? 1);
      return state.update({ selection: { anchor } }).state;
    },

    show(tab, nextSettings) {
      settings = nextSettings;
      const stateChanged = view.state !== tab.state;
      if (stateChanged) view.setState(tab.state);
      const nextKey = settingsKey(settings);
      const tabChanged = shownId !== tab.id;
      const moved = tabChanged || stateChanged;
      const reconfigure = tabChanged || stateChanged || shownLanguage !== tab.language || shownSettings !== nextKey;
      const large = isLargeFile(tab.bytes);
      const effects: import("@codemirror/state").StateEffect<unknown>[] = [];
      if (reconfigure) {
        const { tabSize, indent } = indentation(settings);
        effects.push(
          languageCompartment.reconfigure(large ? [] : languageExtension(tab.language)),
          tabSizeCompartment.reconfigure(tabSize),
          indentCompartment.reconfigure(indent),
          wrapCompartment.reconfigure(wrapExtension(settings)),
        );
      }
      if (moved) {
        const topLine = Math.min(view.state.doc.lines, Math.max(1, tab.view.topLine));
        effects.push(
          EditorView.scrollIntoView(view.state.doc.line(topLine).from, {
            y: "start",
            yMargin: 0,
          }),
        );
      }
      if (effects.length > 0) view.dispatch({ effects });
      applyFontSize();
      shownId = tab.id;
      shownLanguage = tab.language;
      shownSettings = nextKey;
      shownLarge = large;
    },

    capture() {
      const cursor = cursorOf(view.state);
      topLineOf();
      const scrollTop = view.scrollDOM.scrollTop;
      return {
        scrollTop,
        topLine: topLineOf(),
        cursorLine: cursor.line,
        cursorColumn: cursor.column,
      };
    },

    configure(nextSettings) {
      settings = nextSettings;
      shownSettings = settingsKey(settings);
      const { tabSize, indent } = indentation(settings);
      view.dispatch({
        effects: [
          wrapCompartment.reconfigure(wrapExtension(settings)),
          tabSizeCompartment.reconfigure(tabSize),
          indentCompartment.reconfigure(indent),
        ],
      });
      applyFontSize();
    },

    setLanguage(language) {
      view.dispatch({
        effects: languageCompartment.reconfigure(shownLarge ? [] : languageExtension(language)),
      });
    },

    focus() {
      view.focus();
    },

    reveal(line) {
      const target = Math.min(view.state.doc.lines, Math.max(1, Math.round(line)));
      const from = view.state.doc.line(target).from;
      view.dispatch({
        selection: { anchor: from },
        effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 24 }),
      });
      view.focus();
    },

    select(line, column, length) {
      const from = positionAt(view.state, line, column);
      const to = Math.min(view.state.doc.length, from + Math.max(0, Math.round(length)));
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center", yMargin: 24 }),
      });
      view.focus();
    },

    replaceDocument(text, caret) {
      const changes = { from: 0, to: view.state.doc.length, insert: text };
      const next = view.state.update({ changes }).state;
      const anchor = positionAt(next, caret.line, caret.column);
      view.dispatch({
        changes,
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: "nearest" }),
        userEvent: "input.format",
      });
      view.focus();
    },

    view: () => view,
    dom: () => view.dom,

    measure() {
      view.requestMeasure();
    },

    destroy() {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.contentDOM.removeEventListener("contextmenu", onContextMenu);
      view.destroy();
    },
  };
}
