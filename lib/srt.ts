import { MAX_CHARS_PER_LINE, MAX_LINES } from "./safezone";

export interface Segment {
  index: number;
  // Milliseconds from start of video.
  start: number;
  end: number;
  // Raw text, may contain a single "\n" separating up to two lines.
  text: string;
  // Start (ms) of each word, kept when it comes from a word-by-word source.
  wordStarts?: number[];
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

const TIME_RE =
  /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h, 10) * 3600000 +
    parseInt(m, 10) * 60000 +
    parseInt(s, 10) * 1000 +
    parseInt(ms, 10)
  );
}

export function msToTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(millis, 3)}`;
}

// Parse SRT content into ordered segments. Tolerant of CRLF and dotted millis.
export function parseSrt(content: string): Segment[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const segments: Segment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;

    let cursor = 0;
    // Optional numeric index line.
    if (/^\d+$/.test(lines[0].trim())) cursor = 1;

    const timeLine = lines[cursor];
    if (!timeLine) continue;
    const match = TIME_RE.exec(timeLine);
    if (!match) continue;

    const start = toMs(match[1], match[2], match[3], match[4]);
    const end = toMs(match[5], match[6], match[7], match[8]);
    const textLines = lines.slice(cursor + 1);
    const text = textLines.join("\n").trim();

    segments.push({ index: segments.length + 1, start, end, text });
  }

  return segments;
}

// Serialize segments back to SRT (useful for export / debugging).
export function serializeSrt(segments: Segment[]): string {
  return segments
    .map((seg, i) => {
      const idx = i + 1;
      return `${idx}\n${msToTimestamp(seg.start)} --> ${msToTimestamp(
        seg.end,
      )}\n${seg.text}\n`;
    })
    .join("\n");
}

// Wrap text into at most MAX_LINES lines. Manual line breaks (\n) entered by the
// user are honored so they control where the break happens; otherwise the text
// is auto-wrapped by MAX_CHARS_PER_LINE. Returns lines and whether it overflows.
export function wrapText(text: string): { lines: string[]; overflow: boolean } {
  const normalized = text.replace(/\r/g, "");

  // Honor explicit line breaks so the user can keep captions within the pattern.
  if (/\n/.test(normalized)) {
    const manual = normalized
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l !== "");
    const overflow =
      manual.length > MAX_LINES ||
      manual.some((l) => l.length > MAX_CHARS_PER_LINE);
    return { lines: manual.slice(0, MAX_LINES), overflow };
  }

  const collapsed = normalized.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_CHARS_PER_LINE) {
    return { lines: collapsed ? [collapsed] : [], overflow: false };
  }

  const words = collapsed.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_CHARS_PER_LINE && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const overflow = lines.length > MAX_LINES;
  return { lines: lines.slice(0, MAX_LINES), overflow };
}

export interface SegmentValidation {
  index: number;
  errors: string[];
}

function flattenText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function reindex(segments: Segment[]): Segment[] {
  return segments.map((segment, i) => ({ ...segment, index: i + 1 }));
}

export function segmentWords(text: string): string[] {
  const flat = flattenText(text);
  return flat ? flat.split(" ") : [];
}

// Per-word timing: real when known, otherwise split by word length.
export function wordTimings(segment: Segment): WordTiming[] {
  const words = segmentWords(segment.text);
  if (words.length === 0) return [];
  const { start, end } = segment;
  let starts: number[];
  if (segment.wordStarts?.length === words.length) {
    starts = segment.wordStarts.map((value) =>
      Math.min(end, Math.max(start, value)),
    );
    starts[0] = start;
    for (let i = 1; i < starts.length; i++) {
      starts[i] = Math.max(starts[i], starts[i - 1]);
    }
  } else {
    const weights = words.map((word) => Math.max(2, word.length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let accumulated = 0;
    starts = weights.map((weight) => {
      const value = start + Math.round(((end - start) * accumulated) / total);
      accumulated += weight;
      return value;
    });
  }
  return words.map((text, i) => ({
    text,
    start: starts[i],
    end: i + 1 < words.length ? starts[i + 1] : end,
  }));
}

// Known word starts of a segment, or null when they would have to be guessed.
function knownWordStarts(segment: Segment): number[] | null {
  const words = segmentWords(segment.text);
  if (words.length === 0) return null;
  if (segment.wordStarts?.length === words.length) return segment.wordStarts;
  return words.length === 1 ? [segment.start] : null;
}

function withWordStarts(segment: Segment, starts: number[] | null): Segment {
  const { wordStarts: _discarded, ...rest } = segment;
  return starts ? { ...rest, wordStarts: starts } : rest;
}

// Join a segment with the one that follows it into a single timed caption.
export function mergeWithNext(segments: Segment[], index: number): Segment[] {
  const position = segments.findIndex((segment) => segment.index === index);
  const current = segments[position];
  const next = segments[position + 1];
  if (!current || !next) return segments;
  const merged: Segment = withWordStarts(
    {
      index: current.index,
      start: Math.min(current.start, next.start),
      end: Math.max(current.end, next.end),
      text: `${flattenText(current.text)} ${flattenText(next.text)}`.trim(),
    },
    (() => {
      const first = knownWordStarts(current);
      const second = knownWordStarts(next);
      return first && second ? [...first, ...second] : null;
    })(),
  );
  return reindex([
    ...segments.slice(0, position),
    merged,
    ...segments.slice(position + 2),
  ]);
}

export interface GroupOptions {
  maxChars?: number;
  maxGapMs?: number;
  maxDurationMs?: number;
}

// Combine consecutive short captions (e.g. word-by-word SRT exports) into
// readable phrases. A phrase ends at sentence punctuation, a pause longer than
// maxGapMs, or when adding the next caption would exceed maxChars/maxDurationMs.
export function groupShortSegments(
  segments: Segment[],
  {
    maxChars = MAX_CHARS_PER_LINE,
    maxGapMs = 700,
    maxDurationMs = 5000,
  }: GroupOptions = {},
): Segment[] {
  const grouped: Segment[] = [];
  let current: Segment | null = null;
  let currentStarts: number[] | null = null;

  for (const segment of segments) {
    if (!current) {
      current = { ...segment };
      currentStarts = knownWordStarts(segment);
      continue;
    }
    const currentText = flattenText(current.text);
    const nextText = flattenText(segment.text);
    const combined = `${currentText} ${nextText}`;
    const fits =
      nextText !== "" &&
      currentText !== "" &&
      !/[.!?…]["')\]]?$/.test(currentText) &&
      segment.start - current.end <= maxGapMs &&
      combined.length <= maxChars &&
      segment.end - current.start <= maxDurationMs;
    if (fits) {
      const nextStarts = knownWordStarts(segment);
      current = { ...current, end: Math.max(current.end, segment.end), text: combined };
      currentStarts =
        currentStarts && nextStarts ? [...currentStarts, ...nextStarts] : null;
    } else {
      grouped.push(withWordStarts(current, currentStarts));
      current = { ...segment };
      currentStarts = knownWordStarts(segment);
    }
  }
  if (current) grouped.push(withWordStarts(current, currentStarts));

  return reindex(grouped);
}

// True when most captions are a single word, i.e. a word-by-word transcript.
export function looksWordByWord(segments: Segment[]): boolean {
  if (segments.length < 4) return false;
  const single = segments.filter(
    (segment) => !/\s/.test(flattenText(segment.text)),
  ).length;
  return single / segments.length >= 0.6;
}

// Validate ordering, timing and the two-line rule across all segments.
export function validateSegments(segments: Segment[]): SegmentValidation[] {
  const results: SegmentValidation[] = [];

  segments.forEach((seg, i) => {
    const errors: string[] = [];
    if (seg.end <= seg.start) {
      errors.push("End must be greater than start.");
    }
    const prev = segments[i - 1];
    if (prev && seg.start < prev.end) {
      errors.push("Overlaps the previous segment.");
    }
    const { overflow } = wrapText(seg.text);
    if (overflow) {
      errors.push(`Text exceeds ${MAX_LINES} lines in the safe zone.`);
    }
    if (seg.text.trim() === "") {
      errors.push("Empty text.");
    }
    if (errors.length) results.push({ index: seg.index, errors });
  });

  return results;
}
