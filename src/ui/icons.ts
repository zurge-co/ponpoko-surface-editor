export type IconName =
  | "file"
  | "file-code"
  | "file-text"
  | "file-image"
  | "file-markdown"
  | "close"
  | "folder"
  | "folder-open"
  | "save"
  | "settings"
  | "wrap"
  | "search"
  | "chevron-right"
  | "chevron-down"
  | "plus"
  | "trash"
  | "pencil"
  | "reveal"
  | "preview"
  | "arrow-left"
  | "arrow-right"
  | "command"
  | "warning"
  | "check"
  | "symbols"
  | "refresh"
  | "hidden"
  | "copy"
  | "symbol-class"
  | "symbol-function"
  | "symbol-variable"
  | "symbol-key"
  | "symbol-heading";

const PATHS: Record<IconName, readonly string[]> = {
  file: ["M4 1.75h5l3 3v9.5H4z", "M9 1.75v3h3"],
  "file-code": ["M4 1.75h5l3 3v9.5H4z", "M9 1.75v3h3", "M6.5 8.5 5 10l1.5 1.5", "M9.5 8.5 11 10l-1.5 1.5"],
  "file-text": ["M4 1.75h5l3 3v9.5H4z", "M9 1.75v3h3", "M6 8h4", "M6 10.5h4"],
  "file-image": ["M4 1.75h5l3 3v9.5H4z", "M9 1.75v3h3", "M6 11.5l1.8-1.8 1.2 1.2 1-1 1 1.6", "M8.6 8.2a.6.6 0 1 1-1.2 0 .6.6 0 0 1 1.2 0z"],
  "file-markdown": ["M2 4.5h12v7H2z", "M4 9.5V6.5l1.6 2 1.6-2v3", "M10.4 6.5v2.4", "M9.4 8l1 1.5L11.4 8"],
  close: ["M4 4l8 8", "M12 4l-8 8"],
  folder: ["M1.75 4.5h4l1.2 1.5h7.3v7.5H1.75z"],
  "folder-open": ["M1.75 4.5h4l1.2 1.5h6.3v2", "M1.75 13.5l.9-5.5h11.6l-1 5.5z"],
  save: ["M2.5 2.5h8.5l2.5 2.5v8.5h-11z", "M5 2.5v4h5v-4", "M5 13.5v-4h6v4"],
  settings: [
    "M8 5.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z",
    "M13.2 9.4a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 1 1-1.7 1.7l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9v.3a1.2 1.2 0 0 1-2.4 0v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1.2 1.2 0 1 1-1.7-1.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6h-.3a1.2 1.2 0 0 1 0-2.4h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a1.2 1.2 0 1 1 1.7-1.7l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9v-.3a1.2 1.2 0 0 1 2.4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.2 1.2 0 1 1 1.7 1.7l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6h.3a1.2 1.2 0 0 1 0 2.4h-.2a1 1 0 0 0-.9.6z",
  ],
  wrap: ["M2 4h12", "M2 8h8.5a2 2 0 1 1 0 4H8", "M9.5 10.5 8 12l1.5 1.5", "M2 12h3"],
  search: ["M7.2 2.5a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4z", "M10.6 10.6l2.9 2.9"],
  "chevron-right": ["M6 3.5 10.5 8 6 12.5"],
  "chevron-down": ["M3.5 6 8 10.5 12.5 6"],
  plus: ["M8 3v10", "M3 8h10"],
  trash: ["M2.5 4.5h11", "M6 4.5V3h4v1.5", "M4 4.5l.7 9h6.6l.7-9", "M6.6 7v4", "M9.4 7v4"],
  pencil: ["M11.2 2.8l2 2L6 12H4v-2z", "M9.8 4.2l2 2"],
  reveal: ["M1.75 4.5h4l1.2 1.5h7.3v7.5H1.75z", "M8 8v4", "M6.5 10.5 8 12l1.5-1.5"],
  preview: ["M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z", "M8 6.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"],
  "arrow-left": ["M13 8H3", "M6.5 4.5 3 8l3.5 3.5"],
  "arrow-right": ["M3 8h10", "M9.5 4.5 13 8l-3.5 3.5"],
  command: ["M6 2.5a1.5 1.5 0 1 1 2 1.5v8a1.5 1.5 0 1 1-2-1.5h4a1.5 1.5 0 1 1 2 1.5V4a1.5 1.5 0 1 1-2-1.5z"],
  warning: ["M8 2.5 14 13H2z", "M8 6.5v3", "M8 11.2v.1"],
  check: ["M3 8.5 6.5 12 13 4.5"],
  symbols: ["M2.5 3.6h1.6", "M2.5 8h1.6", "M2.5 12.4h1.6", "M6 3.6h7.5", "M6 8h7.5", "M6 12.4h7.5"],
  "symbol-class": ["M3 5.5 8 2.75l5 2.75v5L8 13.25 3 10.5z", "M3 5.5 8 8.25l5-2.75", "M8 8.25v5"],
  "symbol-function": ["M4.5 12c1.7 0 2-1.5 2.3-3.7.3-2.3.6-3.8 2.2-3.8", "M4.8 7.4h3.9"],
  "symbol-variable": ["M8 4.1a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8z"],
  "symbol-key": ["M9.6 6.4 13.4 2.6", "M11.8 2.2l2 2", "M6.6 4.9a2.7 2.7 0 1 1 0 3.8 2.7 2.7 0 0 1 0-3.8z"],
  "symbol-heading": ["M4 3.2v9.6", "M12 3.2v9.6", "M4 8h8"],
  refresh: ["M12.9 8a4.9 4.9 0 1 1-1.6-3.6", "M13.1 2.4v3h-3"],
  hidden: ["M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z", "M3 13 13 3"],
  copy: ["M5.5 5.5h7v7h-7z", "M3 10.5h-1v-7h7v1"],
};

export function createIcon(name: IconName, size = 16): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const path of PATHS[name]) {
    const node = document.createElementNS(namespace, "path");
    node.setAttribute("d", path);
    svg.append(node);
  }
  return svg;
}
