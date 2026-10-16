export type VideoFormat = "social" | "long-form";

// Anything at least this wide (width / height) is treated as horizontal
// long-form video. 4:3, 16:9 and ultrawide qualify; 1:1, 4:5 and 9:16 do not.
export const LONG_FORM_MIN_ASPECT = 1.2;

export function classifyVideoFormat(width: number, height: number): VideoFormat {
  if (!(width > 0) || !(height > 0)) return "social";
  return width / height >= LONG_FORM_MIN_ASPECT ? "long-form" : "social";
}

// Caption layout rules that depend on the video format.
export interface FormatProfile {
  // Frame width the caption font size is authored against.
  referenceWidth: number;
  maxCharsPerLine: number;
  maxLines: number;
  // "full" fills the safe zone width; "hug" wraps the box around the text.
  boxMode: "full" | "hug";
  // Longest a single automatic caption stays on screen.
  maxSegmentMs: number;
}

export const FORMAT_PROFILES: Record<VideoFormat, FormatProfile> = {
  social: {
    referenceWidth: 1080,
    maxCharsPerLine: 34,
    maxLines: 2,
    boxMode: "full",
    maxSegmentMs: 5000,
  },
  "long-form": {
    referenceWidth: 1920,
    maxCharsPerLine: 42,
    maxLines: 2,
    boxMode: "hug",
    maxSegmentMs: 6000,
  },
};

export function getFormatProfile(format: VideoFormat): FormatProfile {
  return FORMAT_PROFILES[format];
}
