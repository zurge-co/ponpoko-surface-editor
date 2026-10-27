import type { CreateAnswer, DeleteAnswer, ListAnswer, ListEntry, RenameAnswer, StatAnswer } from "../api";
import {
  baseName,
  dirName,
  isUnder,
  shortenPath,
} from "../files";
import { createIcon, type IconName } from "./icons";
import { showMenu } from "./menu";
import { compareEntries, createFolderLoads, explorerRows } from "./explorer/model";
import { menuEntries } from "./explorer/menu";
import { createOps } from "./explorer/ops";
import { revealActive as revealActivePath } from "./explorer/reveal";
import { markActive } from "./explorer/active";
import { drawTree, focusRow as focusRowInTree, rowNode, selectedRow, type TreePorts } from "./explorer/render";

export * from "./explorer/model";

export interface ExplorerFs {
  list(path: string, options?: { showHidden?: boolean }): Promise<ListAnswer>;
  create(path: string, kind: "file" | "directory"): Promise<CreateAnswer>;
  rename(path: string, to: string): Promise<RenameAnswer>;
  remove(path: string, options?: { recursive?: boolean }): Promise<DeleteAnswer>;
  stat(path: string): Promise<StatAnswer>;
  reveal(path: string): Promise<{ revealed: boolean }>;
}

export interface ExplorerRow {
  path: string;
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  depth: number;
}

export interface ExplorerTreeInput {
  root: string;
  expanded: ReadonlySet<string>;
  children: ReadonlyMap<string, readonly ListEntry[]>;
  showHidden: boolean;
  filter: string;
}


