export function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(index + 1) || trimmed;
}

export function dirName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) return index === 0 ? trimmed.slice(0, 1) : "";
  return trimmed.slice(0, index);
}

export function joinPath(folder: string, child: string): string {
  if (folder.length === 0) return child;
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return `${folder.replace(/[/\\]+$/, "")}${separator}${child.replace(/^[/\\]+/, "")}`;
}

export function relativePath(root: string, path: string): string {
  if (root.length === 0) return path;
  const normalizedRoot = root.replace(/[/\\]+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  const prefix = `${normalizedRoot.replace(/\\/g, "/")}/`;
  if (normalizedPath.startsWith(prefix)) return normalizedPath.slice(prefix.length);
  return path;
}

export function isHiddenName(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}

export function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const leading = /^\/+/.exec(normalized)?.[0] ?? "";
  return leading + normalized.slice(leading.length).replace(/\/{2,}/g, "/");
}

export function isUnder(path: string, root: string): boolean {
  const target = pathKey(path);
  const parent = pathKey(root);
  if (parent.length === 0 || target.length === 0) return false;
  if (target === parent) return true;
  return target.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

export const LARGE_FILE_BYTES = 4 * 1024 * 1024;

export function isLargeFile(bytes: number): boolean {
  return bytes >= LARGE_FILE_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortenPath(path: string, maxLength = 64): string {
  if (path.length <= maxLength) return path;
  const name = baseName(path);
  if (name.length + 1 >= maxLength) return `…${name.slice(-(maxLength - 1))}`;
  const keep = maxLength - name.length - 2;
  const head = path.slice(0, Math.max(1, Math.floor(keep / 2)));
  return `${head}…${path.slice(-(name.length + 1))}`;
}
