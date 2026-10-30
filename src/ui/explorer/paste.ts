import type { PasteAnswer } from "../../bridge";
import { pasteItems, pathItems } from "../../paste";
import type { TransferItem } from "../../transfer";
import { attachTransfer } from "./transfer";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PastePorts {
  element: HTMLElement;
  read(): Promise<PasteAnswer>;
  onDrop(handler: (paths: readonly string[]) => void): () => void;
  root(): string | null;
  target(): string | null;
  transfer(items: readonly TransferItem[]): Promise<void>;
  onNote(message: string): void;
  onError(message: string): void;
}

export interface PasteDoor {
  pasteFromClipboard(): Promise<void>;
  detach(): void;
}

export function createPasteDoor(ports: PastePorts): PasteDoor {
  async function pasteFromClipboard(): Promise<void> {
    if (ports.root() === null) {
      ports.onNote("Open a folder first");
      return;
    }
    let answer: PasteAnswer;
    try {
      answer = await ports.read();
    } catch (failure) {
      ports.onError(`Could not read the clipboard: ${messageOf(failure)}`);
      return;
    }
    const items = pasteItems(answer);
    if (items.length === 0) {
      ports.onNote("Nothing to paste — copy a file, a folder or an image first");
      return;
    }
    await ports.transfer(items);
  }

  const detachDrop = ports.onDrop((paths) => void ports.transfer(pathItems(paths)));
  const detachTransfer = attachTransfer(ports.element, {
    target: () => ports.target(),
    accept: (items) => ports.transfer(items),
    onNote: (message) => ports.onNote(message),
    onHostPaste: () => void pasteFromClipboard(),
  });

  return {
    pasteFromClipboard,
    detach() {
      detachTransfer();
      detachDrop();
    },
  };
}
