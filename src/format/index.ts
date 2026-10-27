import type * as PrettierStandalone from "prettier/standalone";
import type { FormatAnswer } from "../api";
import { parseEditorConfig, resolveEditorConfig, type EditorConfigDocument, type EditorConfigValues } from "../editorconfig";
import { baseName, joinPath, relativePath } from "../files";
import { languageFor, type LanguageId } from "../languages";
import type { EditorSettings } from "../session";
import type { Eol } from "../tabs";
import { formatTarget, noFormatterSentence, loadPrettier, isRecord, resolvePrettierOptions, parseJsonLoose, FormatError } from "./targets";
import type { FormatEngine, PrettierRuntime, FormatFileSystem } from "./targets";

export interface FormatConfig {
  editorconfig: EditorConfigValues;
  editorconfigSource: string | null;
  prettier: Record<string, unknown>;
  prettierSource: string | null;
  notes: string[];
}

export async function readOptional(fs: FormatFileSystem, path: string): Promise<string | null> {
  const info = await fs.stat(path);
  if (!info.exists) return null;
  if (info.is_file === false) return null;
  const answer = await fs.read(path);
  return answer.content;
}

export async function readFormatConfig(
  workspace: string | null,
  path: string,
  fs: FormatFileSystem,
): Promise<FormatConfig> {
  const notes: string[] = [];
  let editorconfig: EditorConfigValues = {};
  let editorconfigSource: string | null = null;
  let prettier: Record<string, unknown> = {};
  let prettierSource: string | null = null;

  if (workspace !== null) {
    const editorconfigPath = joinPath(workspace, ".editorconfig");
    const editorconfigText = await readOptional(fs, editorconfigPath);
    if (editorconfigText !== null) {
      const document: EditorConfigDocument = parseEditorConfig(editorconfigText);
      editorconfig = resolveEditorConfig(document, relativePath(workspace, path));
      editorconfigSource = ".editorconfig";
    }

    const candidates = [".prettierrc", ".prettierrc.json"];
    const found: Array<{ name: string; text: string }> = [];
    for (const name of candidates) {
      const text = await readOptional(fs, joinPath(workspace, name));
      if (text !== null) found.push({ name, text });
    }
    if (found.length > 1) {
      notes.push(
        `Both .prettierrc and .prettierrc.json are in this folder; .prettierrc was used and .prettierrc.json was ignored.`,
      );
    }
    const chosen = found[0];
    if (chosen !== undefined) {
      let parsed: unknown;
      try {
        parsed = parseJsonLoose(chosen.text);
      } catch (error) {
        throw new FormatError(
          `${chosen.name} is not valid JSON (${error instanceof Error ? error.message : String(error)}), so nothing was formatted. Fix that file, or delete it to format with the editor's own settings.`,
        );
      }
      if (!isRecord(parsed)) {
        throw new FormatError(
          `${chosen.name} holds ${Array.isArray(parsed) ? "a list" : "a value"} instead of an object of options, so nothing was formatted.`,
        );
      }
      prettier = parsed;
      prettierSource = chosen.name;
    }
  }

  return { editorconfig, editorconfigSource, prettier, prettierSource, notes };
}

export interface FormatRequest {
  path: string;
  text: string;
  language?: LanguageId | null;
  eol: Eol;
  settings: EditorSettings;
  workspace: string | null;
}

export interface FormatOutcome {
  content: string;
  engine: FormatEngine;
  engineLabel: string;
  changed: boolean;
  notes: string[];
  warnings: string[];
  configSource: string | null;
}

export const MAX_FORMAT_BYTES = 8 * 1024 * 1024;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function firstLine(message: string): string {
  const line = message.split(/\r?\n/).find((candidate) => candidate.trim().length > 0);
  return line ?? message;
}

