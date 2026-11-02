function luminance(hex: string): number {
  return [1, 3, 5].reduce((sum, offset, i) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const linear = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][i];
  }, 0);
}

export type PaletteTokens = Record<string, string>;

const HEX = /^#[0-9a-fA-F]{6}$/;

function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function rgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DIRECT: Record<string, string> = {
  "--bg": "base",
  "--panel": "panel",
  "--panel-raised": "elevated",
  "--panel-hover": "panel_hover",
  "--code": "code",
  "--fg": "text",
  "--fg-muted": "text_muted",
  "--fg-dim": "text_dim",
  "--accent": "accent",
  "--accent-soft": "accent_lime",
  "--attention": "attention",
  "--danger": "danger",
  "--on-accent": "on_accent",
  "--scrollbar": "text_dim",
  "--scrollbar-hover": "text_muted",
};

export function applyPaletteTokens(root: HTMLElement, tokens: PaletteTokens): string[] {
  const applied: string[] = [];
  for (const [property, source] of Object.entries(DIRECT)) {
    const value = tokens[source];
    if (!isHex(value)) continue;
    root.style.setProperty(property, value);
    applied.push(property);
  }

  const base = tokens.base;
  const light = isHex(base) && luminance(base) > 0.4;
  root.style.colorScheme = light ? "light" : "dark";
  const borderAlpha = light ? 0.18 : 0.06;
  const border = isHex(tokens.border) ? tokens.border : null;
  if (border) {
    root.style.setProperty("--border", rgba(border, borderAlpha));
    root.style.setProperty("--border-strong", rgba(border, borderAlpha * 2));
    applied.push("--border", "--border-strong");
  }
  if (isHex(tokens.accent)) {
    root.style.setProperty("--accent-selection", rgba(tokens.accent, 0.15));
    applied.push("--accent-selection");
  }
  if (isHex(tokens.attention)) {
    root.style.setProperty("--attention-soft", rgba(tokens.attention, 0.08));
    applied.push("--attention-soft");
  }
  if (isHex(tokens.overlay)) root.style.setProperty("--overlay", rgba(tokens.overlay, 0.45));
  return applied;
}
