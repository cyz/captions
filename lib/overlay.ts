import { promises as fs } from "fs";
import path from "path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Segment, wordTimings, wrapText } from "./srt";
import { getSafeZoneProfile } from "./safezone";
import { classifyVideoFormat, getFormatProfile } from "./video-format";
import {
  normalizeCaptionStyle,
  readableTextOn,
  type CaptionStyle,
} from "./caption-style";

const BUNDLED_FONT_DIR = path.join(process.cwd(), "public", "fonts");

// Fonts shipped with the app render identically on every host.
const BUNDLED_FONT_FILES: Partial<Record<CaptionStyle["fontFamily"], string>> = {
  Inter: "inter-latin-800-normal.woff2",
  Montserrat: "montserrat-latin-800-normal.woff2",
  "JetBrains Mono": "jetbrains-mono-latin-800-normal.woff2",
  "Cascadia Code": "cascadia-code-latin-700-normal.woff2",
};

// Candidate bold system fonts for the families that are not bundled.
const SYSTEM_FONT_PATHS: Record<CaptionStyle["fontFamily"], string[]> = {
  Inter: [],
  Montserrat: [],
  "JetBrains Mono": [],
  "Cascadia Code": [],
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

// Used when none of the preferred files for a family exist (e.g. Arial in a
// Linux container without Liberation fonts), so export never hard-fails.
const FALLBACK_FONT_PATHS = [
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

const registeredFonts = new Map<string, string>();

async function ensureFont(fontFamily: CaptionStyle["fontFamily"]): Promise<string> {
  const cached = registeredFonts.get(fontFamily);
  if (cached) return cached;

  const alias = `Caption${fontFamily.replace(/\s+/g, "")}`;
  const bundled = BUNDLED_FONT_FILES[fontFamily];
  const candidates = [
    ...new Set([
      ...(bundled ? [path.join(BUNDLED_FONT_DIR, bundled)] : []),
      ...SYSTEM_FONT_PATHS[fontFamily],
      ...FALLBACK_FONT_PATHS,
    ]),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
    } catch {
      continue;
    }
    // registerFromPath returns null (instead of throwing) on failure.
    if (GlobalFonts.registerFromPath(candidate, alias)) {
      registeredFonts.set(fontFamily, alias);
      return alias;
    }
  }

  // Last resort: any font the canvas runtime discovered on the system.
  const systemFamily = GlobalFonts.families[0]?.family;
  if (systemFamily) {
    const quoted = `"${systemFamily.replace(/"/g, "")}"`;
    registeredFonts.set(fontFamily, quoted);
    return quoted;
  }

  throw new Error(
    "No font available to render the captions. Install a TrueType font such as fonts-dejavu-core or fonts-liberation on the render host.",
  );
}

export interface Overlay {
  path: string;
  start: number; // ms
  end: number; // ms
}

// Fully transparent frame used by the overlay timeline between captions.
export async function writeBlankOverlay(
  outDir: string,
  width: number,
  height: number,
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });
  const blankPath = path.join(outDir, "blank.png");
  await fs.writeFile(blankPath, createCanvas(width, height).toBuffer("image/png"));
  return blankPath;
}

