import { baseName } from "./files";

export interface EditorConfigSection {
  pattern: string;
  properties: Readonly<Record<string, string>>;
}

export interface EditorConfigDocument {
  root: boolean;
  sections: readonly EditorConfigSection[];
}

export interface EditorConfigValues {
  indentStyle?: "space" | "tab";
  indentSize?: number | "tab";
  tabWidth?: number;
  endOfLine?: "lf" | "crlf" | "cr";
  maxLineLength?: number | "off";
  insertFinalNewline?: boolean;
  trimTrailingWhitespace?: boolean;
  charset?: string;
}

const TRUE_VALUES = new Set(["true", "yes", "1"]);
const FALSE_VALUES = new Set(["false", "no", "0"]);

function ignoredLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";");
}

export function parseEditorConfig(text: string): EditorConfigDocument {
  let root = false;
  const sections: EditorConfigSection[] = [];
  let current: { pattern: string; properties: Record<string, string> } | null = null;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (ignoredLine(raw)) continue;
    const line = raw.trim();

    if (line.startsWith("[") && line.endsWith("]")) {
      const pattern = line.slice(1, -1).trim();
      if (pattern.length === 0) {
        current = null;
        continue;
      }
      current = { pattern, properties: {} };
      sections.push(current);
      continue;
    }

    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim();
    if (key.length === 0) continue;

    if (current === null) {
      if (key === "root") root = TRUE_VALUES.has(value.toLowerCase());
      continue;
    }
    current.properties[key] = value;
  }

  return { root, sections };
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  let depth = 0;
  let close = -1;
  for (let index = open; index < pattern.length; index += 1) {
    if (pattern[index] === "{") depth += 1;
    else if (pattern[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return [pattern];

  const before = pattern.slice(0, open);
  const body = pattern.slice(open + 1, close);
  const after = pattern.slice(close + 1);

  const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body);
  let alternatives: string[];
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = start <= end ? 1 : -1;
    const count = Math.abs(end - start) + 1;
    if (count > 1000) return [pattern];
    alternatives = Array.from({ length: count }, (_, index) => String(start + index * step));
  } else {
    alternatives = body.split(",");
  }

  return alternatives.flatMap((alternative) => expandBraces(`${before}${alternative}${after}`));
}

function escapeRegex(text: string): string {
  return text.replace(/[.+^$()|\\]/g, (character) => `\\${character}`);
}

function globSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close > index + 1) {
        const raw = pattern.slice(index + 1, close);
        const negated = raw.startsWith("!");
        const body = negated ? raw.slice(1) : raw;
        source += `[${negated ? "^" : ""}${body.replace(/\\/g, "\\\\")}]`;
        index = close;
        continue;
      }
    }
    source += escapeRegex(character);
  }
  return source;
}

export function editorConfigMatch(pattern: string, path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.length === 0) return false;
  const bare = pattern.replace(/^\/+/, "");
  const candidate = bare.includes("/") ? normalized : baseName(normalized);
  const sources = expandBraces(bare).map(globSource);
  if (sources.length === 0) return false;
  try {
    return new RegExp(`^(?:${sources.join("|")})$`).test(candidate);
  } catch {
    return false;
  }
}

function integer(value: string): number | undefined {
  if (!/^-?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function boolean(value: string): boolean | undefined {
  const lower = value.toLowerCase();
  if (TRUE_VALUES.has(lower)) return true;
  if (FALSE_VALUES.has(lower)) return false;
  return undefined;
}

function applyProperties(values: EditorConfigValues, properties: Readonly<Record<string, string>>): void {
  for (const [key, raw] of Object.entries(properties)) {
    const value = raw.trim();
    const lower = value.toLowerCase();
    switch (key) {
      case "indent_style":
        if (lower === "space" || lower === "tab") values.indentStyle = lower;
        break;
      case "indent_size":
        if (lower === "tab") values.indentSize = "tab";
        else {
          const size = integer(value);
          if (size !== undefined) values.indentSize = size;
        }
        break;
      case "tab_width": {
        const width = integer(value);
        if (width !== undefined) values.tabWidth = width;
        break;
      }
      case "end_of_line":
        if (lower === "lf" || lower === "crlf" || lower === "cr") values.endOfLine = lower;
        break;
      case "max_line_length":
        if (lower === "off") values.maxLineLength = "off";
        else {
          const length = integer(value);
          if (length !== undefined) values.maxLineLength = length;
        }
        break;
      case "insert_final_newline": {
        const flag = boolean(value);
        if (flag !== undefined) values.insertFinalNewline = flag;
        break;
      }
      case "trim_trailing_whitespace": {
        const flag = boolean(value);
        if (flag !== undefined) values.trimTrailingWhitespace = flag;
        break;
      }
      case "charset":
        values.charset = lower;
        break;
      default:
        break;
    }
  }
}

export function resolveEditorConfig(
  document: EditorConfigDocument | null,
  path: string,
): EditorConfigValues {
  const values: EditorConfigValues = {};
  if (document === null) return values;
  for (const section of document.sections) {
    if (!editorConfigMatch(section.pattern, path)) continue;
    applyProperties(values, section.properties);
  }
  return values;
}
