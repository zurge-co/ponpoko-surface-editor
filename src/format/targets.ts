import type * as PrettierStandalone from "prettier/standalone";
import type { FormatAnswer } from "../api";
import { type EditorConfigValues } from "../editorconfig";
import { languageLabel, type LanguageId } from "../languages";
import type { EditorSettings } from "../session";
import type { Eol } from "../tabs";

export type FormatEngine = "prettier" | "rustfmt" | "taplo";

export interface FormatTarget {
  engine: FormatEngine;
  parser?: string;
}

export function formatEngineLabel(engine: FormatEngine): string {
  if (engine === "prettier") return "Prettier";
  if (engine === "rustfmt") return "rustfmt";
  return "taplo";
}

export function formatTarget(language: LanguageId): FormatTarget | null {
  switch (language) {
    case "typescript":
    case "tsx":
      return { engine: "prettier", parser: "typescript" };
    case "javascript":
    case "jsx":
      return { engine: "prettier", parser: "babel" };
    case "json":
      return { engine: "prettier", parser: "json" };
    case "jsonc":
      return { engine: "prettier", parser: "jsonc" };
    case "yaml":
      return { engine: "prettier", parser: "yaml" };
    case "markdown":
      return { engine: "prettier", parser: "markdown" };
    case "mdx":
      return { engine: "prettier", parser: "mdx" };
    case "css":
      return { engine: "prettier", parser: "css" };
    case "scss":
      return { engine: "prettier", parser: "scss" };
    case "less":
      return { engine: "prettier", parser: "less" };
    case "html":
      return { engine: "prettier", parser: "html" };
    case "rust":
      return { engine: "rustfmt" };
    case "toml":
      return { engine: "taplo" };
    default:
      return null;
  }
}

export function noFormatterSentence(language: LanguageId): string {
  return `There is no formatter for ${languageLabel(language)} in this editor. It formats JavaScript, TypeScript, JSX/TSX, JSON, YAML, Markdown/MDX, CSS/SCSS/Less and HTML with Prettier, Rust with rustfmt, and TOML with taplo.`;
}

export interface PrettierRuntime {
  format(source: string, options: Parameters<typeof PrettierStandalone.format>[1]): Promise<string>;
  plugins: unknown[];
}

export let prettierRuntime: Promise<PrettierRuntime> | null = null;

export function loadPrettier(): Promise<PrettierRuntime> {
  if (prettierRuntime !== null) return prettierRuntime;
  prettierRuntime = (async () => {
    const [standalone, babel, estree, typescript, postcss, html, markdown, yaml] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/html"),
      import("prettier/plugins/markdown"),
      import("prettier/plugins/yaml"),
    ]);
    return {
      format: (source, options) => standalone.format(source, options),
      plugins: [babel, estree, typescript, postcss, html, markdown, yaml],
    };
  })();
  return prettierRuntime;
}

export const PRETTIER_KEYS = new Set([
  "printWidth",
  "tabWidth",
  "useTabs",
  "semi",
  "singleQuote",
  "jsxSingleQuote",
  "quoteProps",
  "trailingComma",
  "bracketSpacing",
  "bracketSameLine",
  "arrowParens",
  "proseWrap",
  "htmlWhitespaceSensitivity",
  "vueIndentScriptAndStyle",
  "singleAttributePerLine",
  "objectWrap",
  "embeddedLanguageFormatting",
  "experimentalTernaries",
  "experimentalOperatorPosition",
]);

export type PrettierOptionValue = string | number | boolean;
export type PrettierOptions = Record<string, PrettierOptionValue>;

export interface FormatConfigInput {
  settings: EditorSettings;
  eol: Eol;
  editorconfig: EditorConfigValues;
  prettier: Readonly<Record<string, unknown>>;
  prettierSource: string | null;
  editorconfigSource: string | null;
}

export interface ResolvedPrettierOptions {
  options: PrettierOptions;
  notes: string[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPrettierValue(value: unknown): value is PrettierOptionValue {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

export function resolvePrettierOptions(input: FormatConfigInput): ResolvedPrettierOptions {
  const notes: string[] = [];
  const options: PrettierOptions = {
    printWidth: 100,
    tabWidth: input.settings.tabSize,
    useTabs: !input.settings.insertSpaces,
    endOfLine: "lf",
  };

  const { editorconfig } = input;
  if (editorconfig.indentStyle !== undefined) options.useTabs = editorconfig.indentStyle === "tab";
  if (editorconfig.indentSize !== undefined && editorconfig.indentSize !== "tab") {
    options.tabWidth = editorconfig.indentSize;
  }
  if (editorconfig.tabWidth !== undefined) options.tabWidth = editorconfig.tabWidth;
  if (editorconfig.indentSize === "tab" && editorconfig.tabWidth === undefined) options.tabWidth = 4;
  if (editorconfig.maxLineLength !== undefined && editorconfig.maxLineLength !== "off") {
    options.printWidth = editorconfig.maxLineLength;
  }
  if (editorconfig.insertFinalNewline === false) {
    notes.push(
      "Prettier always ends a file with one newline, so insert_final_newline = false from .editorconfig is not applied.",
    );
  }
  if (editorconfig.charset !== undefined && editorconfig.charset !== "utf-8" && editorconfig.charset !== "utf-8-bom") {
    notes.push(
      `.editorconfig asks for ${editorconfig.charset}, but this editor reads and writes UTF-8 text; the file stays UTF-8.`,
    );
  }
  if (editorconfig.endOfLine !== undefined && editorconfig.endOfLine !== input.eol) {
    notes.push(
      `.editorconfig asks for ${editorconfig.endOfLine.toUpperCase()} line endings; this file is set to ${input.eol.toUpperCase()} on the status bar and is saved that way.`,
    );
  }

  const ignored: string[] = [];
  for (const [key, value] of Object.entries(input.prettier)) {
    if (key === "overrides") {
      notes.push(
        `${input.prettierSource ?? ".prettierrc"} has "overrides"; this editor applies only the options at the top of the file, not the per-path overrides.`,
      );
      continue;
    }
    if (key === "endOfLine") {
      notes.push(
        `${input.prettierSource ?? ".prettierrc"} sets endOfLine; this editor saves the line endings chosen on the status bar instead.`,
      );
      continue;
    }
    if (!PRETTIER_KEYS.has(key)) {
      ignored.push(key);
      continue;
    }
    if (isPrettierValue(value)) options[key] = value;
  }
  if (ignored.length > 0) {
    notes.push(
      `${input.prettierSource ?? ".prettierrc"} sets ${ignored.map((key) => `"${key}"`).join(", ")}, which this editor does not pass to Prettier.`,
    );
  }

  return { options, notes };
}

export function parseJsonLoose(text: string): unknown {
  let result = "";
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index];
    if (inString) {
      result += character;
      if (character === "\\" && index + 1 < text.length) {
        result += text[index + 1];
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") {
        index += 1;
        continue;
      }
    }
    result += character;
    index += 1;
  }
  return JSON.parse(result) as unknown;
}

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

export interface FormatFileSystem {
  stat(path: string): Promise<{ exists: boolean; is_file?: boolean }>;
  read(path: string): Promise<{ content: string; bytes?: number }>;
  formatRust(content: string, path?: string): Promise<FormatAnswer>;
  formatToml(content: string): Promise<FormatAnswer>;
}
