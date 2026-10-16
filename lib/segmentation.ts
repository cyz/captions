import { Segment, wrapText } from "./srt";
import { getFormatProfile, type VideoFormat } from "./video-format";

export interface TimedWord {
  text: string;
  // Milliseconds from the start of the video.
  start: number;
  end: number;
}

export interface SegmentationOptions {
  format?: VideoFormat;
  // A pause longer than this always starts a new caption.
  maxGapMs?: number;
  minDurationMs?: number;
}

const SENTENCE_END = /[.!?…。！？]["')\]»”]?$/;
const CLAUSE_END = /[,;:，；：]["')\]»”]?$/;
// Shortest caption that may end at a sentence boundary instead of filling up.
const MIN_SENTENCE_CHARS = 14;
const HOLD_MS = 250;

// Wrap a caption over two lines at the word boundary closest to the middle,
// as long as both lines respect the character limit.
function balanceLines(words: string[], maxChars: number): string {
  const flat = words.join(" ");
  if (flat.length <= maxChars || words.length < 2) return flat;
  const middle = flat.length / 2;
  let best = -1;
  let bestDistance = Infinity;
  let offset = 0;
  for (let i = 0; i < words.length - 1; i++) {
    offset += words[i].length + (i > 0 ? 1 : 0);
    const distance = Math.abs(offset - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  const first = words.slice(0, best + 1).join(" ");
  const second = words.slice(best + 1).join(" ");
  return first.length <= maxChars && second.length <= maxChars
    ? `${first}\n${second}`
    : flat;
}

function sanitize(words: TimedWord[]): TimedWord[] {
  const clean: TimedWord[] = [];
  for (const word of words) {
    const text = word.text.replace(/\s+/g, " ").trim();
    if (!text || !Number.isFinite(word.start)) continue;
    const previous = clean[clean.length - 1];
    // Words never overlap, so neither do the captions built from them.
    const start = Math.max(0, Math.round(word.start), previous?.end ?? 0);
    const end = Math.max(start + 60, Math.round(word.end));
    clean.push({ text, start, end });
  }
  return clean;
}

// Turn word-level speech timestamps into readable, timed captions. Captions
// break at pauses, sentence ends and when the format's line limits are reached.
export function wordsToSegments(
  rawWords: TimedWord[],
  { format = "social", maxGapMs = 600, minDurationMs = 900 }: SegmentationOptions = {},
): Segment[] {
  const profile = getFormatProfile(format);
  const capacity = profile.maxCharsPerLine * profile.maxLines;
  const words = sanitize(rawWords);
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];

  const textLength = (group: TimedWord[]) =>
    group.reduce((sum, word) => sum + word.text.length, 0) +
    Math.max(0, group.length - 1);

  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous) {
      const joined = [...current, word].map((item) => item.text).join(" ");
      const length = textLength(current);
      const breakHere =
        word.start - previous.end > maxGapMs ||
        wrapText(joined, format).overflow ||
        word.end - current[0].start > profile.maxSegmentMs ||
        (SENTENCE_END.test(previous.text) && length >= MIN_SENTENCE_CHARS) ||
        (CLAUSE_END.test(previous.text) && length >= capacity * 0.6);
      if (breakHere) {
        groups.push(current);
        current = [];
      }
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);

  const segments: Segment[] = groups.map((group, i) => {
    const start = group[0].start;
    const spokenEnd = group[group.length - 1].end;
    const nextStart = groups[i + 1]?.[0].start ?? Infinity;
    // Keep each caption readable a moment longer without touching the next one.
    const end = Math.max(
      spokenEnd,
      Math.min(Math.max(spokenEnd + HOLD_MS, start + minDurationMs), nextStart),
    );
    return {
      index: i + 1,
      start,
      end,
      text: balanceLines(
        group.map((word) => word.text),
        profile.maxCharsPerLine,
      ),
      wordStarts: group.map((word) => word.start),
    };
  });

  return segments;
}
