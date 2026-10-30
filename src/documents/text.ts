import type { Eol } from "../tabs";

export interface IndentationGuess {
  /** null when the file indents with tabs, whose display width is a setting. */
  tabSize: number | null;
  insertSpaces: boolean;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}

/**
 * Read the indentation a file already uses, so typing in it does not fight
 * the file. It is a heuristic and says so: a file with fewer than three
 * indented lines, or with both tabs and spaces in comparable numbers, is
 * left to the editor's settings instead of being guessed at.
 */
export function detectIndentation(text: string): IndentationGuess | null {
  let tabLines = 0;
  let spaceLines = 0;
  let mixedLines = 0;
  const spaceWidths: number[] = [];

  for (const line of text.split("\n", 20_000)) {
    if (line.length === 0 || line.trim().length === 0) continue;
    const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
    if (lead.length === 0) continue;
    const tabs = (lead.match(/\t/g) ?? []).length;
    if (tabs > 0 && lead.includes(" ")) {
      mixedLines += 1;
      continue;
    }
    if (tabs > 0) tabLines += 1;
    else {
      spaceLines += 1;
      spaceWidths.push(lead.length);
    }
  }

  const indented = tabLines + spaceLines;
  if (indented < 3 || mixedLines * 3 > indented) return null;

  if (tabLines >= spaceLines * 3) return { tabSize: null, insertSpaces: false };
  if (spaceLines < tabLines * 3) return null;

  const counts = new Map<number, number>();
  for (const width of spaceWidths) counts.set(width, (counts.get(width) ?? 0) + 1);

  // The indentation step is the smallest width that is used often enough to
  // be structural. This ignores one-off alignment under a continued line.
  const minimum = Math.max(2, Math.floor(spaceLines * 0.15));
  const viable = [...counts.entries()]
    .filter(([width, count]) => width >= 2 && width <= 8 && count >= minimum)
    .sort((a, b) => a[0] - b[0]);

  if (viable.length > 0) {
    return { tabSize: viable[0][0], insertSpaces: true };
  }

  // No single width is common enough; the greatest common divisor of the
  // indents still describes a consistent step (2- and 4-space code alike).
  let divisor = 0;
  for (const width of spaceWidths) divisor = greatestCommonDivisor(divisor, width);
  if (divisor >= 2 && divisor <= 8) return { tabSize: divisor, insertSpaces: true };
  return null;
}

export function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (crlf === 0) return "lf";
  const loneLf = text.replace(/\r\n/g, "").split("\n").length - 1;
  return loneLf >= crlf ? "lf" : "crlf";
}

export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function toDiskText(text: string, eol: Eol): string {
  return eol === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
