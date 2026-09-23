// Safe zone geometry for vertical 9:16 video (reference: 1080x1920).
// All values are ratios (0..1) relative to the target render dimensions so
// they scale to any 9:16 resolution. Based on best practices for Reels/Shorts/TikTok:
// keep captions clear of the top, the bottom UI/CTA band, and the right icon column.

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const TARGET_ASPECT = 9 / 16;

export type SafeZoneFormat = "social" | "long-form";

export interface SafeZoneProfile {
  topMargin: number;
  bottomMargin: number;
  rightMargin: number;
  leftMargin: number;
  captionBottomOffset: number;
}

export const SAFE_ZONE_PROFILES: Record<SafeZoneFormat, SafeZoneProfile> = {
  social: {
    topMargin: 0.1,
    bottomMargin: 0.18,
    rightMargin: 0.12,
    leftMargin: 0.06,
    captionBottomOffset: 0.22,
  },
  "long-form": {
    topMargin: 0.08,
    bottomMargin: 0.1,
    rightMargin: 0.08,
    leftMargin: 0.08,
    captionBottomOffset: 0.12,
  },
};

export const SAFE_ZONE = SAFE_ZONE_PROFILES.social;
export const CAPTION_BOTTOM_OFFSET = SAFE_ZONE.captionBottomOffset;

export function getSafeZoneProfile(format: SafeZoneFormat): SafeZoneProfile {
  return SAFE_ZONE_PROFILES[format];
}

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
  format: SafeZoneFormat = "social",
): SafeZoneRect {
  const safeZone = getSafeZoneProfile(format);
  const x = width * safeZone.leftMargin;
  const y = height * safeZone.topMargin;
  const w = width * (1 - safeZone.leftMargin - safeZone.rightMargin);
  const h = height * (1 - safeZone.topMargin - safeZone.bottomMargin);
  return { x, y, width: w, height: h };
}
