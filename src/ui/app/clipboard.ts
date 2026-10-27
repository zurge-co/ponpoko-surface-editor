import type { EditorApi } from "../../api";
import { baseName } from "../../files";

export interface NotifyHost {
  showNote(message: string): void;
  showError(message: string): void;
}

export async function copyText(host: NotifyHost, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    host.showNote("copied the path");
    return;
  } catch {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("aria-hidden", "true");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.append(scratch);
    scratch.select();
    const copied = document.execCommand("copy");
    scratch.remove();
    if (copied) {
      host.showNote("copied the path");
      return;
    }
    host.showError(`Could not copy to the clipboard. The path is: ${text}`);
  }
}

export async function revealPath(host: NotifyHost & { api: EditorApi }, path: string): Promise<void> {
  try {
    await host.api.reveal(path);
    host.showNote(`revealed ${baseName(path)}`);
  } catch (failure) {
    host.showError(`Could not reveal ${baseName(path)}: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
}
