import { dirName } from "./files";

export interface TransferFile {
  kind: "file";
  name: string;
  bytes: Uint8Array;
}

export interface TransferFolder {
  kind: "directory";
  name: string;
  children: TransferItem[];
}

export interface TransferPath {
  kind: "path";
  name: string;
  path: string;
}

export type TransferItem = TransferFile | TransferFolder | TransferPath;

function extensionOf(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, extension: "" };
  return { base: name.slice(0, dot), extension: name.slice(dot) };
}

export function uniqueName(name: string, taken: readonly string[]): string {
  const lower = (value: string): string => value.toLowerCase();
  const used = new Set(taken.map(lower));
  if (!used.has(lower(name))) return name;
  const { base, extension } = extensionOf(name);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!used.has(lower(candidate))) return candidate;
  }
  return `${base} (${taken.length + 2})${extension}`;
}

export function assignNames(
  items: readonly TransferItem[],
  taken: readonly string[],
): Array<{ item: TransferItem; name: string }> {
  const used = [...taken];
  return items.map((item) => {
    const name = uniqueName(item.name, used);
    used.push(name);
    return { item, name };
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

export function pasteDirectory(
  root: string | null,
  row: { path: string; isDir: boolean } | null,
): string | null {
  if (root === null) return null;
  if (row === null) return root;
  return row.isDir ? row.path : dirName(row.path);
}

export function pathsFromUriList(text: string): string[] {
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("file://")) continue;
    const raw = trimmed.slice("file://".length);
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    if (decoded.length > 0 && !paths.includes(decoded)) paths.push(decoded);
  }
  return paths;
}

export function countItems(items: readonly TransferItem[]): number {
  let total = 0;
  for (const item of items) {
    total += 1;
    if (item.kind === "directory") total += countItems(item.children);
  }
  return total;
}
