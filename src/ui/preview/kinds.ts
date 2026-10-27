import type { Language } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { StyleModule } from "style-mod";
import type { AssetAnswer, ReadAnswer } from "../../api";
import { baseName, joinPath } from "../../files";
import { languageExtension, languageFor, type LanguageId } from "../../languages";
import { ponpokoHighlight } from "../../theme";

export type PreviewKind = "markdown" | "image" | "html";

export const IMAGE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
];

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mdx"];
export const HTML_EXTENSIONS = ["html", "htm"];

export function extensionOf(path: string): string {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

export function previewKindFor(path: string): PreviewKind | null {
  const extension = extensionOf(path);
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  if (MARKDOWN_EXTENSIONS.includes(extension)) return "markdown";
  if (HTML_EXTENSIONS.includes(extension)) return "html";
  return null;
}

export type ReferenceKind =
  | { kind: "local"; path: string }
  | { kind: "anchor"; id: string }
  | { kind: "data"; url: string }
  | { kind: "remote"; url: string }
  | { kind: "empty" };

export const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
export const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

export function resolveReference(baseDir: string, reference: string): ReferenceKind {
  const trimmed = reference.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (trimmed.startsWith("#")) return { kind: "anchor", id: trimmed.slice(1) };
  if (/^data:/i.test(trimmed)) return { kind: "data", url: trimmed };
  if (!WINDOWS_DRIVE.test(trimmed) && (SCHEME.test(trimmed) || trimmed.startsWith("//"))) {
    return { kind: "remote", url: trimmed };
  }

  const withoutSuffix = trimmed.split(/[?#]/)[0] ?? "";
  let decoded = withoutSuffix;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
  }
  if (decoded.length === 0) return { kind: "empty" };
  if (decoded.startsWith("/") || WINDOWS_DRIVE.test(decoded)) return { kind: "local", path: decoded };
  return { kind: "local", path: normalizeRelative(joinPath(baseDir, decoded)) };
}

export function normalizeRelative(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

export function dataUrl(asset: Pick<AssetAnswer, "mime" | "base64">): string {
  return `data:${asset.mime};base64,${asset.base64}`;
}

export const FENCE_ALIASES: Record<string, LanguageId> = {
  rust: "rust",
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  golang: "go",
  markdown: "markdown",
  shell: "shell",
  bash: "shell",
  zsh: "shell",
  sh: "shell",
  console: "shell",
  "c++": "cpp",
  cxx: "cpp",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  ini: "properties",
  properties: "properties",
  plaintext: "text",
  txt: "text",
  text: "text",
  jsonc: "jsonc",
  json5: "jsonc",
  mdx: "mdx",
};

export function languageFromFence(name: string): LanguageId | null {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const alias = FENCE_ALIASES[normalized];
  if (alias !== undefined) return alias;
  const inferred = languageFor(`fence.${normalized}`);
  return inferred === "text" ? null : inferred;
}

export const HTML_PREVIEW_SANDBOX = "";

export function previewPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "media-src data:",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}


export let highlightMounted = false;

export function mountHighlight(): void {
  if (highlightMounted) return;
  try {
    if (ponpokoHighlight.module !== null) StyleModule.mount(document, ponpokoHighlight.module);
  } catch {
  }
  highlightMounted = true;
}

export function parserFor(language: LanguageId): Language["parser"] | null {
  const extension = languageExtension(language);
  const list = Array.isArray(extension) ? extension : [extension];
  for (const item of list) {
    const candidate = item as {
      language?: { parser?: Language["parser"] };
      parser?: Language["parser"];
    };
    const parser = candidate.language?.parser ?? candidate.parser;
    if (parser !== undefined && typeof parser.parse === "function") return parser;
  }
  return null;
}

export function highlightCodeElement(element: HTMLElement, language: LanguageId): boolean {
  const parser = parserFor(language);
  if (parser === null) return false;
  const source = element.textContent ?? "";
  if (source.length === 0 || source.length > 400_000) return false;
  let tree: ReturnType<Language["parser"]["parse"]>;
  try {
    tree = parser.parse(source);
  } catch {
    return false;
  }
  mountHighlight();

  const fragment = document.createDocumentFragment();
  let last = 0;
  highlightTree(tree, ponpokoHighlight, (from, to, classes) => {
    if (from > last) fragment.append(document.createTextNode(source.slice(last, from)));
    const span = document.createElement("span");
    span.className = classes;
    span.textContent = source.slice(from, to);
    fragment.append(span);
    last = to;
  });
  fragment.append(document.createTextNode(source.slice(last)));
  element.replaceChildren(fragment);
  element.classList.add("preview-code");
  return true;
}

export function fenceLanguage(code: HTMLElement): LanguageId | null {
  const className = code.className;
  const match = /(?:^|\s)language-([\w+#.-]+)/.exec(className);
  return match?.[1] === undefined ? null : languageFromFence(match[1]);
}


export interface AssetSource {
  readAsset(path: string): Promise<AssetAnswer>;
  read(path: string): Promise<ReadAnswer>;
}

export const SANITIZE = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base", "form"],
  FORBID_ATTR: ["srcdoc", "formaction", "http-equiv"],
  ALLOW_DATA_ATTR: true,
};

export interface MarkdownEngine {
  render(markdown: string): string;
  sanitize(html: string): string;
}

export let markdownEngine: Promise<MarkdownEngine> | null = null;

export function loadMarkdownEngine(): Promise<MarkdownEngine> {
  if (markdownEngine !== null) return markdownEngine;
  markdownEngine = (async () => {
    const [markedModule, purifyModule] = await Promise.all([import("marked"), import("dompurify")]);
    const purifier = purifyModule.default as unknown as {
      sanitize(source: string, options?: Record<string, unknown>): string;
    };
    return {
      render(markdown) {
        const rendered = markedModule.marked.parse(markdown, { async: false, gfm: true });
        return typeof rendered === "string" ? rendered : "";
      },
      sanitize(html) {
        return purifier.sanitize(html, SANITIZE as Record<string, unknown>);
      },
    };
  })();
  return markdownEngine;
}
