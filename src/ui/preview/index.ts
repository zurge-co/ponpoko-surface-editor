import { baseName, formatBytes } from "../../files";
import { createIcon } from "../icons";
import { IMAGE_EXTENSIONS, previewKindFor, dataUrl, HTML_PREVIEW_SANDBOX } from "./kinds";
import type { PreviewKind } from "./kinds";
import { renderMarkdown } from "./markdown";
import { renderHtmlDocument, element, messageOf } from "./html";
import type { PreviewTab, PreviewDeps, Preview } from "./html";

export function createPreview(deps: PreviewDeps): Preview {
  const root = element("aside", "preview");
  root.setAttribute("aria-label", "Preview");
  root.hidden = true;

  const header = element("div", "preview-header");
  const titleBlock = element("div", "preview-title-block");
  const title = element("span", "preview-title");
  const badge = element("span", "preview-badge");
  titleBlock.append(title, badge);
  const actions = element("div", "preview-actions");
  const zoomOut = element("button", "icon-button", "−");
  zoomOut.type = "button";
  zoomOut.title = "Zoom out";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const zoomLabel = element("span", "preview-zoom");
  const zoomIn = element("button", "icon-button", "+");
  zoomIn.type = "button";
  zoomIn.title = "Zoom in";
  zoomIn.setAttribute("aria-label", "Zoom in");
  const zoomFit = element("button", "icon-button", "Fit");
  zoomFit.type = "button";
  zoomFit.title = "Fit the image to the pane";
  zoomFit.setAttribute("aria-label", "Fit the image to the pane");
  const closeButton = element("button", "icon-button preview-close");
  closeButton.type = "button";
  closeButton.title = "Close the preview";
  closeButton.setAttribute("aria-label", "Close the preview");
  closeButton.append(createIcon("close", 12));
  actions.append(zoomOut, zoomLabel, zoomIn, zoomFit, closeButton);
  header.append(titleBlock, actions);

  const body = element("div", "preview-body");
  const footer = element("div", "preview-footer");
  root.append(header, body, footer);

  let wanted = false;
  let tab: PreviewTab | null = null;
  let current: PreviewKind | null = null;
  let imagePath: string | null = null;
  let zoom: number | "fit" = "fit";
  let renderedText: string | null = null;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let imageElement: HTMLImageElement | null = null;
  let imageInfo = "";

  const kindOf = (next: PreviewTab | null): PreviewKind | null => (next === null ? null : previewKindFor(next.path));

  function setZoom(next: number | "fit"): void {
    zoom = next;
    applyZoom();
  }

  function applyZoom(): void {
    const image = imageElement;
    if (image === null) return;
    if (zoom === "fit") {
      image.style.maxWidth = "100%";
      image.style.width = "auto";
      zoomLabel.textContent = "Fit";
      return;
    }
    image.style.maxWidth = "none";
    image.style.width = `${Math.round((image.naturalWidth || 0) * zoom)}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function showImageControls(visible: boolean): void {
    for (const control of [zoomOut, zoomIn, zoomFit]) control.hidden = !visible;
    zoomLabel.hidden = !visible;
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function showPlaceholder(message: string): void {
    body.replaceChildren(element("p", "preview-state", message));
    footer.textContent = "";
  }

  function updateChrome(kind: PreviewKind | null): void {
    if (tab === null || kind === null) return;
    title.textContent = baseName(tab.path);
    title.title = tab.path;
    badge.textContent = tab.dirty ? "unsaved buffer" : "";
    badge.hidden = !tab.dirty;
    showImageControls(kind === "image");
  }

  async function renderMarkdownTab(next: PreviewTab, token: number): Promise<void> {
    const result = await renderMarkdown(next.path, next.text, deps);
    if (token !== sequence) return;
    const article = element("article", "preview-markdown");
    article.innerHTML = result.html;
    body.replaceChildren(article);
    const facts: string[] = [`${Math.max(0, next.text.split("\n").length - 1)} lines`];
    if (result.images > 0) facts.push(`${result.images} ${result.images === 1 ? "image" : "images"}`);
    if (result.missing.length > 0) facts.push(`${result.missing.length} missing`);
    if (result.remote.length > 0) facts.push(`${result.remote.length} remote not loaded`);
    footer.textContent = facts.join(" · ");
  }

  async function renderHtmlTab(next: PreviewTab, token: number): Promise<void> {
    const result = await renderHtmlDocument(next.path, next.text, deps);
    if (token !== sequence) return;
    const frame = document.createElement("iframe");
    frame.className = "preview-frame";
    frame.setAttribute("sandbox", HTML_PREVIEW_SANDBOX);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.title = `${baseName(next.path)} preview`;
    frame.srcdoc = result.html;
    body.replaceChildren(frame);
    const facts = ["scripts disabled", "no network"];
    if (result.styles > 0) facts.push(`${result.styles} stylesheet${result.styles === 1 ? "" : "s"} inlined`);
    if (result.images > 0) facts.push(`${result.images} image${result.images === 1 ? "" : "s"} inlined`);
    if (result.skipped.length > 0) facts.push(`${result.skipped.length} item${result.skipped.length === 1 ? "" : "s"} skipped`);
    footer.textContent = facts.join(" · ");
    footer.title = result.skipped.join("\n");
  }

  async function renderImageTab(next: PreviewTab, token: number): Promise<void> {
    const asset = await deps.readAsset(next.path);
    if (token !== sequence) return;
    const image = document.createElement("img");
    image.className = "preview-image";
    image.alt = baseName(next.path);
    image.src = dataUrl(asset);
    image.addEventListener("load", () => {
      if (token !== sequence) return;
      imageInfo = `${asset.mime} · ${formatBytes(asset.bytes)} · ${image.naturalWidth}×${image.naturalHeight}`;
      footer.textContent = imageInfo;
      applyZoom();
    });
    image.addEventListener("error", () => {
      if (token !== sequence) return;
      showPlaceholder(`${baseName(next.path)} could not be drawn; the bytes are not a readable image.`);
    });
    imageElement = image;
    const stage = element("div", "preview-stage");
    stage.append(image);
    body.replaceChildren(stage);
    footer.textContent = `${asset.mime} · ${formatBytes(asset.bytes)}`;
  }

  async function renderNow(): Promise<void> {
    clearTimer();
    const next = tab;
    const kind = kindOf(next);
    current = kind;
    root.hidden = !wanted || next === null || kind === null;
    if (root.hidden || next === null || kind === null) {
      sequence += 1;
      body.replaceChildren();
      renderedText = null;
      imageElement = null;
      return;
    }
    const token = (sequence += 1);
    updateChrome(kind);
    const sameDocument = renderedText === next.text && imagePath === next.path;
    if (sameDocument) return;
    renderedText = next.text;
    imagePath = next.path;
    imageElement = null;
    if (kind === "image") setZoom("fit");
    try {
      if (kind === "markdown") await renderMarkdownTab(next, token);
      else if (kind === "html") await renderHtmlTab(next, token);
      else await renderImageTab(next, token);
    } catch (error) {
      if (token !== sequence) return;
      showPlaceholder(`This preview could not be drawn: ${messageOf(error)}`);
      deps.onError(`The preview of ${baseName(next.path)} could not be drawn: ${messageOf(error)}`);
    }
  }

  function schedule(): void {
    if (!wanted || tab === null || current === null) return;
    clearTimer();
    if (current === "image") return;
    timer = setTimeout(() => {
      timer = null;
      void renderNow();
    }, 400);
  }

  function followLink(target: EventTarget | null): boolean {
    const anchor = target instanceof Element ? target.closest("[data-open-path]") : null;
    if (!(anchor instanceof HTMLElement)) return false;
    const path = anchor.dataset.openPath;
    if (path === undefined || path.length === 0) return false;
    deps.openFile(path);
    return true;
  }

  const onBodyClick = (event: MouseEvent) => {
    if (followLink(event.target)) event.preventDefault();
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (anchor !== null) {
      event.preventDefault();
      const inPage = anchor.getAttribute("data-anchor");
      if (inPage !== null && inPage.length > 0) {
        const target = body.querySelector(`[id="${CSS.escape(inPage)}"]`);
        target?.scrollIntoView({ block: "start" });
        return;
      }
      const external = anchor.getAttribute("data-external") === "true";
      if (external) deps.onNote("This editor does not open web links; the address is in the link's tooltip.");
    }
  };
  body.addEventListener("click", onBodyClick);

  closeButton.addEventListener("click", () => {
    wanted = false;
    void renderNow();
  });
  zoomIn.addEventListener("click", () => {
    const base = zoom === "fit" ? 1 : zoom;
    setZoom(Math.min(4, base * 1.25));
    deps.onNote(`image at ${Math.round((zoom === "fit" ? 1 : zoom) * 100)}%`);
  });
  zoomOut.addEventListener("click", () => {
    const base = zoom === "fit" ? 1 : zoom;
    setZoom(Math.max(0.1, base / 1.25));
    deps.onNote(`image at ${Math.round((zoom === "fit" ? 1 : zoom) * 100)}%`);
  });
  zoomFit.addEventListener("click", () => setZoom("fit"));

  return {
    element: root,
    update(next) {
      const previousPath = tab?.path ?? null;
      const kindChanged = next === null || previewKindFor(next.path) !== current;
      tab = next;
      if (next === null) {
        void renderNow();
        return;
      }
      if (!wanted) return;
      if (next.path !== previousPath || kindChanged) {
        void renderNow();
        return;
      }
      updateChrome(current);
      if (next.text !== renderedText) schedule();
    },
    schedule,
    toggle() {
      if (tab === null || kindOf(tab) === null) {
        deps.onNote(
          tab === null
            ? "there is no open file to preview"
            : `${baseName(tab.path)} has no preview; Markdown, images and HTML can be previewed`,
        );
        return;
      }
      wanted = !wanted;
      void renderNow();
    },
    close() {
      if (!wanted) return;
      wanted = false;
      void renderNow();
    },
    isOpen: () => wanted && tab !== null && kindOf(tab) !== null,
    kind: () => current,
    refresh: () => {
      renderedText = null;
      void renderNow();
    },
    destroy() {
      clearTimer();
      sequence += 1;
      body.removeEventListener("click", onBodyClick);
      root.remove();
    },
  };
}

export function canPreview(path: string | null): boolean {
  return path !== null && previewKindFor(path) !== null;
}

export function noPreviewSentence(path: string | null): string {
  if (path === null) return "there is no open file to preview";
  return `${baseName(path)} has no preview; Markdown, HTML and ${IMAGE_EXTENSIONS.slice(0, 3).join("/")} images do.`;
}

export * from "./kinds";
export * from "./markdown";
export * from "./html";
