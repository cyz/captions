export type VideoFormat = "social" | "long-form";

export function classifyVideoFormat(width: number, height: number): VideoFormat {
  return width > height ? "long-form" : "social";
}
