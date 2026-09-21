import { promises as fs } from "fs";
import path from "path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Segment, wrapText } from "./srt";
import { CAPTION_BOTTOM_OFFSET, SAFE_ZONE } from "./safezone";

// Candidate bold fonts. Production should bundle Inter/Montserrat in the repo
// for deterministic rendering; these system paths are the MVP fallback.
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
];

const FONT_FAMILY = "CaptionFont";
let fontReady = false;

async function ensureFont(): Promise<void> {
  if (fontReady) return;
  for (const candidate of FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      GlobalFonts.registerFromPath(candidate, FONT_FAMILY);
      fontReady = true;
      return;
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
): Promise<Overlay[]> {
  await ensureFont();
  await fs.mkdir(outDir, { recursive: true });

  const fontSize = Math.round(width * 0.055);
  const lineHeight = Math.round(fontSize * 1.25);
  const outline = Math.max(3, Math.round(fontSize * 0.14));
  const safeLeft = width * SAFE_ZONE.leftMargin;
  const safeWidth = width * (1 - SAFE_ZONE.leftMargin - SAFE_ZONE.rightMargin);
  const baselineBottom = Math.round(height * (1 - CAPTION_BOTTOM_OFFSET));

  const overlays: Overlay[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const { lines } = wrapText(seg.text);
    if (lines.length === 0 || lines.join("").trim() === "") continue;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";

    // Fit-to-safe-width guard: shrink font if a line overflows horizontally.
    let usedFont = fontSize;
    for (const line of lines) {
      let w = ctx.measureText(line).width;
      while (w > safeWidth && usedFont > 24) {
        usedFont -= 2;
        ctx.font = `${usedFont}px ${FONT_FAMILY}`;
        w = ctx.measureText(line).width;
      }
    }
    const usedLineHeight = Math.round(usedFont * 1.25);

    // Center on the safe-zone block, not the frame (safe margins are asymmetric).
    const centerX = safeLeft + safeWidth / 2;
    const padY = Math.round(usedFont * 0.18);
    const radius = Math.round(usedFont * 0.14);
    const ascent = usedFont * 0.8;
    const descent = usedFont * 0.25;

    // Single black block spanning the full safe-zone width behind all lines.
    const topY = baselineBottom - (lines.length - 1) * usedLineHeight;
    const boxTop = topY - ascent - padY;
    const boxBottom = baselineBottom + descent + padY;
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.beginPath();
    ctx.roundRect(safeLeft, boxTop, safeWidth, boxBottom - boxTop, radius);
    ctx.fill();

    // Draw the text (thin outline + white fill) centered on top of the block.
    lines.forEach((line, li) => {
      const fromBottom = lines.length - 1 - li;
      const y = baselineBottom - fromBottom * usedLineHeight;
      ctx.lineWidth = Math.max(2, Math.round(outline * 0.5));
      ctx.strokeStyle = "#000000";
      ctx.strokeText(line, centerX, y);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(line, centerX, y);
    });

    const filePath = path.join(outDir, `ov_${String(i).padStart(4, "0")}.png`);
    await fs.writeFile(filePath, canvas.toBuffer("image/png"));
    overlays.push({ path: filePath, start: seg.start, end: seg.end });
  }

  return overlays;
}
