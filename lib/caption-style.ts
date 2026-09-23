export type CaptionPreset = "box";
export type CaptionFont =
  | "Arial"
  | "Helvetica"
  | "Verdana"
  | "Georgia"
  | "Trebuchet MS"
  | "Segoe UI";
export type CaptionAlignment = "left" | "center" | "right";

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
  backgroundOpacity: number;
  backgroundEnabled: boolean;
  uppercase: boolean;
  alignment: CaptionAlignment;
  verticalPosition: number;
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
    backgroundOpacity: 0.86,
    backgroundEnabled: true,
    uppercase: false,
    alignment: "center",
    verticalPosition: 78,
  },
};

export const DEFAULT_CAPTION_STYLE = CAPTION_PRESETS.box;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
    backgroundOpacity: number(
      input.backgroundOpacity,
      0,
      1,
      base.backgroundOpacity,
    ),
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
  };
}
