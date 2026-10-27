import type { CommandDefinition } from "./commands";

export interface FuzzyMatch {
  score: number;
  positions: number[];
}

const SEPARATORS = "/\\_- .";

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  if (SEPARATORS.includes(previous)) return true;
  const char = text[index];
  const previousIsUpperCase = previous === previous.toUpperCase() && previous !== previous.toLowerCase();
  const charIsUpperCase = char === char.toUpperCase() && char !== char.toLowerCase();
  return !previousIsUpperCase && charIsUpperCase;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return { score: 0, positions: [] };
  const haystack = text.toLowerCase();

  const positions: number[] = [];
  let cursor = 0;
  for (const char of needle) {
    const at = haystack.indexOf(char, cursor);
    if (at < 0) return null;
    positions.push(at);
    cursor = at + 1;
  }

  let score = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    score += 4;
    if (isWordStart(text, position)) score += 8;
    if (index > 0 && positions[index - 1] === position - 1) score += 6;
    if (index === 0) score -= Math.min(12, Math.floor(position / 2));
  }
  score -= Math.min(8, Math.floor((text.length - needle.length) / 10));
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  score: number;
  positions: number[];
}

export function rankCandidates<T>(
  query: string,
  items: readonly T[],
  text: (item: T) => string,
  limit = 100,
): Ranked<T>[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return items.slice(0, Math.max(1, limit)).map((item) => ({ item, score: 0, positions: [] }));
  }
  const scored: Array<Ranked<T> & { order: number; length: number }> = [];
  items.forEach((item, order) => {
    const label = text(item);
    const match = fuzzyMatch(trimmed, label);
    if (match === null) return;
    scored.push({ item, score: match.score, positions: match.positions, order, length: label.length });
  });
  scored.sort((a, b) => b.score - a.score || a.length - b.length || a.order - b.order);
  return scored.slice(0, Math.max(1, limit)).map(({ item, score, positions }) => ({ item, score, positions }));
}

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  keybinding?: string;
}

export interface PaletteOptions {
  label: string;
  placeholder: string;
  items(): PaletteItem[] | Promise<PaletteItem[]>;
  onChoose(item: PaletteItem): void;
  emptyText?: string;
  limit?: number;
  onError?(message: string): void;
}

export interface Palette {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  reload(): void;
  destroy(): void;
}

let openPalette: Palette | null = null;

export function isPaletteOpen(): boolean {
  return openPalette !== null;
}

