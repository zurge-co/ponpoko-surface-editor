import type { DefinitionAnswer, DefinitionLocation, EditorApi, ReferenceLocation } from "./api";
import { baseName } from "./files";
import type { Platform } from "./keymap";
import type { PeekLocation, PeekRequest } from "./ui/peek";

export interface SourcePosition {
  line: number;
  column: number;
}

export interface TextTarget {
  path: string;
  text: string;
}

export type NavigationLocation = PeekLocation;

export interface WordAt {
  word: string;
  start: number;
  end: number;
}

export function isWordChar(char: string): boolean {
  return char.length > 0 && /[\p{L}\p{N}_$]/u.test(char);
}

export function wordAt(text: string, line: number, column: number): WordAt | null {
  const lines = text.split("\n");
  const lineText = lines[line - 1];
  if (lineText === undefined || lineText.length === 0) return null;
  let index = Math.min(lineText.length, Math.max(0, Math.trunc(column) - 1));
  if (index >= lineText.length || !isWordChar(lineText.charAt(index))) {
    index -= 1;
    if (index < 0 || !isWordChar(lineText.charAt(index))) return null;
  }
  let start = index;
  while (start > 0 && isWordChar(lineText.charAt(start - 1))) start -= 1;
  let end = index + 1;
  while (end < lineText.length && isWordChar(lineText.charAt(end))) end += 1;
  return { word: lineText.slice(start, end), start, end };
}

export function isNavigationClick(event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey">): boolean {
  if (event.button !== 0) return false;
  return event.metaKey || event.ctrlKey;
}

export function navigationClickLabel(platform: Platform): string {
  return platform === "mac" ? "⌘-click" : "Ctrl+click";
}

function keyOf(location: NavigationLocation): string {
  const path = location.path.replace(/\\/g, "/").replace(/\/\.\//g, "/");
  return `${path}:${location.line}:${location.column}`;
}

export function dedupeLocations(locations: readonly NavigationLocation[]): NavigationLocation[] {
  const seen = new Set<string>();
  const unique: NavigationLocation[] = [];
  for (const location of locations) {
    const key = keyOf(location);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(location);
  }
  return unique;
}

export function locationLabel(location: NavigationLocation): string {
  return `${location.relative ?? baseName(location.path)}:${location.line}`;
}

function toLocation(definition: DefinitionLocation): NavigationLocation {
  return {
    path: definition.path,
    relative: definition.relative,
    name: definition.name,
    kind: definition.kind,
    line: definition.line,
    column: definition.column,
    length: definition.length,
    language: definition.language,
    source: definition.source,
    excerpt: definition.excerpt,
    isDefinition: true,
  };
}

function referenceToLocation(reference: ReferenceLocation, word: string): NavigationLocation {
  return {
    path: reference.path,
    relative: reference.relative,
    name: word,
    kind: reference.kind,
    line: reference.line,
    column: reference.column,
    length: reference.length,
    excerpt: reference.line_text,
    isDefinition: reference.kind === "definition",
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface NavigationDeps {
  api: Pick<EditorApi, "definition" | "references" | "symbols">;
  active(): TextTarget | null;
  root(): string | null;
  cursor(): SourcePosition;
  positionAt(clientX: number, clientY: number): SourcePosition | null;
  open(location: NavigationLocation): void;
  peek(request: PeekRequest): void;
  onError(message: string): void;
  onNote(message: string): void;
}

export interface Navigator {
  goToDefinition(position?: SourcePosition): Promise<void>;
  findReferences(position?: SourcePosition): Promise<void>;
  goToSymbol(): Promise<void>;
  handlePointer(event: MouseEvent): void;
}

export function createNavigator(deps: NavigationDeps): Navigator {
  let sequence = 0;

  const query = (target: TextTarget, at: SourcePosition): {
    path: string;
    text: string;
    line: number;
    column: number;
    word?: string;
    root: string | null;
  } => {
    const word = wordAt(target.text, at.line, at.column);
    return {
      path: target.path,
      text: target.text,
      line: at.line,
      column: at.column,
      ...(word === null ? {} : { word: word.word }),
      root: deps.root(),
    };
  };

  async function goToDefinition(position?: SourcePosition): Promise<void> {
    const target = deps.active();
    if (target === null) {
      deps.onNote("Open a file to navigate its symbols.");
      return;
    }
    const at = position ?? deps.cursor();
    const token = (sequence += 1);
    try {
      const answer: DefinitionAnswer = await deps.api.definition(query(target, at));
      if (token !== sequence) return;
      const locations = dedupeLocations(answer.definitions.map(toLocation));
      if (locations.length === 0) {
        deps.onNote(
          answer.notes[0] ?? `No definition of “${answer.word}” was found in this folder.`,
        );
        return;
      }
      if (locations.length === 1) {
        deps.open(locations[0]);
        return;
      }
      deps.peek({
        title: `Definitions of ${answer.word}`,
        subtitle: `${locations.length} declarations`,
        locations,
        onPick: (location) => deps.open(location),
      });
    } catch (failure) {
      if (token === sequence) deps.onError(`Go to Definition failed: ${messageOf(failure)}`);
    }
  }

  async function findReferences(position?: SourcePosition): Promise<void> {
    const target = deps.active();
    if (target === null) {
      deps.onNote("Open a file to find references to its symbols.");
      return;
    }
    const at = position ?? deps.cursor();
    const word = wordAt(target.text, at.line, at.column);
    if (word === null) {
      deps.onNote("There is no identifier under the cursor.");
      return;
    }
    const token = (sequence += 1);
    try {
      const answer = await deps.api.references(query(target, at));
      if (token !== sequence) return;
      const locations = dedupeLocations(
        answer.references.map((reference) => referenceToLocation(reference, answer.word)),
      );
      if (locations.length === 0) {
        deps.onNote(answer.notes[0] ?? `No references to “${word.word}” were found in this folder.`);
        return;
      }
      deps.peek({
        title: `References to ${answer.word}`,
        subtitle: `${locations.length} in ${answer.files_searched} ${answer.files_searched === 1 ? "file" : "files"}`,
        locations,
        onPick: (location) => deps.open(location),
      });
    } catch (failure) {
      if (token === sequence) deps.onError(`Find All References failed: ${messageOf(failure)}`);
    }
  }

  async function goToSymbol(): Promise<void> {
    const target = deps.active();
    if (target === null) {
      deps.onNote("Open a file to see its symbols.");
      return;
    }
    const token = (sequence += 1);
    try {
      const answer = await deps.api.symbols(target.path, target.text);
      if (token !== sequence) return;
      const locations = dedupeLocations(
        answer.symbols.map((symbol) => ({
          path: target.path,
          relative: baseName(target.path),
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
          column: symbol.column + 1,
          length: symbol.name.length,
          language: answer.language,
          source: `line ${symbol.line}`,
        })),
      );
      if (locations.length === 0) {
        deps.onNote("This file declares no symbols this editor can navigate to.");
        return;
      }
      deps.peek({
        title: `Symbols in ${baseName(target.path)}`,
        subtitle: `${locations.length} declarations`,
        locations,
        onPick: (location) => deps.open(location),
      });
    } catch (failure) {
      if (token === sequence) deps.onError(`Go to Symbol failed: ${messageOf(failure)}`);
    }
  }

  return {
    goToDefinition,
    findReferences,
    goToSymbol,
    handlePointer(event) {
      if (!isNavigationClick(event)) return;
      const at = deps.positionAt(event.clientX, event.clientY);
      if (at === null) return;
      event.preventDefault();
      void goToDefinition(at);
    },
  };
}
