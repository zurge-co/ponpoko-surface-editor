import type { SurfaceLink } from "../../bridge";
import type { SurfaceEditor } from "../../editor";
import { applyPaletteTokens } from "../../palette";
import type { PersistedSession } from "../../session";
import type { TabModel } from "../../tabs";
import type { AppState } from "./state";

export interface LifecycleHost {
  state: AppState;
  tabs: TabModel;
  editor: SurfaceEditor;
  persistNow(): void;
  cancelPersist(): void;
  render(): void;
  showError(message: string): void;
}

export function installLifecycle(host: LifecycleHost): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    host.cancelPersist();
    host.persistNow();
    if (host.tabs.dirtyTabs().length === 0) return;
    event.preventDefault();
    event.returnValue = "Some files have unsaved changes.";
  };
  const onPageHide = () => {
    host.cancelPersist();
    host.persistNow();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") host.persistNow();
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export async function restoreSession(host: LifecycleHost, persisted: PersistedSession): Promise<void> {
  try {
    if (host.state.settings.restoreSession && persisted.tabs.length > 0) {
      await host.state.documents?.restore(persisted.tabs, persisted.activePath);
    }
  } catch (failure) {
    host.showError(
      `The last session could not be restored: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
  host.render();
  if (host.tabs.list().length > 0) host.editor.focus();
}

export function wireLink(link: SurfaceLink, showError: (message: string) => void): void {
  link.onHello((doors) => {
    if (doors.includes("backend.call")) return;
    showError(
      "The host answered without its backend door, so this surface cannot read or write files. Reinstall it from the Surfaces window.",
    );
  });

  link.onPalette((tokens) => {
    applyPaletteTokens(document.documentElement, tokens);
  });
}
