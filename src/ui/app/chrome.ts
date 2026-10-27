import { baseName, dirName, shortenPath } from "../../files";
import { keyLabel, type Platform } from "../../keymap";
import type { Tab } from "../../tabs";
import { canPreview } from "../preview";
import { createIcon } from "../icons";
import { actionButton, el, primaryButton } from "./dom";

export interface ChromeButtons {
  openFolder: HTMLButtonElement;
  openFile: HTMLButtonElement;
  goToFile: HTMLButtonElement;
  preview: HTMLButtonElement;
  saveAll: HTMLButtonElement;
  settings: HTMLButtonElement;
  welcomeFolder: HTMLButtonElement;
  welcomeFile: HTMLButtonElement;
}

export interface Chrome {
  workbench: HTMLDivElement;
  body: HTMLDivElement;
  main: HTMLDivElement;
  editorHost: HTMLDivElement;
  tabstripHost: HTMLDivElement;
  statusHost: HTMLDivElement;
  workspaceName: HTMLSpanElement;
  workspacePath: HTMLSpanElement;
  welcome: HTMLElement;
  welcomeRecent: HTMLDivElement;
  banner: HTMLDivElement;
  bannerText: HTMLSpanElement;
  bannerDismiss: HTMLButtonElement;
  buttons: ChromeButtons;
}

export interface TitleModel {
  workspace: string | null;
  tab: Tab | null;
  dirtyCount: number;
  previewOpen: boolean;
}

export function createChrome(root: HTMLElement, platform: Platform): Chrome {
  const workbench = el("div", "workbench");

  const titlebar = el("header", "titlebar");
  const identity = el("div", "identity");
  identity.append(el("span", "identity-mark"), el("span", "identity-name", "Editor"));
  const workspaceBlock = el("div", "workspace");
  const workspaceName = el("span", "workspace-name", "No folder open");
  const workspacePath = el("span", "workspace-path");
  workspaceBlock.append(workspaceName, workspacePath);
  titlebar.append(identity, workspaceBlock, el("div", "titlebar-spacer"));

  const titlebarActions = el("div", "titlebar-actions");
  const openFolderButton = actionButton(
    "folder-open",
    "Open Folder",
    `Open a folder (${keyLabel("Mod-Alt-o", platform)})`,
  );
  const openFileButton = actionButton("file", "Open File", `Open a file (${keyLabel("Mod-o", platform)})`);
  const goToFileButton = actionButton(
    "search",
    "Go to File",
    `Open a file by name (${keyLabel("Mod-p", platform)})`,
  );
  const previewButton = actionButton(
    "preview",
    "Preview",
    `Preview this file (${keyLabel("Mod-Shift-v", platform)})`,
  );
  previewButton.disabled = true;
  const saveAllButton = actionButton("save", "Save All", `Save every changed file (${keyLabel("Mod-Alt-s", platform)})`);
  const settingsButton = actionButton("settings", "Settings", `Settings (${keyLabel("Mod-Comma", platform)})`);
  titlebarActions.append(
    previewButton,
    goToFileButton,
    openFolderButton,
    openFileButton,
    saveAllButton,
    settingsButton,
  );
  titlebar.append(titlebarActions);

  const tabstripHost = el("div", "tabstrip-host");
  const body = el("div", "workbench-body");
  const main = el("div", "main");
  body.append(main);
  const editorHost = el("div", "editor");
  editorHost.id = "editor-region";
  editorHost.setAttribute("role", "region");
  editorHost.setAttribute("aria-label", "Editor");

  const welcome = el("section", "welcome");
  welcome.setAttribute("aria-label", "Welcome to the Editor");
  const welcomeInner = el("div", "welcome-inner");
  const welcomeMark = el("div", "welcome-mark");
  welcomeMark.append(createIcon("file-code", 30));
  const welcomeTitle = el("h1", "welcome-title", "Write code in the files on this machine");
  const welcomeLead = el(
    "p",
    "welcome-lead",
    "Open a folder to work in it, or open a file directly. Files are read and written by this surface's own process — nothing is uploaded and there is no account.",
  );
  const openFolderWelcome = primaryButton("Open Folder…");
  const openFileWelcome = el("button", "welcome-button", "Open File…");
  openFileWelcome.type = "button";
  const welcomeButtons = el("div", "welcome-buttons");
  welcomeButtons.append(openFolderWelcome, openFileWelcome);
  const recentBlock = el("div", "welcome-recent");
  const shortcuts = el("p", "welcome-shortcuts");
  shortcuts.textContent = `Quick keys: ${keyLabel("Mod-p", platform)} go to file · ${keyLabel("Mod-Shift-p", platform)} commands · ${keyLabel("Mod-o", platform)} open · ${keyLabel("Mod-s", platform)} save · ${keyLabel("Mod-w", platform)} close tab · ${keyLabel("Mod-b", platform)} sidebar · ${keyLabel("Mod-f", platform)} find in file · F12 go to definition`;
  welcomeInner.append(welcomeMark, welcomeTitle, welcomeLead, welcomeButtons, recentBlock, shortcuts);
  welcome.append(welcomeInner);

  main.append(editorHost, welcome);

  const banner = el("div", "banner");
  banner.hidden = true;
  banner.setAttribute("role", "alert");
  const bannerText = el("span", "banner-text");
  const bannerDismiss = el("button", "banner-dismiss", "Dismiss");
  bannerDismiss.type = "button";
  bannerDismiss.setAttribute("aria-label", "Dismiss this message");
  banner.append(createIcon("warning", 14), bannerText, bannerDismiss);

  const statusHost = el("div", "statusbar-host");
  workbench.append(titlebar, tabstripHost, body, banner, statusHost);
  root.replaceChildren(workbench);

  return {
    workbench,
    body,
    main,
    editorHost,
    tabstripHost,
    statusHost,
    workspaceName,
    workspacePath,
    welcome,
    welcomeRecent: recentBlock,
    banner,
    bannerText,
    bannerDismiss,
    buttons: {
      openFolder: openFolderButton,
      openFile: openFileButton,
      goToFile: goToFileButton,
      preview: previewButton,
      saveAll: saveAllButton,
      settings: settingsButton,
      welcomeFolder: openFolderWelcome,
      welcomeFile: openFileWelcome,
    },
  };
}

export function renderTitle(chrome: Chrome, model: TitleModel, platform: Platform): void {
  const { workspace, tab } = model;
  if (workspace === null) {
    chrome.workspaceName.textContent = "No folder open";
    chrome.workspacePath.textContent = tab ? dirName(tab.path) : "";
  } else {
    chrome.workspaceName.textContent = baseName(workspace);
    chrome.workspacePath.textContent = shortenPath(workspace, 72);
  }
  chrome.workspacePath.title = workspace ?? (tab ? tab.path : "");
  const saveAll = chrome.buttons.saveAll;
  saveAll.disabled = model.dirtyCount === 0;
  saveAll.title =
    model.dirtyCount === 0
      ? "Every open file is saved"
      : `Save ${model.dirtyCount} changed ${model.dirtyCount === 1 ? "file" : "files"} (${keyLabel("Mod-Alt-s", platform)})`;
  chrome.workspaceName.title = tab ? `${tab.name} — ${tab.path}` : (workspace ?? "No folder open");
  const previewButton = chrome.buttons.preview;
  const previewable = canPreview(tab?.path ?? null);
  previewButton.hidden = !previewable;
  previewButton.disabled = !previewable;
  previewButton.setAttribute("aria-pressed", String(model.previewOpen));
  previewButton.title = tab === null ? "" : `Preview ${tab.name} (${keyLabel("Mod-Shift-v", platform)})`;
}
