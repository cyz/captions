import { promises as fs } from "fs";
import path from "path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Segment, wrapText } from "./srt";
import { getSafeZoneProfile } from "./safezone";
import { classifyVideoFormat } from "./video-format";
import {
  normalizeCaptionStyle,
  type CaptionStyle,
} from "./caption-style";

// Candidate bold fonts. Production should bundle Inter/Montserrat in the repo
// for deterministic rendering; these system paths are the MVP fallback.
const SYSTEM_FONT_PATHS: Record<CaptionStyle["fontFamily"], string[]> = {
  Arial: [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  ],
  Helvetica: [
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  ],
  Verdana: [
    "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
  Georgia: [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
  ],
  "Trebuchet MS": [
    "/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
  "Segoe UI": [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
};

const registeredFonts = new Set<string>();

async function ensureFont(fontFamily: CaptionStyle["fontFamily"]): Promise<string> {
  const alias = `Caption${fontFamily.replace(/\s+/g, "")}`;
  if (registeredFonts.has(alias)) return alias;
  for (const candidate of SYSTEM_FONT_PATHS[fontFamily]) {
    try {
      await fs.access(candidate);
      GlobalFonts.registerFromPath(candidate, alias);
      registeredFonts.add(alias);
      return alias;
    } catch {
      // try next
    }
  }
  throw new Error("No font available to render the captions.");
}

export interface Overlay {
  path: string;
  start: number; // ms
  end: number; // ms
}

// Render one transparent full-frame PNG per segment, with the caption text laid
// out inside the vertical safe zone (white fill, black outline, soft shadow).
export async function renderOverlays(
  segments: Segment[],
  outDir: string,
  width: number,
  height: number,
  captionStyle?: CaptionStyle,
): Promise<Overlay[]> {
  const style = normalizeCaptionStyle(captionStyle);
  const fontFamily = await ensureFont(style.fontFamily);
  await fs.mkdir(outDir, { recursive: true });
  const format = classifyVideoFormat(width, height);
  const safeZone = getSafeZoneProfile(format);
  const referenceScale = width / 1080;
  const fontSize = Math.round(style.fontSize * referenceScale);
  const lineHeight = Math.round(fontSize * 1.18);
  const outline = Math.round(style.outlineWidth * referenceScale);
  const safeLeft = width * safeZone.leftMargin;
  const safeWidth =
    width * (1 - safeZone.leftMargin - safeZone.rightMargin);
  const baselineBottom = Math.round(height * (style.verticalPosition / 100));

  const overlays: Overlay[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = style.uppercase ? seg.text.toLocaleUpperCase() : seg.text;
    const { lines } = wrapText(text);
    if (lines.length === 0 || lines.join("").trim() === "") continue;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.font = `${style.fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = style.alignment;
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";

    // Fit-to-safe-width guard: shrink font if a line overflows horizontally.
    let usedFont = fontSize;
    for (const line of lines) {
      let w = ctx.measureText(line).width;
      while (w > safeWidth && usedFont > 24) {
        usedFont -= 2;
        ctx.font = `${style.fontWeight} ${usedFont}px ${fontFamily}`;
        w = ctx.measureText(line).width;
      }
    }
    const usedLineHeight = Math.round(usedFont * 1.25);

    // Center on the safe-zone block, not the frame (safe margins are asymmetric).
    const textX =
      style.alignment === "left"
        ? safeLeft
        : style.alignment === "right"
          ? safeLeft + safeWidth
          : safeLeft + safeWidth / 2;
    const padY = Math.round(usedFont * 0.18);
    const radius = Math.round(usedFont * 0.14);
    const ascent = usedFont * 0.8;
    const descent = usedFont * 0.25;

    const topY = baselineBottom - (lines.length - 1) * usedLineHeight;
    const boxTop = topY - ascent - padY;
    const boxBottom = baselineBottom + descent + padY;
    if (style.backgroundEnabled) {
      const alpha = Math.round(style.backgroundOpacity * 255)
        .toString(16)
        .padStart(2, "0");
      ctx.fillStyle = `${style.backgroundColor}${alpha}`;
      ctx.beginPath();
      ctx.roundRect(safeLeft, boxTop, safeWidth, boxBottom - boxTop, radius);
      ctx.fill();
    }

    lines.forEach((line, li) => {
      const fromBottom = lines.length - 1 - li;
      const y = baselineBottom - fromBottom * usedLineHeight;
      const drawText = (value: string, x: number, color: string) => {
        if (outline > 0) {
          ctx.lineWidth = outline * 2;
          ctx.strokeStyle = style.outlineColor;
          ctx.strokeText(value, x, y);
        }
        ctx.fillStyle = color;
        ctx.fillText(value, x, y);
      };

      drawText(line, textX, style.textColor);
    });

    const filePath = path.join(outDir, `ov_${String(i).padStart(4, "0")}.png`);
    await fs.writeFile(filePath, canvas.toBuffer("image/png"));
    overlays.push({ path: filePath, start: seg.start, end: seg.end });
  }

  return overlays;
}
