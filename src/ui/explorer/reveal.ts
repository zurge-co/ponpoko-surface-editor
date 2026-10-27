import { isUnder, joinPath, relativePath } from "../../files";
import { rowNode } from "./render";

export interface RevealPorts {
  tree: HTMLElement;
  root: string | null;
  expanded: Set<string>;
  selected(): string | null;
  select(path: string | null): void;
  activePath(): string | null;
  refresh(): Promise<void>;
  draw(): void;
}

  export async function revealActive(ports: RevealPorts): Promise<void> {
  const { root, expanded, refresh, draw } = ports;
    const path = ports.activePath();
    if (root === null || path === null || !isUnder(path, root)) return;
    const relative = relativePath(root, path);
    const parts = relative.split("/").filter((part) => part.length > 0);
    let folder = root;
    let changed = !expanded.has(root);
    expanded.add(root);
    for (const part of parts.slice(0, -1)) {
      folder = joinPath(folder, part);
      if (!expanded.has(folder)) {
        expanded.add(folder);
        changed = true;
      }
    }
    ports.select(path);
    if (changed) await refresh();
    else draw();
    const node = rowNode(ports.tree, path);
    node?.classList.add("active-tab");
    node?.scrollIntoView({ block: "nearest" });
  }
