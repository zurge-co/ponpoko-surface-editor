import { createIcon } from "./icons";
import { symbolIcon } from "./outline";

export interface PeekLocation {
  path: string;
  relative?: string;
  name: string;
  kind: string;
  line: number;
  column: number;
  length: number;
  language?: string;
  source?: string;
  excerpt?: string;
  isDefinition?: boolean;
}

export interface PeekRequest {
  title: string;
  subtitle?: string;
  locations: PeekLocation[];
  onPick(location: PeekLocation): void;
}

export function peekSummary(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function locationDetail(location: PeekLocation): string {
  const where = location.relative ?? location.path;
  const source = location.source === undefined || location.source.length === 0 ? "" : ` · ${location.source}`;
  return `${where}:${location.line}:${location.column}${source}`;
}

export interface Peek {
  readonly element: HTMLElement;
  show(request: PeekRequest): void;
  hide(): void;
  isOpen(): boolean;
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

export function createPeek(host: HTMLElement): Peek {
  let request: PeekRequest | null = null;
  let active = 0;
  let rows: HTMLButtonElement[] = [];
  let focusBefore: HTMLElement | null = null;

  const element = el("div", "peek");
  element.hidden = true;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "Navigation results");

  const header = el("div", "peek-header");
  const title = el("span", "peek-title");
  const subtitle = el("span", "peek-subtitle");
  const close = el("button", "icon-button peek-close");
  close.type = "button";
  close.title = "Close the list";
  close.setAttribute("aria-label", "Close the navigation list");
  close.append(createIcon("close", 13));
  header.append(title, subtitle, close);

  const list = el("div", "peek-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Navigation results");

  const footer = el("div", "peek-footer", "↑↓ choose · Enter open · Esc close");

  element.append(header, list, footer);

  function draw(): void {
    rows = [];
    title.textContent = request?.title ?? "";
    subtitle.textContent =
      request === null ? "" : request.subtitle ?? peekSummary(request.locations.length, "result");
    list.replaceChildren(
      ...(request?.locations ?? []).map((location, index) => {
        const row = el("button", "peek-row");
        row.type = "button";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === active));
        row.style.setProperty("--index", String(index));

        const icon = el("span", "peek-icon");
        icon.append(createIcon(symbolIcon(location.kind), 13));

        const main = el("span", "peek-main");
        const head = el("span", "peek-head");
        head.append(
          el("span", "peek-name", location.name),
          el("span", "peek-kind", location.isDefinition === true ? "definition" : location.kind),
        );
        const detail = el("span", "peek-detail", locationDetail(location));
        main.append(head, detail);
        if (location.excerpt !== undefined && location.excerpt.length > 0) {
          main.append(el("span", "peek-excerpt", location.excerpt));
        }

        row.append(icon, main);
        row.addEventListener("click", () => choose(index));
        row.addEventListener("pointerenter", () => {
          active = index;
          syncSelection();
        });
        rows.push(row);
        return row;
      }),
    );
    syncSelection();
  }

  function syncSelection(): void {
    rows.forEach((row, index) => row.setAttribute("aria-selected", String(index === active)));
  }

  function focusActive(): void {
    if (rows.length === 0) return;
    active = Math.min(Math.max(0, active), rows.length - 1);
    rows[active]?.focus();
    syncSelection();
  }

  function choose(index: number): void {
    const chosen = request?.locations[index];
    const current = request;
    if (chosen === undefined || current === null) return;
    hide();
    current.onPick(chosen);
  }

  function hide(): void {
    if (element.hidden) return;
    element.hidden = true;
    request = null;
    rows = [];
    list.replaceChildren();
    window.removeEventListener("pointerdown", onPointerDown, true);
    const before = focusBefore;
    focusBefore = null;
    if (before !== null && before.isConnected) before.focus();
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && element.contains(event.target)) return;
    hide();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      active = rows.length === 0 ? 0 : (active + 1) % rows.length;
      focusActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = rows.length === 0 ? 0 : (active - 1 + rows.length) % rows.length;
      focusActive();
    } else if (event.key === "Home") {
      event.preventDefault();
      active = 0;
      focusActive();
    } else if (event.key === "End") {
      event.preventDefault();
      active = Math.max(0, rows.length - 1);
      focusActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  };

  element.addEventListener("keydown", onKeyDown);
  close.addEventListener("click", () => hide());

  host.append(element);

  return {
    element,
    show(next) {
      if (!element.isConnected) host.append(element);
      request = next;
      active = 0;
      focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.hidden = false;
      draw();
      focusActive();
      window.addEventListener("pointerdown", onPointerDown, true);
    },
    hide,
    isOpen() {
      return !element.hidden;
    },
    destroy() {
      window.removeEventListener("pointerdown", onPointerDown, true);
      element.remove();
    },
  };
}
