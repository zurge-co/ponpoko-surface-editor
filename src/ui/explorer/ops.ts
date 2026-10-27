import type { ExplorerDeps } from "../explorer";
import { dirName, joinPath, shortenPath } from "../../files";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
import type { ExplorerRow } from "./model";
import { nameProblem } from "./model";

export interface OpsPorts {
  deps: ExplorerDeps;
  expanded: Set<string>;
  root(): string | null;
  selected(): string | null;
  select(path: string | null): void;
  selectedRow(): ExplorerRow | null;
  targetDirectory(): string | null;
  siblingsOf(folder: string): string[];
  refresh(): Promise<void>;
  focusRow(path: string | null): void;
  remap(from: string, to: string): void;
  forget(path: string): void;
}

export function createOps(ports: OpsPorts) {
  async function createOp(kind: "file" | "directory"): Promise<void> {
    const parent = ports.targetDirectory();
    if (parent === null) {
      ports.deps.onNote("Open a folder first");
      return;
    }
    const name = await ports.deps.askName({
      title: kind === "file" ? "New File" : "New Folder",
      message: `In ${shortenPath(parent, 64)}`,
      label: kind === "file" ? "File name" : "Folder name",
      placeholder: kind === "file" ? "notes.md" : "notes",
      confirmLabel: "Create",
      validate: (value) => nameProblem(value, ports.siblingsOf(parent)),
    });
    if (name === null) return;

    const path = joinPath(parent, name);
    try {
      await ports.deps.fs.create(path, kind);
      ports.expanded.add(parent);
      ports.deps.onNote(kind === "file" ? `made ${name}` : `made the folder ${name}`);
      ports.select(path);
      await ports.refresh();
      if (kind === "file") {
        ports.focusRow(path);
        await ports.deps.openFile(path);
      }
    } catch (failure) {
      ports.deps.onError(`Could not create ${name}: ${messageOf(failure)}`);
    }
  }

  async function renameOp(): Promise<void> {
    const row = ports.selectedRow();
    if (row === null || ports.root() === null) {
      ports.deps.onNote("Select a file or folder to rename");
      return;
    }
    if (row.path === ports.root()) {
      ports.deps.onNote("The open folder itself cannot be renamed from here");
      return;
    }
    const parent = dirName(row.path);
    const name = await ports.deps.askName({
      title: `Rename ${row.name}`,
      label: "New name",
      value: row.name,
      confirmLabel: "Rename",
      validate: (value) =>
        value === row.name
          ? null
          : nameProblem(
              value,
              ports.siblingsOf(parent).filter((sibling) => sibling !== row.name),
            ),
    });
    if (name === null || name === row.name) return;

    const target = joinPath(parent, name);
    try {
      await ports.deps.fs.rename(row.path, target);
      ports.deps.onRenamed(row.path, target);
      ports.remap(row.path, target);
      ports.select(target);
      ports.deps.onNote(`renamed ${row.name} to ${name}`);
      await ports.refresh();
      ports.focusRow(target);
    } catch (failure) {
      ports.deps.onError(`Could not rename ${row.name}: ${messageOf(failure)}`);
    }
  }

  async function removeOp(): Promise<void> {
    const row = ports.selectedRow();
    if (row === null || ports.root() === null) {
      ports.deps.onNote("Select a file or folder to delete");
      return;
    }
    if (row.path === ports.root()) {
      ports.deps.onNote("The open folder itself cannot be deleted from here");
      return;
    }
    const info = await ports.deps.fs.stat(row.path).catch(() => null);
    const isDir = info !== null && info.exists ? info.is_dir : row.isDir;

    const confirmed = await ports.deps.confirm({
      title: `Delete ${row.name}?`,
      message: isDir
        ? `The folder ${row.name} and everything inside it will be deleted from this machine. This cannot be undone.`
        : `${row.name} will be deleted from this machine. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    const parent = dirName(row.path);
    try {
      await ports.deps.fs.remove(row.path, { recursive: isDir });
      ports.deps.onDeleted(row.path);
      ports.forget(row.path);
      ports.select(parent);
      ports.deps.onNote(`deleted ${row.name}`);
      await ports.refresh();
      ports.focusRow(ports.selected());
    } catch (failure) {
      ports.deps.onError(`Could not delete ${row.name}: ${messageOf(failure)}`);
    }
  }

  return {
    create: createOp,
    renameSelected: renameOp,
    deleteSelected: removeOp,
  };
}