export function closePalette(): void {
  openPalette?.close();
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function labelWithMatches(label: string, positions: readonly number[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marked = new Set(positions);
  let index = 0;
  while (index < label.length) {
    const isMarked = marked.has(index);
    let end = index + 1;
    while (end < label.length && marked.has(end) === isMarked) end += 1;
    const piece = label.slice(index, end);
    if (isMarked) {
      const mark = document.createElement("mark");
      mark.textContent = piece;
      fragment.append(mark);
    } else {
      fragment.append(document.createTextNode(piece));
    }
    index = end;
  }
  return fragment;
}

let paletteCounter = 0;

export function createPalette(options: PaletteOptions): Palette {
  const limit = options.limit ?? 100;
  const listId = `ponpoko-palette-list-${(paletteCounter += 1)}`;

  const backdrop = element("div", "palette-backdrop");
  backdrop.hidden = true;

  const panel = element("div", "palette");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", options.label);

  const input = element("input", "palette-input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = options.placeholder;
  input.setAttribute("aria-label", options.label);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");

  const list = element("div", "palette-list");
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", options.label);

  const footer = element("div", "palette-footer");
  const count = element("span", "palette-count");
  const hint = element("span", "palette-hint");
  hint.textContent = "↑↓ move · ↵ open · esc close";
  footer.append(count, hint);

  panel.append(input, list, footer);
  backdrop.append(panel);
  document.body.append(backdrop);

  let open = false;
  let loading = false;
  let failure: string | null = null;
  let all: PaletteItem[] = [];
  let rows: Ranked<PaletteItem>[] = [];
  let activeIndex = 0;
  let sequence = 0;
  let restoreFocus: HTMLElement | null = null;
  const buttons: HTMLButtonElement[] = [];

  const query = (): string => input.value;

  const placeholderRow = (text: string): HTMLElement => {
    const row = element("div", "palette-empty");
    row.textContent = text;
    return row;
  };

  function renderRows(): void {
    buttons.length = 0;
    list.replaceChildren();

    if (loading) {
      list.append(placeholderRow("Reading…"));
      count.textContent = "";
      return;
    }
    if (failure !== null) {
      list.append(placeholderRow(failure));
      count.textContent = "";
      return;
    }

    rows = rankCandidates(query(), all, (item) => item.label, limit);
    if (rows.length === 0) {
      const trimmed = query().trim();
      list.append(
        placeholderRow(
          trimmed.length === 0
            ? (options.emptyText ?? "There is nothing here to pick.")
            : `Nothing matches “${trimmed}”.`,
        ),
      );
      count.textContent = all.length === 0 ? "" : `0 of ${all.length}`;
      return;
    }
    activeIndex = Math.min(activeIndex, rows.length - 1);

    rows.forEach((row, index) => {
      const button = element("button", "palette-row");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === activeIndex));
      button.dataset.index = String(index);

      const label = element("span", "palette-label");
      label.append(labelWithMatches(row.item.label, row.positions));
      button.append(label);

      if (row.item.detail !== undefined) {
        const detail = element("span", "palette-detail");
        detail.textContent = row.item.detail;
        button.append(detail);
      }
      if (row.item.keybinding !== undefined) {
        const keys = element("span", "palette-keys");
        keys.textContent = row.item.keybinding;
        button.append(keys);
      }
      if (index === activeIndex) button.classList.add("active");

      button.addEventListener("mousemove", () => setActive(index));
      button.addEventListener("click", () => choose(row.item));
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      buttons.push(button);
      list.append(button);
    });

    count.textContent = rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`;
    scrollActiveIntoView();
  }

  function setActive(index: number): void {
    if (rows.length === 0) return;
    activeIndex = (index + rows.length) % rows.length;
    buttons.forEach((button, position) => {
      const active = position === activeIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    scrollActiveIntoView();
  }

  function scrollActiveIntoView(): void {
    buttons[activeIndex]?.scrollIntoView({ block: "nearest" });
  }

  function choose(item: PaletteItem): void {
    close();
    options.onChoose(item);
  }

  async function load(): Promise<void> {
    const token = (sequence += 1);
    loading = true;
    failure = null;
    renderRows();
    try {
      const next = await Promise.resolve(options.items());
      if (token !== sequence || !open) return;
      all = next;
    } catch (error) {
      if (token !== sequence || !open) return;
      all = [];
      failure = `This list could not be read: ${error instanceof Error ? error.message : String(error)}`;
      options.onError?.(failure);
    } finally {
      if (token === sequence && open) {
        loading = false;
        activeIndex = 0;
        renderRows();
      }
    }
  }

  const onInput = () => {
    activeIndex = 0;
    renderRows();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setActive(activeIndex + 1);
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      setActive(activeIndex + 8);
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      setActive(activeIndex - 8);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(rows.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) choose(row.item);
    }
  };

  const onBackdrop = (event: MouseEvent) => {
    if (event.target === backdrop) close();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("mousedown", onBackdrop);

  function present(): void {
    if (open) return;
    if (openPalette !== null && openPalette !== palette) openPalette.close();
    openPalette = palette;
    open = true;
    backdrop.hidden = false;
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.value = "";
    all = [];
    rows = [];
    activeIndex = 0;
    failure = null;
    input.setAttribute("aria-expanded", "true");
    input.focus();
    void load();
  }

  function close(): void {
    if (!open) return;
    open = false;
    sequence += 1;
    backdrop.hidden = true;
    input.setAttribute("aria-expanded", "false");
    if (openPalette === palette) openPalette = null;
    rows = [];
    buttons.length = 0;
    list.replaceChildren();
    const previous = restoreFocus;
    restoreFocus = null;
    if (previous !== null && previous.isConnected) previous.focus();
  }

  const palette: Palette = {
    element: backdrop,
    open: present,
    close,
    isOpen: () => open,
    reload: () => {
      if (open) void load();
    },
    destroy() {
      close();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      backdrop.removeEventListener("mousedown", onBackdrop);
      backdrop.remove();
    },
  };

  return palette;
}

export interface CommandPaletteDeps {
  commands(): readonly CommandDefinition[];
  run(id: string): void | Promise<unknown>;
}

export function createCommandPalette(deps: CommandPaletteDeps): Palette {
  return createPalette({
    label: "Command Palette",
    placeholder: "Run a command of this editor",
    emptyText: "No command of this editor matches.",
    items: () =>
      deps.commands().map((command) => ({
        id: command.id,
        label: command.title,
        ...(command.detail === undefined ? {} : { detail: command.detail }),
        ...(command.keybinding === undefined ? {} : { keybinding: command.keybinding }),
      })),
    onChoose: (item) => {
      void deps.run(item.id);
    },
  });
}
