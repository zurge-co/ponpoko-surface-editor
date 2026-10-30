import type { EditorApi } from "../../api";
import { baseName } from "../../files";

export interface NotifyHost {
  showNote(message: string): void;
  showError(message: string): void;
}

export async function copyText(host: NotifyHost, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    host.showNote("copied to the clipboard");
    return true;
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
      host.showNote("copied to the clipboard");
      return true;
    }
    const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    host.showError(`Could not copy to the clipboard. The text is: ${preview}`);
    return false;
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
