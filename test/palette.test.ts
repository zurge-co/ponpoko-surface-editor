const { describe, test, expect } = await import("bun:test");

const mapping = await import("../src/palette.ts");

describe("the palette reaches surfaces instead of them guessing", () => {
  test("the editor maps host tokens onto its own custom properties", () => {
    const written = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => void written.set(name, value),
      },
    } as unknown as HTMLElement;
    const applied = mapping.applyPaletteTokens(root, {
      base: "#101010",
      panel: "#202020",
      text: "#eeeeee",
      accent: "#c77d4c",
      border: "#ffffff",
      bogus: "url(x)",
    });
    expect(applied).toContain("--bg");
    expect(written.get("--bg")).toBe("#101010");
    expect(written.get("--accent")).toBe("#c77d4c");
    expect(written.get("--border")).toBe("rgba(255, 255, 255, 0.06)");
    expect([...written.values()].join(",")).not.toContain("url(");
  });
});

test("switching the palette replaces hover, accent text, scrim and native control scheme", () => {
  const written = new Map<string, string>();
  const root = { style: { colorScheme: "", setProperty: (key: string, value: string) => written.set(key, value) } } as unknown as HTMLElement;
  mapping.applyPaletteTokens(root, { base: "#e6e9dc", panel_hover: "#e1e7d6", on_accent: "#eef1e6", overlay: "#000000", border: "#5a6452" });
  expect(root.style.colorScheme).toBe("light");
  expect(written.get("--panel-hover")).toBe("#e1e7d6");
  expect(written.get("--on-accent")).toBe("#eef1e6");
  expect(written.get("--border")).toBe("rgba(90, 100, 82, 0.18)");
  mapping.applyPaletteTokens(root, { base: "#241811", panel_hover: "#32241a", on_accent: "#241811", border: "#f7f0e3" });
  expect(root.style.colorScheme).toBe("dark");
  expect(written.get("--panel-hover")).toBe("#32241a");
  expect(written.get("--on-accent")).toBe("#241811");
  expect(written.get("--border")).toBe("rgba(247, 240, 227, 0.06)");
});
