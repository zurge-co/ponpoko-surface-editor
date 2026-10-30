import type { PasteAnswer } from "./bridge";
import { baseName } from "./files";
import { textAsset, type TransferItem } from "./transfer";

export const PASTED_TEXT_NAME = "pasted.txt";
export const PASTED_IMAGE_NAME = "pasted.png";

export function pasteItems(answer: PasteAnswer): TransferItem[] {
  if (answer.kind === "file") {
    return answer.paths.map((path) => ({ kind: "path" as const, name: baseName(path), path }));
  }
  if (answer.kind === "image") {
    if (answer.base64.length === 0) return [];
    const name = answer.name.length > 0 ? answer.name : PASTED_IMAGE_NAME;
    return [{ kind: "asset", name, base64: answer.base64 }];
  }
  if (answer.kind === "text") {
    if (answer.text.length === 0) return [];
    const name = answer.name.length > 0 ? answer.name : PASTED_TEXT_NAME;
    return [textAsset(name, answer.text)];
  }
  return [];
}

export function pathItems(paths: readonly string[]): TransferItem[] {
  return paths
    .filter((path) => path.length > 0)
    .map((path) => ({ kind: "path" as const, name: baseName(path), path }));
}
