import type { VideoFormat } from "./video-format";
import { VSCODE_INSIDERS as INSIDERS, VSCODE_STABLE as STABLE } from "./vscode-brand";

export type CaptionPreset = "box";
export type CaptionFont =
  | "Arial"
  | "Helvetica"
  | "Verdana"
  | "Georgia"
  | "Trebuchet MS"
  | "Segoe UI"
  | "Inter"
  | "Montserrat"
  | "JetBrains Mono"
  | "Cascadia Code";
export interface CaptionFontOption {
  family: CaptionFont;
  // Bundled fonts ship with the app, so the preview and the render match on
  // every machine. The rest depend on the fonts installed on the host.
  bundled: boolean;
  monospace?: boolean;
}

export const CAPTION_FONTS: CaptionFontOption[] = [
  { family: "Inter", bundled: true },
  { family: "Montserrat", bundled: true },
  { family: "Cascadia Code", bundled: true, monospace: true },
  { family: "JetBrains Mono", bundled: true, monospace: true },
  { family: "Segoe UI", bundled: false },
  { family: "Arial", bundled: false },
  { family: "Helvetica", bundled: false },
  { family: "Verdana", bundled: false },
  { family: "Georgia", bundled: false },
  { family: "Trebuchet MS", bundled: false },
];

export function isCaptionFont(value: unknown): value is CaptionFont {
  return CAPTION_FONTS.some((font) => font.family === value);
}

// CSS font stack for the browser preview.
export function cssFontStack(family: CaptionFont): string {
  const monospace = CAPTION_FONTS.find((font) => font.family === family)?.monospace;
  return `"${family}", ${monospace ? "ui-monospace, Menlo, monospace" : "system-ui, sans-serif"}`;
}

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

// Font size is authored against the format's reference width (1080 social,
// 1920 long-form), and horizontal video keeps captions lower in the frame.
const LONG_FORM_CAPTION_STYLE: CaptionStyle = {
  ...CAPTION_PRESETS.box,
  fontSize: 52,
  verticalPosition: 86,
};

export function getDefaultCaptionStyle(
  format: VideoFormat = "social",
): CaptionStyle {
  return { ...(format === "long-form" ? LONG_FORM_CAPTION_STYLE : DEFAULT_CAPTION_STYLE) };
}

// Quick looks built only from fields the renderer already supports. Each one
// must look clearly different from the others (a test enforces it). The VS Code
// and Insiders colors live in ./vscode-brand.
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
    patch: {
      textColor: "#111318",
      backgroundColor: "#ffffff",
      highlightColor: STABLE.lightLink,
      uppercase: false,
    },
  },
  {
    id: "highlight",
    label: "Highlight",
    patch: { textColor: "#f8d849", backgroundColor: "#111318", uppercase: true },
  },
  {
    id: "pink",
    label: "Bold pink",
    patch: { textColor: "#ffffff", backgroundColor: "#f65282", uppercase: false },
  },
  {
    id: "vscode-blue",
    label: "VS Code Blue",
    patch: {
      fontFamily: "Inter",
      textColor: "#ffffff",
      backgroundColor: STABLE.accent,
      highlightColor: STABLE.yellow,
      uppercase: false,
    },
  },
  {
    id: "vscode-dark-plus",
    label: "Dark+ Editor",
    patch: {
      fontFamily: "Cascadia Code",
      textColor: STABLE.editorText,
      backgroundColor: STABLE.editorSurface,
      highlightColor: STABLE.editorFunction,
      uppercase: false,
    },
  },
  {
    id: "insiders-green",
    label: "Insiders Green",
    patch: {
      fontFamily: "Inter",
      textColor: "#ffffff",
      backgroundColor: INSIDERS.green,
      highlightColor: INSIDERS.yellow,
      uppercase: false,
    },
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

export function normalizeCaptionStyle(
  value: unknown,
  format: VideoFormat = "social",
): CaptionStyle {
  const base = getDefaultCaptionStyle(format);
  if (!value || typeof value !== "object") return base;
  const input = value as Partial<CaptionStyle>;
  const preset: CaptionPreset = "box";
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
    fontFamily: isCaptionFont(input.fontFamily)
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
