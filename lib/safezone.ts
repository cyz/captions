// Safe zone geometry for vertical 9:16 video (reference: 1080x1920).
// All values are ratios (0..1) relative to the target render dimensions so
// they scale to any 9:16 resolution. Based on best practices for Reels/Shorts/TikTok:
// keep captions clear of the top, the bottom UI/CTA band, and the right icon column.

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const TARGET_ASPECT = 9 / 16;

// Fractions of frame reserved (kept clear of caption text).
export const SAFE_ZONE = {
  // Top band reserved for platform UI / handles.
  topMargin: 0.10,
  // Bottom band reserved for username, CTA and caption description.
  bottomMargin: 0.18,
  // Right column reserved for like/comment/share icons.
  rightMargin: 0.12,
  // Left breathing room.
  leftMargin: 0.06,
} as const;

// Where the caption block sits vertically, measured as the distance of the
// caption baseline area from the bottom of the frame (fraction of height).
// Sits above the reserved bottom band so text never collides with the CTA.
export const CAPTION_BOTTOM_OFFSET = 0.22;

// Maximum text lines allowed per subtitle segment (hard product rule).
export const MAX_LINES = 2;

// Recommended max characters per line before wrapping/warning.
export const MAX_CHARS_PER_LINE = 34;

export interface SafeZoneRect {
  // Pixel rectangle (in target space) that is safe for caption text.
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getSafeTextRect(
  width = TARGET_WIDTH,
  height = TARGET_HEIGHT,
): SafeZoneRect {
  const x = width * SAFE_ZONE.leftMargin;
  const y = height * SAFE_ZONE.topMargin;
  const w = width * (1 - SAFE_ZONE.leftMargin - SAFE_ZONE.rightMargin);
  const h = height * (1 - SAFE_ZONE.topMargin - SAFE_ZONE.bottomMargin);
  return { x, y, width: w, height: h };
}
