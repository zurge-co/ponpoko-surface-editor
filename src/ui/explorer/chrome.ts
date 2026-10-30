import { createIcon, type IconName } from "../icons";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function iconButton(icon: IconName, label: string): HTMLButtonElement {
  const button = el("button", "icon-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(icon, 14));
  return button;
}
