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
    expect(written.get("--border")).toBe("rgba(255, 255, 255, 0.1)");
    expect([...written.values()].join(",")).not.toContain("url(");
  });
});
