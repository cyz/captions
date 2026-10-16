import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CAPTION_STYLE, QUICK_STYLES } from "../lib/caption-style";

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function distance(a: string, b: string): number {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
  return Math.hypot(
    (x >> 16) - (y >> 16),
    ((x >> 8) & 255) - ((y >> 8) & 255),
    (x & 255) - (y & 255),
  );
}

const BRAND_IDS = ["vscode-blue", "vscode-dark-plus", "insiders-green"];

test("VS Code presets stay readable over video", () => {
  const brand = QUICK_STYLES.filter((item) => BRAND_IDS.includes(item.id));
  assert.equal(brand.length, BRAND_IDS.length);
  for (const preset of brand) {
    const style = { ...DEFAULT_CAPTION_STYLE, ...preset.patch };
    assert.ok(
      contrast(style.textColor, style.backgroundColor) >= 4.5,
      `${preset.id}: text on background`,
    );
    // The spoken word is highlighted in this color, so it must also stand out.
    assert.ok(
      contrast(style.highlightColor, style.backgroundColor) >= 3,
      `${preset.id}: highlight on background`,
    );
  }
});

test("the light preset highlights words readably", () => {
  const light = QUICK_STYLES.find((item) => item.id === "light");
  const style = { ...DEFAULT_CAPTION_STYLE, ...light?.patch };
  assert.ok(contrast(style.highlightColor, style.backgroundColor) >= 3);
});

test("no two presets look alike", () => {
  const looks = QUICK_STYLES.map((preset) => {
    const style = { ...DEFAULT_CAPTION_STYLE, ...preset.patch };
    return { id: preset.id, style };
  });
  for (let i = 0; i < looks.length; i++) {
    for (let j = i + 1; j < looks.length; j++) {
      const a = looks[i].style;
      const b = looks[j].style;
      const sameFont = a.fontFamily === b.fontFamily && a.uppercase === b.uppercase;
      // Two boxes with near-identical colors are the same preset.
      const close =
        distance(a.backgroundColor, b.backgroundColor) < 40 &&
        distance(a.textColor, b.textColor) < 40;
      assert.ok(!(sameFont && close), `${looks[i].id} and ${looks[j].id} look alike`);
    }
  }
});
