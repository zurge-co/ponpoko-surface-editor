import type { AssetAnswer, ReadAnswer } from "../../api";
import { dirName } from "../../files";
import { resolveReference, dataUrl, previewPolicy } from "./kinds";
import type { PreviewKind, AssetSource } from "./kinds";

export interface HtmlRender {
  html: string;
  styles: number;
  images: number;
  skipped: string[];
}

export async function renderHtmlDocument(
  path: string,
  html: string,
  assets: AssetSource,
): Promise<HtmlRender> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = dirName(path);
  const skipped: string[] = [];
  let styles = 0;
  let images = 0;

  for (const element of [...doc.querySelectorAll("script, iframe, frame, frameset, object, embed, base")]) {
    skipped.push(`<${element.tagName.toLowerCase()}>`);
    element.remove();
  }

  for (const element of [...doc.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      const dangerous = name === "href" ? /^\s*(javascript|data):/i : /^\s*javascript:/i;
      if ((name === "href" || name === "src") && dangerous.test(attribute.value)) {
        element.removeAttribute(attribute.name);
        skipped.push(`blocked ${name}: ${element.tagName.toLowerCase()}`);
      }
    }
  }

  const inlineStyle = async (link: Element): Promise<void> => {
    const href = link.getAttribute("href") ?? "";
    const reference = resolveReference(base, href);
    if (reference.kind !== "local") {
      skipped.push(`stylesheet ${href}`);
      link.remove();
      return;
    }
    try {
      const answer = await assets.read(reference.path);
      const style = doc.createElement("style");
      style.textContent = answer.content;
      link.replaceWith(style);
      styles += 1;
    } catch {
      skipped.push(`stylesheet ${href}`);
      link.remove();
    }
  };
  const links = [...doc.querySelectorAll('link[rel~="stylesheet"][href]')];
  for (const link of links) await inlineStyle(link);

  const inlineImage = async (element: Element, attribute: string): Promise<void> => {
    const source = element.getAttribute(attribute) ?? "";
    const reference = resolveReference(base, source);
    if (reference.kind === "data") {
      images += 1;
      return;
    }
    if (reference.kind !== "local") {
      if (reference.kind === "remote") skipped.push(`image ${source}`);
      element.removeAttribute(attribute);
      return;
    }
    try {
      const asset = await assets.readAsset(reference.path);
      element.setAttribute(attribute, dataUrl(asset));
      images += 1;
    } catch {
      skipped.push(`image ${source}`);
      element.removeAttribute(attribute);
    }
  };
  for (const image of [...doc.querySelectorAll("img[src]")]) await inlineImage(image, "src");
  for (const source of [...doc.querySelectorAll("source[src]")]) await inlineImage(source, "src");

  const head = doc.head ?? doc.documentElement;
  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", previewPolicy());
  head.prepend(policy);

  return {
    html: `<!doctype html>${doc.documentElement.outerHTML}`,
    styles,
    images,
    skipped,
  };
}


export interface PreviewTab {
  path: string;
  text: string;
  dirty: boolean;
}

export interface PreviewDeps {
  readAsset(path: string): Promise<AssetAnswer>;
  read(path: string): Promise<ReadAnswer>;
  openFile(path: string): void;
  onError(message: string): void;
  onNote(message: string): void;
}

export interface Preview {
  readonly element: HTMLElement;
  update(tab: PreviewTab | null): void;
  schedule(): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  kind(): PreviewKind | null;
  refresh(): void;
  destroy(): void;
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className.length > 0) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
