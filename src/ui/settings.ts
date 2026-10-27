import type { EditorSettings } from "../session";

export interface SettingsHandlers {
  change(next: EditorSettings): void;
}

export interface SettingsSheet {
  readonly element: HTMLElement;
  open(settings: EditorSettings): void;
  close(): void;
  isOpen(): boolean;
}

function label(text: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement("label");
  node.className = "settings-row";
  const span = document.createElement("span");
  span.className = "settings-label";
  span.textContent = text;
  node.append(span, control);
  return node;
}

function checkbox(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "settings-checkbox";
  return input;
}

export function createSettingsSheet(handlers: SettingsHandlers): SettingsSheet {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.hidden = true;

  const panel = document.createElement("div");
  panel.className = "modal settings";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "ponpoko-editor-settings-title");

  const heading = document.createElement("h2");
  heading.className = "modal-title";
  heading.id = "ponpoko-editor-settings-title";
  heading.textContent = "Editor settings";

  const fontSize = document.createElement("input");
  fontSize.type = "number";
  fontSize.min = "10";
  fontSize.max = "32";
  fontSize.step = "1";
  fontSize.className = "settings-number";
  fontSize.setAttribute("aria-label", "Text size in pixels");

  const tabSize = document.createElement("select");
  tabSize.className = "settings-select";
  tabSize.setAttribute("aria-label", "Tab size");
  for (const size of [2, 4, 8]) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = `${size} columns`;
    tabSize.append(option);
  }

  const insertSpaces = checkbox();
  const wordWrap = checkbox();
  const restoreSession = checkbox();

  const hint = document.createElement("p");
  hint.className = "settings-hint";
  hint.textContent =
    "Text size, wrap, indentation and session restore are stored on this machine. There is no telemetry and no network request.";

  const done = document.createElement("button");
  done.type = "button";
  done.className = "modal-button primary";
  done.textContent = "Done";
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(done);

  panel.append(
    heading,
    label("Text size", fontSize),
    label("Tab size", tabSize),
    label("Insert spaces", insertSpaces),
    label("Word wrap", wordWrap),
    label("Restore open tabs on start", restoreSession),
    hint,
    actions,
  );
  backdrop.append(panel);

  let open = false;
  let current: EditorSettings = {
    fontSize: 13,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: false,
    restoreSession: true,
  };
  let restoreFocus: HTMLElement | null = null;

  const read = (): EditorSettings => ({
    fontSize: Math.min(32, Math.max(10, Math.round(Number(fontSize.value) || current.fontSize))),
    tabSize: Math.min(16, Math.max(1, Math.round(Number(tabSize.value) || current.tabSize))),
    insertSpaces: insertSpaces.checked,
    wordWrap: wordWrap.checked,
    restoreSession: restoreSession.checked,
  });

  const emit = () => {
    current = read();
    handlers.change(current);
  };

  fontSize.addEventListener("change", emit);
  tabSize.addEventListener("change", emit);
  insertSpaces.addEventListener("change", emit);
  wordWrap.addEventListener("change", emit);
  restoreSession.addEventListener("change", emit);

  const close = () => {
    if (!open) return;
    open = false;
    backdrop.hidden = true;
    if (restoreFocus !== null && restoreFocus.isConnected) restoreFocus.focus();
    restoreFocus = null;
  };

  done.addEventListener("click", close);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("input, select, button")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    true,
  );

  return {
    element: backdrop,
    open(settings) {
      current = settings;
      fontSize.value = String(settings.fontSize);
      tabSize.value = String(settings.tabSize);
      insertSpaces.checked = settings.insertSpaces;
      wordWrap.checked = settings.wordWrap;
      restoreSession.checked = settings.restoreSession;
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      open = true;
      backdrop.hidden = false;
      fontSize.focus();
      fontSize.select();
    },
    close,
    isOpen: () => open,
  };
}
