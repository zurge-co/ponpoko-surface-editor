import { baseName } from "../../files";
import { createIcon } from "../icons";
import { entryIcon } from "./model";
import type { ExplorerRow } from "./model";

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

export interface TreePorts {
  tree: HTMLElement;
  filterRow: HTMLElement;
  toolbar: HTMLElement;
  empty: HTMLElement;
  root(): string | null;
  rows(): ExplorerRow[];
  setRows(rows: ExplorerRow[]): void;
  selected(): string | null;
  select(path: string | null): void;
  expandedHas(path: string): boolean;
  loadingHas(path: string): boolean;
  visibleRows(): ExplorerRow[];
  toggleFolder(path: string): void;
  openFile(path: string): void;
  showRowMenu(row: ExplorerRow, event: MouseEvent): void;
  activePath(): string | null;
  focusRow(path: string | null): void;
}

export function rowNode(tree: HTMLElement, path: string): HTMLElement | null {
    for (const node of tree.children) {
      if (node instanceof HTMLElement && node.dataset.path === path) return node;
    }
    return null;
  }

export function selectedRow(rows: ExplorerRow[], selected: string | null): ExplorerRow | null {
    if (selected === null) return null;
    return rows.find((row) => row.path === selected) ?? null;
  }

  export function drawTree(ports: TreePorts): void {
  const { tree, filterRow, toolbar, empty } = ports;
    ports.setRows(ports.visibleRows());
    const hasRoot = ports.root() !== null;
    tree.hidden = !hasRoot;
    filterRow.hidden = !hasRoot;
    toolbar.hidden = !hasRoot;
    empty.hidden = hasRoot;
    tree.setAttribute("aria-label", hasRoot ? `Files in ${baseName(ports.root() ?? "")}` : "No folder is open");

    if (!hasRoot) {
      tree.replaceChildren();
      return;
    }
    const rows = ports.rows();
    const current = ports.selected();
    if (rows.length > 0 && (current === null || !rows.some((row) => row.path === current))) {
      ports.select(rows[0].path);
    }
    const wanted = ports.selected();
    tree.replaceChildren(
      ...rows.map((row) => {
        const isSelected = row.path === wanted;
        const open = ports.expandedHas(row.path);
        const node = el("div", "tree-row");
        node.dataset.path = row.path;
        node.setAttribute("role", "treeitem");
        node.setAttribute("aria-level", String(row.depth + 1));
        node.setAttribute("aria-selected", String(isSelected));
        node.tabIndex = isSelected ? 0 : -1;
        node.style.setProperty("--depth", String(row.depth));
        if (row.isDir) {
          node.setAttribute("aria-expanded", String(open));
          if (ports.loadingHas(row.path)) {
            node.setAttribute("aria-busy", "true");
            node.classList.add("is-loading");
          }
        }
        node.title = row.isSymlink ? `${row.path} (a link)` : row.path;

        const twisty = el("span", "tree-twisty");
        if (row.isDir) twisty.append(createIcon(open ? "chevron-down" : "chevron-right", 12));

        const icon = el("span", "tree-icon");
        icon.append(createIcon(entryIcon(row.name, row.isDir, open), 13));

        const name = el("span", "tree-name", row.name);
        node.append(twisty, icon, name);

        node.addEventListener("click", () => {
          ports.select(row.path);
          if (row.isDir) void ports.toggleFolder(row.path);
          else {
            drawTree(ports);
            ports.focusRow(row.path);
            ports.openFile(row.path);
          }
        });
        node.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          ports.select(row.path);
          drawTree(ports);
          ports.focusRow(row.path);
          ports.showRowMenu(row, event);
        });
        node.addEventListener("focus", () => {
          ports.select(row.path);
        });
        return node;
      }),
    );

    const active = ports.activePath();
    for (const row of rows) {
      if (row.path === active) rowNode(ports.tree, row.path)?.classList.add("active-tab");
    }
  }

export function focusRow(tree: HTMLElement, path: string | null): void {
    if (path === null) return;
    rowNode(tree, path)?.focus({ preventScroll: true });
  }
