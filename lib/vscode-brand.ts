// Colors for the VS Code presets, kept apart so they are easy to adjust. Values
// come from code.visualstudio.com and the official logos; no logos or
// trademarks are drawn.

// Stable: the website's blue accent and the Dark+ editor theme.
export const VSCODE_STABLE = {
  accent: "#0078d4",
  lightLink: "#0067b8",
  yellow: "#fff100",
  editorSurface: "#1e1e1e",
  editorText: "#d4d4d4",
  editorFunction: "#dcdcaa",
} as const;

// Insiders: the green of its logo (#00b090 with #20b8a0 and #009878 shades).
// The logo's own tones are too light to carry white text, so `green` is its
// darkest tone (#009878) darkened by 14% to reach a 4.7:1 contrast with white.
export const VSCODE_INSIDERS = {
  green: "#008367",
  yellow: "#fff100",
} as const;
