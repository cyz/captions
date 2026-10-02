export type CaptionPreset = "box";
export type CaptionFont =
  | "Arial"
  | "Helvetica"
  | "Verdana"
  | "Georgia"
  | "Trebuchet MS"
  | "Segoe UI";
export type CaptionAlignment = "left" | "center" | "right";
export type HighlightMode = "text" | "pill";

export interface CaptionStyle {
  preset: CaptionPreset;
  fontFamily: CaptionFont;
  fontWeight: 600 | 700 | 800;
  fontSize: number;
  textColor: string;
  accentColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundEnabled: boolean;
  uppercase: boolean;
  alignment: CaptionAlignment;
  verticalPosition: number;
  // Highlights the word being spoken.
  wordHighlight: boolean;
  highlightMode: HighlightMode;
  highlightColor: string;
}

export const CAPTION_PRESETS: Record<CaptionPreset, CaptionStyle> = {
  box: {
    preset: "box",
    fontFamily: "Arial",
    fontWeight: 800,
    fontSize: 54,
    textColor: "#ffffff",
    accentColor: "#f65282",
    outlineColor: "#111318",
    outlineWidth: 0,
    backgroundColor: "#111318",
    backgroundEnabled: true,
    uppercase: false,
    alignment: "center",
    verticalPosition: 78,
    wordHighlight: false,
    highlightMode: "text",
    highlightColor: "#f8d849",
  },
};

export const DEFAULT_CAPTION_STYLE = CAPTION_PRESETS.box;

// Quick looks built only from fields the renderer already supports.
export const QUICK_STYLES: Array<{
  id: string;
  label: string;
  patch: Partial<CaptionStyle>;
}> = [
  {
    id: "classic",
    label: "Classic",
    patch: { textColor: "#ffffff", backgroundColor: "#111318", uppercase: false },
  },
  {
    id: "light",
    label: "Light",
    patch: { textColor: "#111318", backgroundColor: "#ffffff", uppercase: false },
  },
  {
    id: "highlight",
    label: "Highlight",
    patch: { textColor: "#f8d849", backgroundColor: "#111318", uppercase: true },
  },
  {
    id: "vscode",
    label: "VS Code",
    patch: { textColor: "#ffffff", backgroundColor: "#007acc", uppercase: false },
  },
  {
    id: "pink",
    label: "Bold pink",
    patch: { textColor: "#ffffff", backgroundColor: "#f65282", uppercase: false },
  },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Dark or white text, whichever reads better on the given hex background.
export function readableTextOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance =
    (0.299 * (value >> 16) +
      0.587 * ((value >> 8) & 255) +
      0.114 * (value & 255)) /
    255;
  return luminance > 0.6 ? "#111318" : "#ffffff";
}

export function normalizeCaptionStyle(value: unknown): CaptionStyle {
  if (!value || typeof value !== "object") return { ...DEFAULT_CAPTION_STYLE };
  const input = value as Partial<CaptionStyle>;
  const preset: CaptionPreset = "box";
  const base = CAPTION_PRESETS[preset];
  const color = (candidate: unknown, fallback: string) =>
    typeof candidate === "string" && HEX_COLOR.test(candidate)
      ? candidate
      : fallback;
  const number = (candidate: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
  };

  return {
    preset,
    fontFamily:
      input.fontFamily === "Arial" ||
      input.fontFamily === "Helvetica" ||
      input.fontFamily === "Verdana" ||
      input.fontFamily === "Georgia" ||
      input.fontFamily === "Trebuchet MS" ||
      input.fontFamily === "Segoe UI"
        ? input.fontFamily
        : base.fontFamily,
    fontWeight: 800,
    fontSize: Math.round(number(input.fontSize, 28, 96, base.fontSize)),
    textColor: color(input.textColor, base.textColor),
    accentColor: color(input.accentColor, base.accentColor),
    outlineColor: base.outlineColor,
    outlineWidth: 0,
    backgroundColor: color(input.backgroundColor, base.backgroundColor),
    backgroundEnabled: true,
    uppercase:
      typeof input.uppercase === "boolean" ? input.uppercase : base.uppercase,
    alignment:
      input.alignment === "left" ||
      input.alignment === "center" ||
      input.alignment === "right"
        ? input.alignment
        : base.alignment,
    verticalPosition: Math.round(
      number(input.verticalPosition, 15, 90, base.verticalPosition),
    ),
    wordHighlight:
      typeof input.wordHighlight === "boolean"
        ? input.wordHighlight
        : base.wordHighlight,
    highlightMode: input.highlightMode === "pill" ? "pill" : "text",
    highlightColor: color(input.highlightColor, base.highlightColor),
  };
}