export interface NameRequest {
  title: string;
  message?: string;
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?(value: string): string | null;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

export interface ExplorerDeps {
  fs: ExplorerFs;
  root(): string | null;
  activePath(): string | null;
  openFile(path: string): void | Promise<void>;
  openFolder?(): void | Promise<void>;
  askName(request: NameRequest): Promise<string | null>;
  confirm(request: ConfirmRequest): Promise<boolean>;
  onRenamed(from: string, to: string): void;
  onDeleted(path: string): void;
  onReveal(path: string): void | Promise<void>;
  onCopyPath(path: string): void | Promise<void>;
  onError(message: string): void;
  onNote(message: string): void;
}

export interface Explorer {
  readonly element: HTMLElement;
  setRoot(root: string | null): void;
  refresh(): Promise<void>;
  setActivePath(path: string | null): void;
  revealActive(): Promise<void>;
  create(kind: "file" | "directory"): Promise<void>;
  renameSelected(): Promise<void>;
  deleteSelected(): Promise<void>;
  collapseAll(): void;
  focus(): void;
  selectedPath(): string | null;
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

function iconButton(icon: IconName, label: string): HTMLButtonElement {
  const button = el("button", "icon-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(icon, 14));
  return button;
}

export function createExplorer(deps: ExplorerDeps): Explorer {
  let root: string | null = null;
  let expanded = new Set<string>();
  let children = new Map<string, ListEntry[]>();
  let loading = new Set<string>();
  let selected: string | null = null;
  let showHidden = false;
  let filter = "";
  let rows: ExplorerRow[] = [];
  let generation = 0;
  const loads = createFolderLoads();

  const element = el("div", "explorer");

  const toolbar = el("div", "view-toolbar");
  const newFileButton = iconButton("file", "New File…");
  const newFolderButton = iconButton("folder", "New Folder…");
  const refreshButton = iconButton("refresh", "Refresh the folder");
  const collapseButton = iconButton("symbols", "Collapse every folder");
  const hiddenButton = iconButton("hidden", "Show hidden files");
  hiddenButton.setAttribute("aria-pressed", "false");
  toolbar.append(newFileButton, newFolderButton, refreshButton, collapseButton, hiddenButton);

  const filterRow = el("div", "explorer-filter");
  const filterIcon = el("span", "explorer-filter-icon");
  filterIcon.append(createIcon("search", 13));
  const filterInput = el("input", "explorer-filter-input");
  filterInput.type = "text";
  filterInput.autocomplete = "off";
  filterInput.spellcheck = false;
  filterInput.placeholder = "Filter files by name";
  filterInput.setAttribute("aria-label", "Filter files by name");
  filterRow.append(filterIcon, filterInput);

  const tree = el("div", "tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Files in the open folder");
  tree.tabIndex = -1;

  const empty = el("div", "explorer-empty");
  const emptyText = el("p", "explorer-empty-text", "Open a folder to see the files in it.");
  const emptyButton = el("button", "welcome-button primary", "Open Folder…");
  emptyButton.type = "button";
  empty.append(emptyText, emptyButton);

  element.append(toolbar, filterRow, tree, empty);

  function visibleRows(): ExplorerRow[] {
    if (root === null) return [];
    return explorerRows({ root, expanded, children, showHidden, filter });
  }

  const treePorts: TreePorts = {
    tree,
    filterRow,
    toolbar,
    empty,
    root: () => root,
    rows: () => rows,
    setRows: (next) => {
      rows = next;
    },
    selected: () => selected,
    select: (path) => {
      selected = path;
    },
    expandedHas: (path) => expanded.has(path),
    loadingHas: (path) => loading.has(path),
    visibleRows,
    toggleFolder: (path) => void toggleFolder(path),
    openFile: (path) => void deps.openFile(path),
    showRowMenu: (row, event) => showRowMenu(row, event),
    activePath: () => deps.activePath(),
    focusRow: (path) => focusRow(path),
  };

  function selectedRowInTree(): ExplorerRow | null {
    return selectedRow(rows, selected);
  }

  function draw(): void {
    drawTree(treePorts);
  }

  function focusRow(path: string | null): void {
    focusRowInTree(tree, path);
  }

  async function loadFolder(path: string, under: number): Promise<boolean> {
    const token = loads.start(path);
    try {
      const answer = await deps.fs.list(path, { showHidden: true });
      if (under !== generation || !loads.isCurrent(path, token)) return false;
      children.set(path, [...answer.entries].sort(compareEntries));
      return true;
    } catch (failure) {
      if (under !== generation || !loads.isCurrent(path, token)) return false;
      children.delete(path);
      expanded.delete(path);
      deps.onError(`${shortenPath(path, 60)} could not be read: ${messageOf(failure)}`);
      return false;
    }
  }

  async function expand(path: string): Promise<void> {
    if (!expanded.has(path) || !children.has(path)) {
      expanded.add(path);
      loading.add(path);
      draw();
    }
    const under = generation;
    await loadFolder(path, under);
    loading.delete(path);
    draw();
  }

  async function toggleFolder(path: string): Promise<void> {
    if (expanded.has(path) && children.has(path)) {
      expanded.delete(path);
      draw();
      focusRow(selected);
      return;
    }
    await expand(path);
    focusRow(selected);
  }

  async function refresh(): Promise<void> {
    const target = root;
    if (target === null) {
      draw();
      return;
    }
    const under = generation;
    expanded.add(target);
    const paths = [...new Set([target, ...expanded])];
    for (const path of paths) loading.add(path);
    draw();
    await Promise.all(paths.map((path) => loadFolder(path, under)));
    if (under !== generation) return;
    for (const path of paths) loading.delete(path);
    for (const path of [...expanded]) {
      if (path !== target && !children.has(path) && !loading.has(path)) expanded.delete(path);
    }
    draw();
  }

  function forget(path: string): void {
    for (const key of [...children.keys()]) {
      if (isUnder(key, path)) children.delete(key);
    }
    for (const key of [...expanded]) {
      if (isUnder(key, path)) expanded.delete(key);
    }
    for (const key of [...loading]) {
      if (isUnder(key, path)) loading.delete(key);
    }
  }

  function remap(from: string, to: string): void {
    const rebase = (path: string): string => `${to}${path.slice(from.length)}`;
    expanded = new Set([...expanded].map((path) => (isUnder(path, from) ? rebase(path) : path)));
    if (selected !== null && isUnder(selected, from)) selected = rebase(selected);
    children = new Map();
  }

  function targetDirectory(): string | null {
    const row = selectedRowInTree();
    if (root === null) return null;
    if (row === null) return root;
    return row.isDir ? row.path : dirName(row.path);
  }

  function siblingsOf(folder: string): string[] {
    return (children.get(folder) ?? []).map((entry) => entry.name);
  }

  const ops = createOps({
    deps,
    expanded,
    root: () => root,
    selected: () => selected,
    select: (path) => {
      selected = path;
    },
    selectedRow: selectedRowInTree,
    targetDirectory,
    siblingsOf,
    refresh,
    focusRow,
    remap,
    forget,
  });
  const { create, renameSelected, deleteSelected } = ops;

  const menuActions = {
    open: (path: string) => void deps.openFile(path),
    create: (kind: "file" | "directory") => void create(kind),
    rename: () => void renameSelected(),
    remove: () => void deleteSelected(),
    copyPath: (path: string) => void deps.onCopyPath(path),
    reveal: (path: string) => void deps.onReveal(path),
    refresh: () => void refresh(),
    toggleHidden: () => toggleHidden(),
  };
  const entriesFor = (row: ExplorerRow | null) =>
    menuEntries({ row, root, showHidden }, menuActions);

  function showRowMenu(row: ExplorerRow | null, event: MouseEvent): void {
    showMenu({
      x: event.clientX,
      y: event.clientY,
      label: row === null ? "Folder actions" : `Actions for ${row.name}`,
      entries: entriesFor(row),
    });
  }

  function toggleHidden(): void {
    showHidden = !showHidden;
    hiddenButton.setAttribute("aria-pressed", String(showHidden));
    hiddenButton.classList.toggle("active", showHidden);
    hiddenButton.title = showHidden ? "Hide hidden files" : "Show hidden files";
    draw();
  }


  function selectAt(index: number): void {
    if (rows.length === 0) return;
    const bounded = Math.min(rows.length - 1, Math.max(0, index));
    selected = rows[bounded].path;
    draw();
    focusRow(selected);
  }

  const onTreeKeyDown = (event: KeyboardEvent) => {
    if (rows.length === 0) return;
    const index = Math.max(
      0,
      rows.findIndex((row) => row.path === selected),
    );
    const current = rows[index];

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectAt(index - 1);
    } else if (event.key === "ArrowRight") {
      if (!current?.isDir) return;
      event.preventDefault();
      if (!expanded.has(current.path)) void expand(current.path).then(() => focusRow(selected));
      else selectAt(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (current?.isDir && expanded.has(current.path)) {
        expanded.delete(current.path);
        draw();
        focusRow(selected);
      } else if (current !== undefined && current.depth > 0) {
        const parent = dirName(current.path);
        selectAt(rows.findIndex((row) => row.path === parent));
      }
    } else if (event.key === "Enter") {
      if (current === undefined) return;
      event.preventDefault();
      if (current.isDir) void toggleFolder(current.path).then(() => focusRow(selected));
      else void deps.openFile(current.path);
    } else if (event.key === " ") {
      if (current === undefined || !current.isDir) return;
      event.preventDefault();
      selected = current.path;
      void toggleFolder(current.path).then(() => focusRow(selected));
    } else if (event.key === "F2") {
      event.preventDefault();
      void renameSelected();
    } else if (event.key === "Delete") {
      event.preventDefault();
      void deleteSelected();
    }
  };

  tree.addEventListener("keydown", onTreeKeyDown);

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
      tree.focus();
    }
  });

