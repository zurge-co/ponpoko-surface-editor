import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";

import { languageExtension, type LanguageId } from "./languages";
import type { EditorSettings } from "./session";
import { ponpokoTheme } from "./theme";

export const languageCompartment = new Compartment();
export const tabSizeCompartment = new Compartment();
export const indentCompartment = new Compartment();
export const wrapCompartment = new Compartment();

export function indentation(settings: EditorSettings): { tabSize: Extension; indent: Extension } {
  return {
    tabSize: EditorState.tabSize.of(settings.tabSize),
    indent: indentUnit.of(settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t"),
  };
}

export function wrapExtension(settings: EditorSettings): Extension {
  return settings.wordWrap ? EditorView.lineWrapping : [];
}

export interface DocumentStateOptions {
  language: LanguageId;
  settings: EditorSettings;
  extra?: Extension;
  largeFile?: boolean;
}

function baseExtensions(options: DocumentStateOptions): Extension[] {
  const { tabSize, indent } = indentation(options.settings);
  const large = options.largeFile === true;
  return [
    ponpokoTheme,
    ...(large
      ? []
      : [
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          highlightSelectionMatches(),
          bracketMatching(),
        ]),
    history(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    closeBrackets(),
    languageCompartment.of(large ? [] : languageExtension(options.language)),
    tabSizeCompartment.of(tabSize),
    indentCompartment.of(indent),
    wrapCompartment.of(wrapExtension(options.settings)),
    EditorView.contentAttributes.of({
      "aria-label": "Code editor",
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    keymap.of([
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
    options.extra ?? [],
  ];
}

export function createDocumentState(text: string, options: DocumentStateOptions): EditorState {
  return EditorState.create({ doc: text, extensions: baseExtensions(options) });
}

export function commandKeymap(bindings: readonly KeyBinding[]): Extension {
  return keymap.of([...bindings]);
}
