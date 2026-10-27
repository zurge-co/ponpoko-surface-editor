import { createIcon, type IconName } from "../icons";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className.length > 0) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function actionButton(icon: IconName, label: string, title: string): HTMLButtonElement {
  const button = el("button", "action");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", label);
  const text = el("span", "action-label", label);
  button.append(createIcon(icon, 14), text);
  return button;
}

export function primaryButton(label: string): HTMLButtonElement {
  const button = el("button", "welcome-button primary", label);
  button.type = "button";
  return button;
}
