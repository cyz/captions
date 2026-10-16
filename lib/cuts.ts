import type { Segment } from "./srt";

// A stretch of the source video (ms) that is removed from the export.
export interface Cut {
  start: number;
  end: number;
}

const MIN_CUT_MS = 40;
// Keep the filter graph and the render time bounded.
export const MAX_CUTS = 400;

// Sorted, clamped to the video, overlapping or touching cuts merged.
export function normalizeCuts(cuts: ReadonlyArray<Cut>, durationMs = Infinity): Cut[] {
  const sorted = cuts
    .map((cut) => ({
      start: Math.max(0, Math.round(Number(cut.start))),
      end: Math.min(durationMs, Math.round(Number(cut.end))),
    }))
    .filter((cut) => Number.isFinite(cut.start) && cut.end - cut.start >= MIN_CUT_MS)
    .sort((a, b) => a.start - b.start);

  const merged: Cut[] = [];
  for (const cut of sorted) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else merged.push({ ...cut });
  }
  return merged.slice(0, MAX_CUTS);
}

export function totalCutMs(cuts: ReadonlyArray<Cut>): number {
  return cuts.reduce((sum, cut) => sum + (cut.end - cut.start), 0);
}

// Position on the exported timeline of a moment of the source video. A moment
// inside a cut lands where the cut was.
export function mapTime(cuts: ReadonlyArray<Cut>, ms: number): number {
  let removed = 0;
  for (const cut of cuts) {
    if (cut.start >= ms) break;
    removed += Math.min(ms, cut.end) - cut.start;
  }
  return ms - removed;
}

export interface Range {
  start: number;
  end: number;
}

// The stretches of the source that stay in the export.
export function keptRanges(cuts: ReadonlyArray<Cut>, durationMs: number): Range[] {
  const kept: Range[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor) kept.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < durationMs) kept.push({ start: cursor, end: durationMs });
  return kept;
}

// True when a cut already covers the whole range.
export function isCovered(cuts: ReadonlyArray<Cut>, range: Range): boolean {
  return cuts.some((cut) => cut.start <= range.start && cut.end >= range.end);
}

// Captions on the exported timeline. Captions that fall entirely inside a cut
// disappear; the rest keep their words aligned.
export function remapSegments(segments: Segment[], cuts: ReadonlyArray<Cut>): Segment[] {
  if (cuts.length === 0) return segments;
  const result: Segment[] = [];
  for (const segment of segments) {
    const start = mapTime(cuts, segment.start);
    const end = mapTime(cuts, segment.end);
    if (end <= start) continue;
    const { wordStarts, ...rest } = segment;
    result.push({
      ...rest,
      start,
      end,
      ...(wordStarts ? { wordStarts: wordStarts.map((value) => mapTime(cuts, value)) } : {}),
    });
  }
  return result.map((segment, i) => ({ ...segment, index: i + 1 }));
}
