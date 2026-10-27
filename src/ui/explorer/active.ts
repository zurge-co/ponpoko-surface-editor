import { isUnder } from "../../files";
import { rowNode } from "./render";

export function markActive(
  ports: {
    tree: HTMLElement;
    root(): string | null;
    selected(): string | null;
    rows(): { path: string }[];
    select(path: string | null): void;
  },
  path: string | null,
): void {

    if (path === null) return;
    if (ports.root() === null || !isUnder(path, ports.root() ?? "")) return;
    if (ports.selected() === path) return;
    ports.select(path);
    for (const row of ports.rows()) {
      rowNode(ports.tree, row.path)?.classList.toggle("active-tab", row.path === path);
    }
}
