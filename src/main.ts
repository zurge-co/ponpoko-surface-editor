import "./styles.css";

import { createSurfaceLink, parentTransport, viewTokenFromLocation } from "./bridge";
import { browserStorage } from "./session";
import { createEditorApp } from "./ui/app";
import { createIcon } from "./ui/icons";

function renderUnhosted(root: HTMLElement): void {
  const shell = document.createElement("div");
  shell.className = "unhosted";

  const mark = document.createElement("div");
  mark.className = "unhosted-mark";
  mark.append(createIcon("file-code", 28));

  const heading = document.createElement("h1");
  heading.textContent = "Editor — a Ponpoko surface";

  const body = document.createElement("p");
  body.textContent =
    "Ponpoko loads this page inside its own window and supplies the file dialogs and the backend process that reads and writes files. Its files are installed on this machine; this document is served by Ponpoko, not by a web server.";

  const detail = document.createElement("p");
  detail.textContent =
    "Opened on its own there is no host to talk to, so the editor would have no way to open a file — nothing here would be true.";

  shell.append(mark, heading, body, detail);
  root.replaceChildren(shell);
}

function main(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("the editor surface has no #app element to mount into");

  const view = viewTokenFromLocation();
  if (view.length === 0) {
    renderUnhosted(root);
    return;
  }

  const link = createSurfaceLink({ view, transport: parentTransport() });
  createEditorApp({ root, link, storage: browserStorage() });

  link.announceReady();
}

main();
