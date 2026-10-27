import type { Documents } from "../../documents";
import type { CursorInfo } from "../../editor";
import type { EditorSettings } from "../../session";

export interface AppState {
  settings: EditorSettings;
  workspace: string | null;
  recentFolders: string[];
  recentFiles: string[];
  note: string;
  error: string | null;
  cursor: CursorInfo;
  outlinePath: string | null;
  documents: Documents | null;
}
