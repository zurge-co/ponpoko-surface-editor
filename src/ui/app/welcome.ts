import { baseName, dirName, shortenPath } from "../../files";
import { createIcon } from "../icons";
import { el } from "./dom";

export interface WelcomeModel {
  tabCount: number;
  recentFolders: readonly string[];
  recentFiles: readonly string[];
}

export interface WelcomeHandlers {
  openFolder(folder: string): void;
  openFile(path: string): void;
}

export interface WelcomeView {
  section: HTMLElement;
  editorHost: HTMLElement;
  recent: HTMLElement;
}

export function renderWelcome(view: WelcomeView, model: WelcomeModel, handlers: WelcomeHandlers): void {
  const hasTab = model.tabCount > 0;
  view.section.hidden = hasTab;
  view.editorHost.hidden = !hasTab;
  if (hasTab) return;

  view.recent.replaceChildren();
  const sections: HTMLElement[] = [];
  if (model.recentFolders.length > 0) {
    const heading = el("h2", "welcome-recent-title", "Recent folders");
    const list = el("ul", "welcome-recent-list");
    for (const folder of model.recentFolders.slice(0, 5)) {
      const item = el("li", "");
      const button = el("button", "recent-item");
      button.type = "button";
      button.title = folder;
      button.append(createIcon("folder", 13), el("span", "recent-name", baseName(folder)));
      button.addEventListener("click", () => handlers.openFolder(folder));
      item.append(button);
      list.append(item);
    }
    sections.push(heading, list);
  }
  if (model.recentFiles.length > 0) {
    const heading = el("h2", "welcome-recent-title", "Recent files");
    const list = el("ul", "welcome-recent-list");
    for (const file of model.recentFiles.slice(0, 5)) {
      const item = el("li", "");
      const button = el("button", "recent-item");
      button.type = "button";
      button.title = file;
      button.append(
        createIcon("file-text", 13),
        el("span", "recent-name", baseName(file)),
        el("span", "recent-path", shortenPath(dirName(file), 48)),
      );
      button.addEventListener("click", () => handlers.openFile(file));
      item.append(button);
      list.append(item);
    }
    sections.push(heading, list);
  }
  view.recent.append(...sections);
}
