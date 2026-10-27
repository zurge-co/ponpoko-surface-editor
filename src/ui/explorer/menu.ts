import type { MenuEntry } from "../menu";
import type { ExplorerRow } from "./model";

export interface MenuActions {
  open(path: string): void;
  create(kind: "file" | "directory"): void;
  rename(): void;
  remove(): void;
  copyPath(path: string): void;
  reveal(path: string): void;
  refresh(): void;
  toggleHidden(): void;
}

export function menuEntries(
  input: { row: ExplorerRow | null; root: string | null; showHidden: boolean },
  actions: MenuActions,
): MenuEntry[] {
  const { row, root, showHidden } = input;
  const canModify = row !== null && row.path !== root;
  const entries: MenuEntry[] = [
      {
        type: "item",
        label: "Open",
        run: () => {
          if (row !== null) actions.open(row.path);
        },
        disabled: row === null || row.isDir,
      },
      { type: "separator" },
      { type: "item", label: "New File…", run: () => actions.create("file") },
      { type: "item", label: "New Folder…", run: () => actions.create("directory") },
      { type: "separator" },
      {
        type: "item",
        label: "Rename…",
        run: () => actions.rename(),
        disabled: !canModify,
      },
      {
        type: "item",
        label: "Delete",
        run: () => actions.remove(),
        danger: true,
        disabled: !canModify,
      },
      { type: "separator" },
      {
        type: "item",
        label: "Copy Path",
        run: () => {
          if (row !== null) actions.copyPath(row.path);
        },
        disabled: row === null,
      },
      {
        type: "item",
        label: "Reveal in File Manager",
        run: () => {
          if (row !== null) actions.reveal(row.path);
        },
        disabled: row === null,
      },
      { type: "separator" },
      { type: "item", label: "Refresh", run: () => actions.refresh() },
      {
        type: "item",
        label: showHidden ? "Hide Hidden Files" : "Show Hidden Files",
        run: () => actions.toggleHidden(),
      },
  ];


  return entries;
}
