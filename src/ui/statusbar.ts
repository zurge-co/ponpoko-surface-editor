import type { CursorInfo } from "../editor";
import { formatBytes } from "../files";
import {
  languageChoices,
  languageLabel,
  type LanguageId,
} from "../languages";
import type { EditorSettings } from "../session";
import type { Eol, Tab } from "../tabs";
import { showMenu } from "./menu";

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
  setIndentation(tabSize: number, insertSpaces: boolean): void;
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
  indentation.title = "Indentation for this file";
  indentation.setAttribute("aria-haspopup", "menu");

  let currentModel: StatusModel | null = null;
  indentation.addEventListener("click", () => {
    const tab = currentModel?.tab ?? null;
    const own = tab !== null && (tab.indentationDetected || tab.indentationPinned);
    const currentSize = own && tab !== null ? tab.tabSize : (currentModel?.settings.tabSize ?? 2);
    const currentSpaces = own && tab !== null ? tab.insertSpaces : (currentModel?.settings.insertSpaces ?? true);
    const mark = (size: number, spaces: boolean): string =>
      size === currentSize && spaces === currentSpaces ? " ✓" : "";
    const rect = indentation.getBoundingClientRect();
    showMenu({
      x: rect.left,
      y: rect.top,
      label: "Indentation for this file",
      entries: [
        ...[2, 4, 8].map((size) => ({
          type: "item" as const,
          label: `Indent Using Spaces: ${size}${mark(size, true)}`,
          run: () => handlers.setIndentation(size, true),
        })),
        {
          type: "item" as const,
          label: `Indent Using Tabs${mark(currentSize, false)}`,
          run: () => handlers.setIndentation(currentSize, false),
        },
        { type: "separator" as const },
        {
          type: "item" as const,
          label: "Indentation Settings…",
          run: () => handlers.openSettings(),
        },
      ],
    });
  });

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
  let imageOption: HTMLOptionElement | null = null;

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
      currentModel = model;
      const { tab } = model;
      const hasTab = tab !== null;
      language.disabled = !hasTab;
      indentation.disabled = !hasTab;
      eol.disabled = !hasTab;

      if (imageOption !== null && (tab === null || !tab.asset)) {
        imageOption.remove();
        imageOption = null;
      }

      if (!hasTab) {
        language.value = "text";
        indentation.textContent = model.settings.insertSpaces
          ? `Spaces: ${model.settings.tabSize}`
          : `Tab Size: ${model.settings.tabSize}`;
        eol.value = "lf";
        encoding.textContent = "UTF-8";
        encoding.title = "Files are read and written as UTF-8 text";
        selection.textContent = "";
        cursor.textContent = "";
        size.textContent = "";
        note.textContent = model.note;
        return;
      }

      if (tab.asset) {
        if (imageOption === null) {
          imageOption = document.createElement("option");
          imageOption.value = "__image";
          imageOption.textContent = "Image";
          language.append(imageOption);
        }
        language.value = "__image";
        language.disabled = true;
        language.title = "An image is shown in the preview; it has no language mode";
        indentation.disabled = true;
        indentation.textContent = "Image";
        indentation.title = "An image is shown, not edited";
        eol.disabled = true;
        eol.value = "lf";
        eol.title = "An image is written by the tool that made it, not by this editor";
        encoding.textContent = "Read-only image";
        encoding.title = "Images are drawn from disk and never written";
        selection.textContent = "";
        cursor.textContent = "";
        size.textContent = formatBytes(tab.bytes);
        size.title = "Size on disk";
        note.textContent = model.note;
        return;
      }

      encoding.textContent = "UTF-8";
      encoding.title = "Files are read and written as UTF-8 text";
      const languageValue = tab.language;
      if (language.value !== languageValue) language.value = languageValue;
      language.title = `Language mode: ${languageLabel(languageValue)}${tab.languageOverridden ? " (chosen by you)" : ""}`;

      const own = tab.indentationDetected || tab.indentationPinned;
      const tabSize = own ? tab.tabSize : model.settings.tabSize;
      const insertSpaces = own ? tab.insertSpaces : model.settings.insertSpaces;
      indentation.textContent = insertSpaces ? `Spaces: ${tabSize}` : `Tab Size: ${tabSize}`;
      const source = tab.indentationDetected
        ? " — read from this file"
        : tab.indentationPinned
          ? " — chosen for this file"
          : " — from the editor settings";
      indentation.title = `${
        insertSpaces ? `Indenting with ${tabSize} spaces` : "Indenting with tab characters"
      }${source}`;

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
