import type { Eol } from "../tabs";

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
