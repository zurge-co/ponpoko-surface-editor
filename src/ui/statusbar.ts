import type { CursorInfo } from "../editor";
import { formatBytes } from "../files";
import {
  languageChoices,
  languageLabel,
  type LanguageId,
} from "../languages";
import type { EditorSettings } from "../session";
import type { Eol, Tab } from "../tabs";

export interface StatusModel {
  tab: Tab | null;
  cursor: CursorInfo;
  lineCount: number;
  dirty: boolean;
  settings: EditorSettings;
  note: string;
}

export interface StatusBarHandlers {
  setLanguage(language: LanguageId): void;
  setEol(eol: Eol): void;
  openSettings(): void;
}

export interface StatusBar {
  readonly element: HTMLElement;
  render(model: StatusModel): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createStatusBar(handlers: StatusBarHandlers): StatusBar {
  const bar = element("div", "statusbar");
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-label", "Editor status");

  const language = element("select", "status-item status-select");
  language.setAttribute("aria-label", "Language mode");
  for (const choice of languageChoices()) {
    const option = document.createElement("option");
    option.value = choice.id;
    option.textContent = choice.label;
    language.append(option);
  }
  language.addEventListener("change", () => handlers.setLanguage(language.value as LanguageId));

  const indentation = element("button", "status-item status-button");
  indentation.type = "button";
  indentation.title = "Indentation settings";
  indentation.addEventListener("click", () => handlers.openSettings());

  const eol = element("select", "status-item status-select status-eol");
  eol.setAttribute("aria-label", "Line endings");
  for (const value of ["lf", "crlf"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "lf" ? "LF" : "CRLF";
    eol.append(option);
  }
  eol.addEventListener("change", () => handlers.setEol(eol.value === "crlf" ? "crlf" : "lf"));

  const encoding = element("span", "status-item");
  encoding.textContent = "UTF-8";
  encoding.title = "Files are read and written as UTF-8 text";

  const left = element("div", "status-group");
  left.append(language, indentation, eol, encoding);

  const selection = element("span", "status-item status-selection");
  const cursor = element("span", "status-item status-cursor");
  const size = element("span", "status-item status-size");
  const note = element("span", "status-item status-note");
  note.setAttribute("aria-live", "polite");

  const right = element("div", "status-group status-group-right");
  right.append(selection, cursor, size, note);

  bar.append(left, element("div", "status-spacer"), right);

  return {
    element: bar,
    render(model) {
      const { tab } = model;
      const hasTab = tab !== null;
      language.disabled = !hasTab;
      indentation.disabled = !hasTab;
      eol.disabled = !hasTab;

      if (!hasTab) {
        language.value = "text";
        indentation.textContent = model.settings.insertSpaces
          ? `Spaces: ${model.settings.tabSize}`
          : `Tab Size: ${model.settings.tabSize}`;
        eol.value = "lf";
        selection.textContent = "";
        cursor.textContent = "";
        size.textContent = "";
        note.textContent = model.note;
        return;
      }

      const languageValue = tab.language;
      if (language.value !== languageValue) language.value = languageValue;
      language.title = `Language mode: ${languageLabel(languageValue)}${tab.languageOverridden ? " (chosen by you)" : ""}`;

      indentation.textContent = model.settings.insertSpaces
        ? `Spaces: ${model.settings.tabSize}`
        : `Tab Size: ${model.settings.tabSize}`;
      indentation.title = model.settings.insertSpaces
        ? `Indenting with ${model.settings.tabSize} spaces`
        : "Indenting with tab characters";

      if (eol.value !== tab.eol) eol.value = tab.eol;
      eol.title =
        tab.eol === "crlf" ? "Saved with CRLF line endings" : "Saved with LF line endings";

      selection.textContent =
        model.cursor.selected > 0
          ? `${model.cursor.selections > 1 ? `${model.cursor.selections} cursors, ` : ""}${model.cursor.selected} selected`
          : model.cursor.selections > 1
            ? `${model.cursor.selections} cursors`
            : "";
      cursor.textContent = `Ln ${model.cursor.line}, Col ${model.cursor.column}`;
      size.textContent = `${formatBytes(tab.bytes)} · ${model.lineCount} ${model.lineCount === 1 ? "line" : "lines"}`;
      size.title = model.dirty ? "Size on disk at the last save" : "Size on disk";
      note.textContent = model.note;
    },
  };
}
