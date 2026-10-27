import { dirName } from "../../files";
import { resolveReference, dataUrl, highlightCodeElement, fenceLanguage, loadMarkdownEngine } from "./kinds";
import type { AssetSource } from "./kinds";

export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface MarkdownRender {
  html: string;
  images: number;
  missing: string[];
  remote: string[];
}

export async function renderMarkdown(
  path: string,
  markdown: string,
  assets: AssetSource,
): Promise<MarkdownRender> {
  const engine = await loadMarkdownEngine();
  const sanitized = engine.sanitize(engine.render(markdown));
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  const base = dirName(path);
  const missing: string[] = [];
  const remote: string[] = [];
  let images = 0;

  for (const image of [...template.content.querySelectorAll("img")]) {
    const source = image.getAttribute("src") ?? "";
    const reference = resolveReference(base, source);
    if (reference.kind === "local") {
      try {
        const asset = await assets.readAsset(reference.path);
        image.setAttribute("src", dataUrl(asset));
        images += 1;
      } catch {
        missing.push(source);
        image.removeAttribute("src");
        image.setAttribute("data-missing", "true");
        image.setAttribute("alt", `missing image: ${source}`);
      }
    } else if (reference.kind === "remote") {
      remote.push(source);
      image.removeAttribute("src");
      image.setAttribute("data-remote", "true");
      image.setAttribute("alt", `image not loaded from ${source}`);
    } else if (reference.kind === "data") {
      images += 1;
    } else if (reference.kind === "empty") {
      image.remove();
    }
  }

  for (const anchor of [...template.content.querySelectorAll("a")]) {
    const href = anchor.getAttribute("href") ?? "";
    const reference = resolveReference(base, href);
    if (reference.kind === "remote" || reference.kind === "data") {
      remote.push(href);
      anchor.removeAttribute("href");
      anchor.setAttribute("data-external", "true");
      anchor.className = `${anchor.className} preview-external`.trim();
      anchor.title = `${href} — this editor does not open web links`;
      continue;
    }
    if (reference.kind === "local") {
      anchor.setAttribute("data-open-path", reference.path);
      anchor.removeAttribute("href");
      anchor.className = `${anchor.className} preview-link`.trim();
      anchor.title = `Open ${reference.path} in the editor`;
      continue;
    }
    if (reference.kind === "anchor") {
      anchor.setAttribute("data-anchor", reference.id);
      anchor.removeAttribute("href");
    }
  }

  const used = new Set<string>();
  for (const heading of [...template.content.querySelectorAll("h1, h2, h3, h4, h5, h6")]) {
    const base = headingSlug(heading.textContent ?? "");
    if (base.length === 0) continue;
    let id = base;
    let count = 1;
    while (used.has(id)) {
      count += 1;
      id = `${base}-${count}`;
    }
    used.add(id);
    heading.id = id;
  }

  for (const code of [...template.content.querySelectorAll("pre > code")]) {
    const element = code as HTMLElement;
    const language = fenceLanguage(element);
    if (language !== null) highlightCodeElement(element, language);
  }

  for (const table of [...template.content.querySelectorAll("table")]) {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-table";
    table.replaceWith(wrapper);
    wrapper.append(table);
  }

  return { html: template.innerHTML, images, missing, remote };
}
