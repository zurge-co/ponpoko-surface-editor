import type { SymbolAnswer } from "../api";
import { baseName } from "../files";
import { createIcon, type IconName } from "./icons";
import { fuzzyMatch } from "./palette";

export interface OutlineSymbol {
  name: string;
  kind: string;
  line: number;
  column: number;
  container: string | null;
  exported: boolean;
}

export interface OutlineRow extends OutlineSymbol {
  depth: number;
}

const CLASS_KINDS = new Set(["class", "interface", "struct", "enum", "trait", "impl", "namespace", "mod", "type"]);
const FUNCTION_KINDS = new Set(["function", "method", "func", "def", "macro"]);
const VARIABLE_KINDS = new Set(["const", "static", "variable", "var", "field", "property"]);
const KEY_KINDS = new Set(["key", "table"]);

export function outlineRows(symbols: readonly OutlineSymbol[]): OutlineRow[] {
  return symbols.map((symbol) => ({
    ...symbol,
    depth: symbol.container !== null && symbol.container.length > 0 ? 1 : 0,
  }));
}

export function filterOutline(rows: readonly OutlineRow[], filter: string): OutlineRow[] {
  const query = filter.trim();
  if (query.length === 0) return [...rows];
  return rows.filter((row) => fuzzyMatch(query, row.name) !== null);
}

export function symbolIcon(kind: string): IconName {
  if (CLASS_KINDS.has(kind)) return "symbol-class";
  if (FUNCTION_KINDS.has(kind)) return "symbol-function";
  if (VARIABLE_KINDS.has(kind)) return "symbol-variable";
  if (KEY_KINDS.has(kind)) return "symbol-key";
  if (kind === "heading") return "symbol-heading";
  return "symbols";
}

export interface OutlineDeps {
  symbols(path: string, text?: string): Promise<SymbolAnswer>;
  active(): { path: string; text: string } | null;
  reveal(line: number): void;
  onError(message: string): void;
}

export interface Outline {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
  clear(): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOutline(deps: OutlineDeps): Outline {
  let symbols: OutlineSymbol[] = [];
  let shownPath: string | null = null;
  let filter = "";
  let loading = false;
  let problem: string | null = null;
  let sequence = 0;

  const element = el("div", "outline");

  const toolbar = el("div", "view-toolbar");
  const filterRow = el("div", "outline-filter");
  const filterIcon = el("span", "outline-filter-icon");
  filterIcon.append(createIcon("search", 13));
  const filterInput = el("input", "outline-filter-input");
  filterInput.type = "text";
  filterInput.autocomplete = "off";
  filterInput.spellcheck = false;
  filterInput.placeholder = "Filter symbols";
  filterInput.setAttribute("aria-label", "Filter symbols by name");
  filterRow.append(filterIcon, filterInput);

  const refreshButton = el("button", "icon-button");
  refreshButton.type = "button";
  refreshButton.title = "Read the symbols again";
  refreshButton.setAttribute("aria-label", "Refresh the outline");
  refreshButton.append(createIcon("refresh", 14));
  toolbar.append(filterRow, refreshButton);

  const fileLine = el("div", "outline-file");
  const list = el("div", "outline-list");
  list.setAttribute("role", "tree");
  list.setAttribute("aria-label", "Symbols in the active file");

  const state = el("div", "outline-state");

  element.append(toolbar, fileLine, list, state);

  function draw(): void {
    const active = deps.active();
    filterRow.hidden = active === null;
    refreshButton.hidden = active === null;
    list.hidden = active === null;
    fileLine.hidden = active === null;

    if (active === null) {
      list.replaceChildren();
      state.hidden = false;
      state.textContent = "Open a file to see its symbols.";
      fileLine.textContent = "";
      return;
    }

    fileLine.textContent = baseName(active.path);
    fileLine.title = active.path;

    if (loading) {
      state.hidden = false;
      state.textContent = "Reading the symbols…";
    } else if (problem !== null) {
      state.hidden = false;
      state.textContent = problem;
    } else if (symbols.length === 0) {
      state.hidden = false;
      state.textContent = "This file declares no symbols this outline can show.";
    } else {
      state.hidden = true;
    }

    const rows = filterOutline(outlineRows(symbols), filter);
    if (rows.length === 0 && symbols.length > 0 && !loading && problem === null) {
      state.hidden = false;
      state.textContent = `No symbol matches “${filter.trim()}”.`;
    }

    list.replaceChildren(
      ...rows.map((row) => {
        const node = el("button", "outline-row");
        node.type = "button";
        node.setAttribute("role", "treeitem");
        node.setAttribute("aria-level", String(row.depth + 1));
        node.style.setProperty("--depth", String(row.depth));
        node.title = `${row.kind} · line ${row.line}`;

        const icon = el("span", "outline-icon");
        icon.append(createIcon(symbolIcon(row.kind), 13));

        const name = el("span", "outline-name", row.name);
        const meta = el("span", "outline-meta", `${row.line}`);

        node.append(icon, name, meta);
        if (row.exported) node.classList.add("exported");
        node.addEventListener("click", () => deps.reveal(row.line));
        return node;
      }),
    );
  }

  async function refresh(): Promise<void> {
    const target = deps.active();
    const token = (sequence += 1);
    if (target === null) {
      shownPath = null;
      symbols = [];
      problem = null;
      loading = false;
      draw();
      return;
    }

    if (target.path !== shownPath) {
      symbols = [];
      filter = "";
      filterInput.value = "";
    }
    loading = true;
    problem = null;
    shownPath = target.path;
    draw();

    try {
      const answer = await deps.symbols(target.path, target.text);
      if (token !== sequence) return;
      symbols = answer.symbols;
    } catch (failure) {
      if (token !== sequence) return;
      symbols = [];
      problem = `The symbols could not be read: ${messageOf(failure)}`;
      deps.onError(`${baseName(target.path)}: the outline could not be read — ${messageOf(failure)}`);
    } finally {
      if (token === sequence) {
        loading = false;
        draw();
      }
    }
  }

  filterInput.addEventListener("input", () => {
    filter = filterInput.value;
    draw();
  });
  filterInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      filterInput.value = "";
      filter = "";
      draw();
    }
  });
  refreshButton.addEventListener("click", () => void refresh());

  draw();

  return {
    element,
    refresh,
    clear() {
      sequence += 1;
      symbols = [];
      shownPath = null;
      problem = null;
      loading = false;
      draw();
    },
    destroy() {
      sequence += 1;
      element.remove();
    },
  };
}
