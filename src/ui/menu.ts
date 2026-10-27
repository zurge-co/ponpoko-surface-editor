export type MenuEntry =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      run(): void;
      disabled?: boolean;
      keybinding?: string;
      danger?: boolean;
    };

export interface MenuOptions {
  x: number;
  y: number;
  entries: MenuEntry[];
  label?: string;
}

export interface NavigationMenuActions {
  definition(): void;
  references(): void;
  symbols(): void;
  definitionKey?: string;
  referencesKey?: string;
  symbolsKey?: string;
}

export function navigationMenuEntries(actions: NavigationMenuActions): MenuEntry[] {
  return [
    {
      type: "item",
      label: "Go to Definition",
      ...(actions.definitionKey === undefined ? {} : { keybinding: actions.definitionKey }),
      run: actions.definition,
    },
    {
      type: "item",
      label: "Find All References",
      ...(actions.referencesKey === undefined ? {} : { keybinding: actions.referencesKey }),
      run: actions.references,
    },
    {
      type: "item",
      label: "Go to Symbol in File…",
      ...(actions.symbolsKey === undefined ? {} : { keybinding: actions.symbolsKey }),
      run: actions.symbols,
    },
  ];
}

let openMenu: { element: HTMLElement; close: () => void } | null = null;

export function closeMenu(): void {
  openMenu?.close();
}

export function showMenu(options: MenuOptions): void {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  if (options.label !== undefined) menu.setAttribute("aria-label", options.label);

  const buttons: HTMLButtonElement[] = [];

  for (const entry of options.entries) {
    if (entry.type === "separator") {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      separator.setAttribute("role", "separator");
      menu.append(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `menu-item${entry.danger ? " danger" : ""}`;
    button.setAttribute("role", "menuitem");
    button.disabled = entry.disabled === true;

    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = entry.label;
    button.append(label);
    if (entry.keybinding !== undefined) {
      const keys = document.createElement("span");
      keys.className = "menu-keys";
      keys.textContent = entry.keybinding;
      button.append(keys);
    }
    button.addEventListener("click", () => {
      close();
      entry.run();
    });
    buttons.push(button);
    menu.append(button);
  }

  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.visibility = "hidden";
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(4, options.x), Math.max(4, window.innerWidth - rect.width - 6));
  const top = Math.min(Math.max(4, options.y), Math.max(4, window.innerHeight - rect.height - 6));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "visible";

  const indexOf = (node: EventTarget | null): number =>
    node instanceof HTMLElement
      ? buttons.indexOf(node.closest<HTMLButtonElement>(".menu-item") ?? buttons[0])
      : -1;

  const focusBefore: HTMLElement | null =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const focusAt = (index: number) => {
    if (buttons.length === 0) return;
    const next = (index + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(indexOf(document.activeElement) + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(indexOf(document.activeElement) - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(buttons.length - 1);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close();
  };

  function close(): void {
    if (openMenu?.element !== menu) return;
    openMenu = null;
    menu.remove();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("resize", close);
    focusBefore?.focus?.();
  }

  openMenu = { element: menu, close };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("resize", close);

  queueMicrotask(() => focusAt(0));
}
