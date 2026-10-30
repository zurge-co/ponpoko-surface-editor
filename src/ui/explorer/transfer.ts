import { baseName } from "../../files";
import { pathsFromUriList, type TransferItem } from "../../transfer";

export interface TransferPorts {
  target(): string | null;
  accept(items: TransferItem[]): Promise<void> | void;
  onNote(message: string): void;
  onHostPaste?(): void;
}

const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function typesInTextInput(target: unknown): boolean {
  const shaped = keysOf(target);
  if (shaped === null) return false;
  const tag = shaped["tagName"];
  if (typeof tag === "string" && EDITABLE.has(tag.toUpperCase())) return true;
  return shaped["isContentEditable"] === true;
}

interface EntryShape {
  isFile?: boolean;
  isDirectory?: boolean;
  name?: string;
  file?(ok: (file: unknown) => void, fail?: (error: unknown) => void): void;
  createReader?(): { readEntries(ok: (entries: unknown[]) => void, fail?: (error: unknown) => void): void };
}

interface ItemShape {
  kind?: string;
  webkitGetAsEntry?(): unknown;
  getAsFile?(): unknown;
}

function keysOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

async function fileBytes(file: unknown): Promise<Uint8Array> {
  const shaped = keysOf(file);
  const read = shaped?.["arrayBuffer"];
  if (typeof read !== "function") return new Uint8Array();
  const buffer = await (read as () => Promise<ArrayBuffer>).call(file);
  return new Uint8Array(buffer);
}

function readAllEntries(reader: { readEntries(ok: (entries: unknown[]) => void, fail?: (error: unknown) => void): void }): Promise<unknown[]> {
  return new Promise((resolve) => {
    const collected: unknown[] = [];
    const step = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(collected);
            return;
          }
          collected.push(...batch);
          step();
        },
        () => resolve(collected),
      );
    };
    step();
  });
}

function readFile(entry: EntryShape): Promise<unknown> {
  return new Promise((resolve) => {
    if (typeof entry.file !== "function") {
      resolve(null);
      return;
    }
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });
}

async function entryToItem(value: unknown): Promise<TransferItem | null> {
  const entry = keysOf(value) as EntryShape | null;
  if (entry === null) return null;
  const name = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : "pasted";
  if (entry.isDirectory === true) {
    const reader = typeof entry.createReader === "function" ? entry.createReader() : null;
    const entries = reader === null ? [] : await readAllEntries(reader);
    const children: TransferItem[] = [];
    for (const child of entries) {
      const item = await entryToItem(child);
      if (item !== null) children.push(item);
    }
    return { kind: "directory", name, children };
  }
  if (entry.isFile === true) {
    const file = await readFile(entry);
    if (file === null) return null;
    return { kind: "file", name, bytes: await fileBytes(file) };
  }
  return null;
}

export async function entriesToItems(entries: readonly unknown[]): Promise<TransferItem[]> {
  const items: TransferItem[] = [];
  for (const entry of entries) {
    const item = await entryToItem(entry);
    if (item !== null) items.push(item);
  }
  return items;
}

function itemKey(item: TransferItem): string {
  return `${item.kind}:${item.name}`;
}

function dedupe(items: TransferItem[]): TransferItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function itemsFromDataTransfer(data: DataTransfer): Promise<TransferItem[]> {
  const items: TransferItem[] = [];
  const entries: unknown[] = [];
  for (const item of Array.from(data.items ?? [])) {
    const shaped = item as ItemShape;
    if (shaped.kind === undefined || shaped.kind === "file") {
      const entry = typeof shaped.webkitGetAsEntry === "function" ? shaped.webkitGetAsEntry() : null;
      if (entry !== null && entry !== undefined) {
        entries.push(entry);
        continue;
      }
      const file = typeof shaped.getAsFile === "function" ? shaped.getAsFile() : null;
      if (file !== null && file !== undefined) {
        const shapedFile = keysOf(file);
        const name = typeof shapedFile?.["name"] === "string" ? (shapedFile["name"] as string) : "pasted";
        items.push({ kind: "file", name, bytes: await fileBytes(file) });
      }
    }
  }
  if (entries.length > 0) items.unshift(...(await entriesToItems(entries)));

  if (items.length === 0) {
    let uriList = "";
    try {
      uriList = data.getData("text/uri-list");
    } catch {
      uriList = "";
    }
    for (const path of pathsFromUriList(uriList)) {
      items.push({ kind: "path", name: baseName(path), path });
    }
  }

  return dedupe(items);
}

function hasFiles(data: DataTransfer | null): boolean {
  if (data === null) return false;
  if ((data.files?.length ?? 0) > 0) return true;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") return true;
  }
  try {
    return pathsFromUriList(data.getData("text/uri-list")).length > 0;
  } catch {
    return false;
  }
}

function wantsFiles(data: DataTransfer | null): boolean {
  if (data === null) return false;
  for (const type of Array.from(data.types ?? [])) {
    if (type === "Files" || type === "text/uri-list") return true;
  }
  return hasFiles(data);
}

export function attachTransfer(element: HTMLElement, ports: TransferPorts): () => void {
  let depth = 0;

  const mark = (on: boolean): void => {
    const classes = element.classList;
    if (classes === undefined) return;
    if (on) classes.add("is-drop-target");
    else classes.remove("is-drop-target");
  };

  const deliver = async (data: DataTransfer | null): Promise<void> => {
    if (ports.target() === null) {
      ports.onNote("Open a folder first");
      return;
    }
    const items = data === null ? [] : await itemsFromDataTransfer(data);
    if (items.length === 0) {
      ports.onNote("Nothing to paste — drag files or folders here");
      return;
    }
    await ports.accept(items);
  };

  const onPaste = (event: ClipboardEvent): void => {
    if (typesInTextInput(event.target)) return;
    const data = event.clipboardData;
    if (hasFiles(data)) {
      event.preventDefault();
      void deliver(data);
      return;
    }
    if (data === null || ports.onHostPaste === undefined) return;
    event.preventDefault();
    ports.onHostPaste();
  };

  const onDragEnter = (event: DragEvent): void => {
    if (!wantsFiles(event.dataTransfer) || ports.target() === null) return;
    event.preventDefault();
    depth += 1;
    mark(true);
  };

  const onDragOver = (event: DragEvent): void => {
    if (!wantsFiles(event.dataTransfer) || ports.target() === null) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    mark(true);
  };

  const onDragLeave = (event: DragEvent): void => {
    if (!wantsFiles(event.dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) mark(false);
  };

  const onDrop = (event: DragEvent): void => {
    if (!wantsFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth = 0;
    mark(false);
    void deliver(event.dataTransfer);
  };

  element.addEventListener("paste", onPaste as EventListener);
  element.addEventListener("dragenter", onDragEnter as EventListener);
  element.addEventListener("dragover", onDragOver as EventListener);
  element.addEventListener("dragleave", onDragLeave as EventListener);
  element.addEventListener("drop", onDrop as EventListener);

  return () => {
    element.removeEventListener("paste", onPaste as EventListener);
    element.removeEventListener("dragenter", onDragEnter as EventListener);
    element.removeEventListener("dragover", onDragOver as EventListener);
    element.removeEventListener("dragleave", onDragLeave as EventListener);
    element.removeEventListener("drop", onDrop as EventListener);
  };
}
