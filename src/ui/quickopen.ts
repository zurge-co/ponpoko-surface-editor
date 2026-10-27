import type { WorkspaceFile, WorkspaceFilesAnswer } from "../api";
import { formatBytes } from "../files";
import { createPalette, type Palette, type PaletteItem } from "./palette";

export function fileCandidates(files: readonly WorkspaceFile[]): PaletteItem[] {
  return files.map((file) => ({
    id: file.path,
    label: file.relative,
    detail: formatBytes(file.bytes),
  }));
}

export interface QuickOpenDeps {
  workspace(): string | null;
  files(root: string): Promise<WorkspaceFilesAnswer>;
  open(path: string): void | Promise<void>;
  onError(message: string): void;
}

export interface QuickOpen {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createQuickOpen(deps: QuickOpenDeps): QuickOpen {
  const palette: Palette = createPalette({
    label: "Go to File",
    placeholder: "Type part of a file's name or path",
    emptyText: "Open a folder, then type part of a file's name.",
    items: async () => {
      const root = deps.workspace();
      if (root === null) return [];
      const answer = await deps.files(root);
      return fileCandidates(answer.files);
    },
    onChoose: (item) => {
      void deps.open(item.id);
    },
    onError: deps.onError,
  });

  return {
    open: () => palette.open(),
    close: () => palette.close(),
    isOpen: () => palette.isOpen(),
    destroy: () => palette.destroy(),
  };
}
