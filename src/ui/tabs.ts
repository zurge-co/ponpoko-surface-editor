import { languageLabel, type LanguageId } from "../languages";
import type { Tab } from "../tabs";
import { createIcon, type IconName } from "./icons";

export interface TabStripHandlers {
  activate(id: string): void;
  close(id: string): void;
  contextMenu(id: string, event: MouseEvent): void;
}

export interface TabStrip {
  readonly element: HTMLElement;
  render(tabs: readonly Tab[], activeId: string | null, dirty: (tab: Tab) => boolean): void;
  setDirty(id: string, isDirty: boolean): void;
  scrollActiveIntoView(): void;
}

const ICON_BY_LANGUAGE: Partial<Record<LanguageId, IconName>> = {
  markdown: "file-markdown",
  mdx: "file-markdown",
  html: "file-code",
  xml: "file-code",
  css: "file-code",
  scss: "file-code",
  less: "file-code",
  typescript: "file-code",
  tsx: "file-code",
  javascript: "file-code",
  jsx: "file-code",
  rust: "file-code",
  yaml: "file-text",
  json: "file-text",
  jsonc: "file-text",
  toml: "file-text",
  properties: "file-text",
  diff: "file-text",
  text: "file-text",
};

function iconFor(language: LanguageId): IconName {
  return ICON_BY_LANGUAGE[language] ?? "file";
}

export function createTabStrip(handlers: TabStripHandlers): TabStrip {
  const element = document.createElement("div");
  element.className = "tabstrip";
  element.setAttribute("role", "tablist");
  element.setAttribute("aria-label", "Open files");
  element.setAttribute("aria-orientation", "horizontal");

  let tabs: readonly Tab[] = [];
  let activeId: string | null = null;
  let dirtyOf: (tab: Tab) => boolean = () => false;

  const activate = (id: string) => handlers.activate(id);

  const moveFocus = (from: number, step: number) => {
    if (tabs.length === 0) return;
    const next = (from + step + tabs.length) % tabs.length;
    const target = tabs[next];
    activate(target.id);
    const node = element.querySelector<HTMLElement>(`[data-tab-id="${cssEscape(target.id)}"]`);
    node?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const holder = target.closest<HTMLElement>("[data-tab-id]");
    if (holder === null) return;
    const id = holder.dataset.tabId ?? "";
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(tabs.length - 1, 0);
    }
  };
  element.addEventListener("keydown", onKeyDown);

  const render = (nextTabs: readonly Tab[], nextActiveId: string | null, dirty: (tab: Tab) => boolean) => {
    tabs = nextTabs;
    activeId = nextActiveId;
    dirtyOf = dirty;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest("[data-tab-id]") : null;
    const focusedId = focused instanceof HTMLElement ? focused.dataset.tabId ?? null : null;

    element.replaceChildren(
      ...tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isDirty = dirtyOf(tab);
        const holder = document.createElement("div");
        holder.className = `tab${isActive ? " active" : ""}${isDirty ? " dirty" : ""}`;
        holder.dataset.tabId = tab.id;
        holder.setAttribute("role", "tab");
        holder.setAttribute("aria-selected", String(isActive));
        holder.setAttribute("aria-controls", "editor-region");
        holder.setAttribute("aria-label", `${tab.name}${isDirty ? ", unsaved changes" : ""}`);
        holder.tabIndex = isActive ? 0 : -1;
        holder.title = `${tab.path}\n${languageLabel(tab.language)}${isDirty ? " — unsaved changes" : ""}`;

        const icon = document.createElement("span");
        icon.className = "tab-icon";
        icon.append(createIcon(iconFor(tab.language), 13));

        const name = document.createElement("span");
        name.className = "tab-name";
        name.textContent = tab.name;

        const dot = document.createElement("span");
        dot.className = "tab-dirty-dot";
        dot.setAttribute("aria-hidden", "true");

        const close = document.createElement("button");
        close.type = "button";
        close.className = "tab-close";
        close.tabIndex = -1;
        close.setAttribute("aria-label", `Close ${tab.name}`);
        close.title = `Close ${tab.name}`;
        close.append(createIcon("close", 12));
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          handlers.close(tab.id);
        });

        holder.append(icon, name, dot, close);
        holder.addEventListener("mousedown", (event) => {
          if (event.target instanceof Element && event.target.closest(".tab-close") !== null) return;
          if (event.button === 1) {
            event.preventDefault();
            handlers.close(tab.id);
            return;
          }
          if (event.button === 0) activate(tab.id);
        });
        holder.addEventListener("keydown", (event) => {
          if (event.target !== holder) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate(tab.id);
          }
        });
        holder.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          handlers.contextMenu(tab.id, event);
        });
        return holder;
      }),
    );

    if (focusedId !== null) {
      element.querySelector<HTMLElement>(`[data-tab-id="${cssEscape(focusedId)}"]`)?.focus();
    }
  };

  return {
    element,
    render,
    setDirty(id, isDirty) {
      const holder = element.querySelector<HTMLElement>(`[data-tab-id="${cssEscape(id)}"]`);
      if (holder === null) return;
      holder.classList.toggle("dirty", isDirty);
      holder.setAttribute("aria-label", `${holder.querySelector(".tab-name")?.textContent ?? ""}${isDirty ? ", unsaved changes" : ""}`);
    },
    scrollActiveIntoView() {
      if (activeId === null) return;
      const node = element.querySelector<HTMLElement>(`[data-tab-id="${cssEscape(activeId)}"]`);
      node?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  };
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