export async function formatDocument(
  request: FormatRequest,
  fs: FormatFileSystem,
): Promise<FormatOutcome> {
  const language = request.language ?? languageFor(request.path);
  const target = formatTarget(language);
  if (target === null) throw new FormatError(noFormatterSentence(language));

  const name = baseName(request.path);
  if (request.text.length > MAX_FORMAT_BYTES) {
    throw new FormatError(
      `${name} is ${Math.round(request.text.length / (1024 * 1024))} MB, larger than the ${MAX_FORMAT_BYTES / (1024 * 1024)} MB this editor formats.`,
    );
  }

  const config = await readFormatConfig(request.workspace, request.path, fs);
  const notes = [...config.notes];

  if (target.engine === "rustfmt") {
    let answer: FormatAnswer;
    try {
      answer = await fs.formatRust(request.text, request.path);
    } catch (error) {
      throw new FormatError(`rustfmt could not format ${name}: ${messageOf(error)}`);
    }
    const content = answer.content.replace(/\r\n/g, "\n");
    return {
      content,
      engine: "rustfmt",
      engineLabel: "rustfmt",
      changed: content !== request.text,
      notes,
      warnings: answer.warnings === undefined || answer.warnings.length === 0 ? [] : [answer.warnings],
      configSource: null,
    };
  }

  if (target.engine === "taplo") {
    let answer: FormatAnswer;
    try {
      answer = await fs.formatToml(request.text);
    } catch (error) {
      throw new FormatError(`taplo could not format ${name}: ${messageOf(error)}`);
    }
    const content = answer.content.replace(/\r\n/g, "\n");
    return {
      content,
      engine: "taplo",
      engineLabel: "taplo",
      changed: content !== request.text,
      notes,
      warnings: [],
      configSource: null,
    };
  }

  const resolved = resolvePrettierOptions({
    settings: request.settings,
    eol: request.eol,
    editorconfig: config.editorconfig,
    prettier: config.prettier,
    prettierSource: config.prettierSource,
    editorconfigSource: config.editorconfigSource,
  });
  notes.push(...resolved.notes);

  const parser = target.parser;
  if (parser === undefined) throw new FormatError(noFormatterSentence(language));

  let runtime: PrettierRuntime;
  try {
    runtime = await loadPrettier();
  } catch (error) {
    throw new FormatError(
      `Prettier could not be loaded, so ${name} was not formatted: ${firstLine(messageOf(error))}`,
    );
  }

  let formatted: string;
  try {
    const options = {
      ...resolved.options,
      parser,
      plugins: runtime.plugins,
      filepath: request.path,
    } as Parameters<typeof PrettierStandalone.format>[1];
    formatted = await runtime.format(request.text, options);
  } catch (error) {
    throw new FormatError(`Prettier could not format ${name}: ${firstLine(messageOf(error))}`);
  }

  const content = formatted.replace(/\r\n/g, "\n");
  return {
    content,
    engine: "prettier",
    engineLabel: "Prettier",
    changed: content !== request.text,
    notes,
    warnings: [],
    configSource: config.prettierSource ?? config.editorconfigSource,
  };
}

export interface CaretPosition {
  line: number;
  column: number;
}

export const WORD = /[\w$]/;

export function wordAt(text: string, line: number, column: number): { word: string; offset: number } | null {
  const lines = text.split("\n");
  const target = lines[Math.min(lines.length, Math.max(1, line)) - 1] ?? "";
  const index = Math.min(target.length, Math.max(0, column - 1));
  let start = index;
  while (start > 0 && WORD.test(target[start - 1])) start -= 1;
  let end = index;
  while (end < target.length && WORD.test(target[end])) end += 1;
  if (end <= start) return null;
  return { word: target.slice(start, end), offset: index - start };
}

export function nearestPosition(before: string, caret: CaretPosition, after: string): CaretPosition {
  const afterLines = after.split("\n");
  const lineCount = Math.max(1, afterLines.length);
  const line = Math.min(lineCount, Math.max(1, Math.round(caret.line)));

  const word = wordAt(before, caret.line, caret.column);
  if (word !== null && word.word.length > 0) {
    let best: { line: number; column: number; distance: number } | null = null;
    for (let index = 0; index < afterLines.length; index += 1) {
      const at = afterLines[index].indexOf(word.word);
      if (at < 0) continue;
      const distance = Math.abs(index + 1 - line);
      if (best === null || distance < best.distance) {
        best = { line: index + 1, column: at + word.offset + 1, distance };
      }
    }
    if (best !== null) return { line: best.line, column: best.column };
  }

  const originalLine = (before.split("\n")[caret.line - 1] ?? "").trim();
  if (originalLine.length > 0) {
    for (let offset = 0; offset < afterLines.length; offset += 1) {
      for (const candidate of [line - 1 - offset, line - 1 + offset]) {
        if (candidate < 0 || candidate >= afterLines.length) continue;
        if (afterLines[candidate].trim() !== originalLine) continue;
        return { line: candidate + 1, column: Math.min(caret.column, afterLines[candidate].length + 1) };
      }
    }
  }

  return { line, column: Math.min(Math.max(1, caret.column), (afterLines[line - 1] ?? "").length + 1) };
}

export * from "./targets";