  newFileButton.addEventListener("click", () => void create("file"));
  newFolderButton.addEventListener("click", () => void create("directory"));
  refreshButton.addEventListener("click", () => void refresh());
  collapseButton.addEventListener("click", () => collapseAll());
  hiddenButton.addEventListener("click", toggleHidden);
  emptyButton.addEventListener("click", () => void deps.openFolder?.());

  tree.addEventListener("contextmenu", (event) => {
    if (event.target !== tree) return;
    event.preventDefault();
    selected = root;
    draw();
    showRowMenu(root === null ? null : { path: root, name: baseName(root), isDir: true, isSymlink: false, depth: 0 }, event);
  });

  function collapseAll(): void {
    if (root === null) return;
    expanded = new Set([root]);
    selected = root;
    draw();
    focusRow(root);
  }

  function setRoot(next: string | null): void {
    const changed = next !== root;
    root = next;
    generation += 1;
    if (changed) {
      expanded = new Set(next === null ? [] : [next]);
      children = new Map();
      loading = new Set();
      selected = next;
      filter = "";
      filterInput.value = "";
    }
    draw();
    if (next !== null) void refresh();
  }

  const setActivePath = (path: string | null) =>
    markActive(
      { tree, root: () => root, selected: () => selected, rows: () => rows, select: (next) => { selected = next; } },
      path,
    );

  const revealActive = () =>
    revealActivePath({
      tree,
      root,
      expanded,
      selected: () => selected,
      select: (path) => {
        selected = path;
      },
      activePath: () => deps.activePath(),
      refresh,
      draw,
    });

  function focus(): void {
    (rowNode(tree, selected ?? "") ?? tree).focus();
  }

  draw();

  return {
    element,
    setRoot,
    refresh,
    setActivePath,
    revealActive,
    create,
    renameSelected,
    deleteSelected,
    collapseAll,
    focus,
    selectedPath: () => selected,
    destroy() {
      generation += 1;
      tree.removeEventListener("keydown", onTreeKeyDown);
      tree.remove();
      element.remove();
    },
  };
}
