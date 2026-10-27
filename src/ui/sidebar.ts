import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  readSidebar,
  writeSidebar,
  type SidebarState,
  type StorageLike,
} from "../session";
import { createIcon, type IconName } from "./icons";

export interface SidebarView {
  id: string;
  label: string;
  icon: IconName;
  element: HTMLElement;
  onShow?(): void;
}

export interface SidebarOptions {
  storage?: StorageLike | null;
  state?: Partial<SidebarState>;
  onChange?(state: SidebarState): void;
}

export interface Sidebar {
  readonly element: HTMLElement;
  readonly panel: HTMLElement;
  add(view: SidebarView): void;
  show(id: string): void;
  settle(): void;
  toggle(id?: string): void;
  hide(): void;
  active(): string | null;
  isOpen(): boolean;
  setWidth(width: number): void;
  width(): number;
  state(): SidebarState;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

export function createSidebar(options: SidebarOptions = {}): Sidebar {
  const storage = options.storage === undefined ? null : options.storage;
  const stored = readSidebar(storage);
  let state: SidebarState = {
    open: options.state?.open ?? stored.open,
    active: options.state?.active ?? stored.active,
    width: clampWidth(options.state?.width ?? stored.width),
  };

  const root = el("div", "workbench-sidebar");

  const activityBar = el("div", "activitybar");
  activityBar.setAttribute("role", "toolbar");
  activityBar.setAttribute("aria-orientation", "vertical");
  activityBar.setAttribute("aria-label", "Sidebar sections");

  const panel = el("div", "sidebar");
  panel.setAttribute("aria-label", "Sidebar");

  const header = el("div", "sidebar-header");
  const title = el("h2", "sidebar-title");
  const hideButton = el("button", "icon-button sidebar-hide");
  hideButton.type = "button";
  hideButton.title = "Hide the sidebar";
  hideButton.setAttribute("aria-label", "Hide the sidebar");
  hideButton.append(createIcon("close", 12));
  header.append(title, hideButton);

  const body = el("div", "sidebar-body");

  const handle = el("div", "sidebar-resize");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize the sidebar");
  handle.tabIndex = 0;

  panel.append(header, body, handle);
  root.append(activityBar, panel);

  const views = new Map<string, SidebarView>();
  const buttons = new Map<string, HTMLButtonElement>();
  let shownId: string | null = null;

  function knownActive(): string | null {
    return state.active !== null && views.has(state.active) ? state.active : null;
  }

  function isShowing(): boolean {
    return state.open && knownActive() !== null;
  }

  function persist(): void {
    writeSidebar(storage, state);
    options.onChange?.(state);
  }

  function render(): void {
    const showing = isShowing();
    root.classList.toggle("collapsed", !showing);
    panel.hidden = !showing;

    const active = showing ? knownActive() : null;
    for (const [id, button] of buttons) {
      const isActive = active !== null && id === active;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }

    title.textContent = active === null ? "" : (views.get(active)?.label ?? "");
    for (const [id, view] of views) {
      view.element.hidden = !(active !== null && id === active);
    }

    panel.style.flexBasis = `${state.width}px`;
    panel.style.width = `${state.width}px`;

    const nextShown = active;
    if (nextShown !== shownId) {
      shownId = nextShown;
      if (nextShown !== null) views.get(nextShown)?.onShow?.();
    }
  }

  function show(id: string): void {
    if (!views.has(id)) return;
    state = { ...state, active: id, open: true };
    persist();
    render();
  }

  function hide(): void {
    if (!state.open) return;
    state = { ...state, open: false };
    persist();
    render();
  }

  function toggle(id?: string): void {
    const target = id ?? knownActive() ?? [...views.keys()][0] ?? null;
    if (target === null) return;
    if (target === knownActive() && state.open) hide();
    else show(target);
  }

  function settle(): void {
    if (knownActive() !== null) {
      render();
      return;
    }
    state = { ...state, active: [...views.keys()][0] ?? null };
    persist();
    render();
  }

  function setWidth(width: number): void {
    const next = clampWidth(width);
    if (next === state.width) return;
    state = { ...state, width: next };
    persist();
    panel.style.flexBasis = `${next}px`;
    panel.style.width = `${next}px`;
  }


  let dragging = false;
  let dragOrigin = 0;
  let dragWidth = 0;

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    setWidth(dragWidth + (event.clientX - dragOrigin));
  };

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing-sidebar");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };

  const onHandlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    dragOrigin = event.clientX;
    dragWidth = state.width;
    document.body.classList.add("resizing-sidebar");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  const onHandleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWidth(state.width - (event.shiftKey ? 40 : 12));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWidth(state.width + (event.shiftKey ? 40 : 12));
    } else if (event.key === "Home") {
      event.preventDefault();
      setWidth(MIN_SIDEBAR_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setWidth(MAX_SIDEBAR_WIDTH);
    }
  };

  handle.addEventListener("pointerdown", onHandlePointerDown);
  handle.addEventListener("keydown", onHandleKeyDown);
  hideButton.addEventListener("click", hide);


  const sidebar: Sidebar = {
    element: root,
    panel,

    add(view) {
      if (views.has(view.id)) return;
      views.set(view.id, view);

      const button = el("button", "activity");
      button.type = "button";
      button.title = view.label;
      button.setAttribute("aria-label", view.label);
      button.append(createIcon(view.icon, 18));
      button.addEventListener("click", () => toggle(view.id));
      buttons.set(view.id, button);
      activityBar.append(button);

      body.append(view.element);
      render();
    },

    show,
    toggle,
    settle,
    hide,
    active: () => (isShowing() ? knownActive() : null),
    isOpen: () => isShowing(),
    setWidth,
    width: () => state.width,
    state: () => ({ ...state }),

    destroy() {
      endDrag();
      handle.removeEventListener("pointerdown", onHandlePointerDown);
      handle.removeEventListener("keydown", onHandleKeyDown);
      hideButton.removeEventListener("click", hide);
      root.remove();
    },
  };

  render();
  return sidebar;
}
