import type { ListEntry } from "../../api";
import { baseName, isHiddenName } from "../../files";
import { languageFor } from "../../languages";
import { fuzzyMatch } from "../palette";
import type { IconName } from "../icons";

export interface ExplorerFs {
  list(path: string): Promise<ListEntry[]>;
}

export interface ExplorerRow {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  isSymlink: boolean;
}

export interface ExplorerTreeInput {
  root: string;
  expanded: ReadonlySet<string>;
  children: ReadonlyMap<string, readonly ListEntry[]>;
  showHidden: boolean;
  filter: string;
}

export function compareEntries(a: ListEntry, b: ListEntry): number {
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export function visibleEntries(entries: readonly ListEntry[], showHidden: boolean): ListEntry[] {
  const visible = showHidden ? [...entries] : entries.filter((entry) => !isHiddenName(entry.name));
  return visible.sort(compareEntries);
}

export function nameMatches(name: string, filter: string): boolean {
  const query = filter.trim();
  return query.length === 0 || fuzzyMatch(query, name) !== null;
}

export function explorerRows(input: ExplorerTreeInput): ExplorerRow[] {
  const { root } = input;
  if (root.length === 0) return [];
  const rootRow: ExplorerRow = {
    path: root,
    name: baseName(root),
    isDir: true,
    isSymlink: false,
    depth: 0,
  };
  const query = input.filter.trim();

  const walk = (folder: string, depth: number): ExplorerRow[] => {
    const rows: ExplorerRow[] = [];
    for (const entry of visibleEntries(input.children.get(folder) ?? [], input.showHidden)) {
      if (entry.is_dir) {
        const readable = query.length > 0 ? input.children.has(entry.path) : input.expanded.has(entry.path);
        const kids = readable ? walk(entry.path, depth + 1) : [];
        if (nameMatches(entry.name, query) || kids.length > 0) {
          rows.push({ path: entry.path, name: entry.name, isDir: true, isSymlink: entry.is_symlink, depth });
          rows.push(...kids);
        }
      } else if (nameMatches(entry.name, query)) {
        rows.push({ path: entry.path, name: entry.name, isDir: false, isSymlink: entry.is_symlink, depth });
      }
    }
    return rows;
  };

  const children = input.expanded.has(root) || query.length > 0 ? walk(root, 1) : [];
  if (query.length > 0 && children.length === 0) return [];
  return [rootRow, ...children];
}

export function nameProblem(name: string, siblings: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "A name is required.";
  if (/[/\\]/.test(trimmed)) return "A name cannot contain a path separator.";
  if (trimmed === "." || trimmed === "..") return "That is not a file name.";
  if (siblings.some((sibling) => sibling.toLowerCase() === trimmed.toLowerCase())) {
    return `There is already a “${trimmed}” here.`;
  }
  return null;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

export interface FolderLoads {
  start(path: string): number;
  isCurrent(path: string, token: number): boolean;
}

export function createFolderLoads(): FolderLoads {
  let sequence = 0;
  const latest = new Map<string, number>();
  return {
    start(path) {
      sequence += 1;
      latest.set(path, sequence);
      return sequence;
    },
    isCurrent(path, token) {
      return latest.get(path) === token;
    },
  };
}

export function entryIcon(name: string, isDir: boolean, open: boolean): IconName {
  if (isDir) return open ? "folder-open" : "folder";
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (IMAGE_EXTENSIONS.has(extension)) return "file-image";
  const language = languageFor(name);
  if (language === "markdown" || language === "mdx") return "file-markdown";
  if (language === "text") return "file-text";
  return "file-code";
}