// Render transparent full-frame PNGs with the caption text laid out inside the
// vertical safe zone. With word highlight on, each segment yields one PNG per
// spoken word, active only while that word is spoken.
export async function renderOverlays(
  segments: Segment[],
  outDir: string,
  width: number,
  height: number,
  captionStyle?: CaptionStyle,
  onProgress?: (done: number, total: number) => void,
): Promise<Overlay[]> {
  const format = classifyVideoFormat(width, height);
  const profile = getFormatProfile(format);
  const style = normalizeCaptionStyle(captionStyle, format);
  const fontFamily = await ensureFont(style.fontFamily);
  await fs.mkdir(outDir, { recursive: true });
  const safeZone = getSafeZoneProfile(format);
  const referenceScale = width / profile.referenceWidth;
  const fontSize = Math.round(style.fontSize * referenceScale);
  const outline = Math.round(style.outlineWidth * referenceScale);
  const safeLeft = width * safeZone.leftMargin;
  const safeWidth =
    width * (1 - safeZone.leftMargin - safeZone.rightMargin);
  const hug = profile.boxMode === "hug";
  // In hug mode the box is padded around the text, so text lays out inside it.
  const padX = hug ? Math.round(fontSize * 0.45) : 0;
  const textLeft = safeLeft + padX;
  const textWidth = safeWidth - padX * 2;
  const baselineBottom = Math.round(height * (style.verticalPosition / 100));

  const overlays: Overlay[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    onProgress?.(i, segments.length);
    const text = style.uppercase ? seg.text.toLocaleUpperCase() : seg.text;
    const { lines } = wrapText(text, format);
    if (lines.length === 0 || lines.join("").trim() === "") continue;

    // Time windows with the index of the highlighted word (null = no highlight).
    const timings = style.wordHighlight ? wordTimings(seg) : [];
    const states: Array<{ start: number; end: number; active: number | null }> =
      timings.length > 0
        ? timings.map((word, wordIndex) => ({
            start: word.start,
            end: word.end,
            active: wordIndex,
          }))
        : [{ start: seg.start, end: seg.end, active: null }];

    for (let s = 0; s < states.length; s++) {
      const state = states[s];
      if (state.end <= state.start) continue;

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.font = `${style.fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.textAlign = state.active === null ? style.alignment : "left";
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";

      // Fit-to-safe-width guard: shrink font if a line overflows horizontally.
      let usedFont = fontSize;
      for (const line of lines) {
        let w = ctx.measureText(line).width;
        while (w > textWidth && usedFont > 24) {
          usedFont -= 2;
          ctx.font = `${style.fontWeight} ${usedFont}px ${fontFamily}`;
          w = ctx.measureText(line).width;
        }
      }
      const usedLineHeight = Math.round(usedFont * 1.25);

      // Center on the safe-zone block, not the frame (safe margins are asymmetric).
      const textX =
        style.alignment === "left"
          ? textLeft
          : style.alignment === "right"
            ? textLeft + textWidth
            : textLeft + textWidth / 2;
      const padY = Math.round(usedFont * 0.28);
      const radius = Math.round(usedFont * 0.14);
      const ascent = usedFont * 0.8;
      const descent = usedFont * 0.25;

      const topY = baselineBottom - (lines.length - 1) * usedLineHeight;
      const boxTop = topY - ascent - padY;
      const boxBottom = baselineBottom + descent + padY;
      if (style.backgroundEnabled) {
        let boxLeft = safeLeft;
        let boxWidth = safeWidth;
        if (hug) {
          const widest = Math.max(
            ...lines.map((line) => ctx.measureText(line).width),
          );
          boxWidth = Math.min(safeWidth, Math.ceil(widest) + padX * 2);
          boxLeft =
            style.alignment === "left"
              ? safeLeft
              : style.alignment === "right"
                ? safeLeft + safeWidth - boxWidth
                : safeLeft + (safeWidth - boxWidth) / 2;
        }
        ctx.fillStyle = style.backgroundColor;
        ctx.beginPath();
        ctx.roundRect(boxLeft, boxTop, boxWidth, boxBottom - boxTop, radius);
        ctx.fill();
      }

      let wordIndex = 0;
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

        if (state.active === null) {
          drawText(line, textX, style.textColor);
          return;
        }

        // Word by word, positioned as if the whole line were drawn at once.
        const words = line.split(" ").filter(Boolean);
        const lineWidth = ctx.measureText(words.join(" ")).width;
        const lineLeft =
          style.alignment === "left"
            ? textLeft
            : style.alignment === "right"
              ? textLeft + textWidth - lineWidth
              : textLeft + (textWidth - lineWidth) / 2;
        words.forEach((word, position) => {
          const x =
            lineLeft +
            (position === 0
              ? 0
              : ctx.measureText(`${words.slice(0, position).join(" ")} `).width);
          const isActive = wordIndex === state.active;
          wordIndex += 1;
          if (isActive && style.highlightMode === "pill") {
            const padX = Math.round(usedFont * 0.1);
            ctx.fillStyle = style.highlightColor;
            ctx.beginPath();
            ctx.roundRect(
              x - padX,
              y - ascent - padY / 2,
              ctx.measureText(word).width + padX * 2,
              ascent + descent + padY,
              radius,
            );
            ctx.fill();
            drawText(word, x, readableTextOn(style.highlightColor));
          } else {
            drawText(
              word,
              x,
              isActive ? style.highlightColor : style.textColor,
            );
          }
        });
      });

      const filePath = path.join(
        outDir,
        `ov_${String(i).padStart(4, "0")}_${String(s).padStart(3, "0")}.png`,
      );
      await fs.writeFile(filePath, canvas.toBuffer("image/png"));
      overlays.push({ path: filePath, start: state.start, end: state.end });
    }
  }

  onProgress?.(segments.length, segments.length);
  return overlays;
}
