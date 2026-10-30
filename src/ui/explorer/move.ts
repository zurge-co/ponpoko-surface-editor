import { dirName, isUnder, pathKey } from "../../files";

/** The drag type this explorer uses for a row dragged inside its own tree. */
export const INTERNAL_MOVE_TYPE = "application/x-ponpoko-editor-path";

export interface MoveRow {
  path: string;
  isDir: boolean;
}

/**
 * The folder a drop lands in, or null when the move is refused. A drop on a
 * folder means "into that folder"; a drop on a file means "into the folder
 * that holds it". Moving a folder into itself or below itself, dragging the
 * workspace root, and dropping something back where it already is are all
 * refused rather than attempted and then reported as a backend error.
 */
export function moveTargetFolder(
  dragPath: string,
  hovered: MoveRow | null,
  root: string | null,
): string | null {
  if (root === null || dragPath.length === 0) return null;
  if (pathKey(dragPath) === pathKey(root)) return null;
  const folder = hovered === null ? root : hovered.isDir ? hovered.path : dirName(hovered.path);
  if (folder.length === 0) return null;
  if (isUnder(folder, dragPath)) return null;
  if (pathKey(folder) === pathKey(dirName(dragPath))) return null;
  return folder;
}
