import type { Segment } from "./srt";

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whitespace in the query matches any run of whitespace, so "VS Code" also
// finds a caption that wraps between the two words.
function buildPattern(query: string, { matchCase, wholeWord }: FindOptions): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let source = words.map(escapeRegExp).join("\\s+");
  if (wholeWord) source = `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])`;
  return new RegExp(source, matchCase ? "gu" : "giu");
}

export interface MatchSummary {
  total: number;
  // Caption index -> number of matches in it.
  perSegment: Map<number, number>;
}

export function findMatches(
  segments: Segment[],
  query: string,
  options: FindOptions = {},
): MatchSummary {
  const perSegment = new Map<number, number>();
  const pattern = buildPattern(query, options);
  let total = 0;
  if (pattern) {
    for (const segment of segments) {
      const count = [...segment.text.matchAll(pattern)].length;
      if (count > 0) {
        perSegment.set(segment.index, count);
        total += count;
      }
    }
  }
  return { total, perSegment };
}

interface Piece {
  oldStart: number;
  newStart: number;
  length: number;
  replaced: boolean;
}

// Word starts (ms) of the old text re-attached to the words of the new text.
// A new word inherits the timing of the old word at the same position, or at
// the start of the replaced span it falls in.
function remapWordStarts(
  oldText: string,
  newText: string,
  pieces: Piece[],
  wordStarts: number[],
): number[] | undefined {
  const oldWords = [...oldText.matchAll(/\S+/g)].map((match) => match.index ?? 0);
  if (oldWords.length !== wordStarts.length) return undefined;
  const newWords = [...newText.matchAll(/\S+/g)].map((match) => match.index ?? 0);

  return newWords.map((position) => {
    const piece =
      pieces.find((item) => position >= item.newStart && position < item.newStart + item.length) ??
      pieces[pieces.length - 1];
    const oldPosition = piece
      ? piece.replaced
        ? piece.oldStart
        : piece.oldStart + (position - piece.newStart)
      : 0;
    let index = 0;
    for (let i = 0; i < oldWords.length; i++) {
      if (oldWords[i] <= oldPosition) index = i;
    }
    return wordStarts[index];
  });
}

function replaceInText(
  text: string,
  pattern: RegExp,
  replacement: string,
): { text: string; count: number; pieces: Piece[] } {
  const pieces: Piece[] = [];
  let result = "";
  let cursor = 0;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > cursor) {
      pieces.push({
        oldStart: cursor,
        newStart: result.length,
        length: at - cursor,
        replaced: false,
      });
      result += text.slice(cursor, at);
    }
    pieces.push({
      oldStart: at,
      newStart: result.length,
      length: replacement.length,
      replaced: true,
    });
    result += replacement;
    cursor = at + match[0].length;
    count += 1;
  }
  if (cursor < text.length) {
    pieces.push({
      oldStart: cursor,
      newStart: result.length,
      length: text.length - cursor,
      replaced: false,
    });
    result += text.slice(cursor);
  }
  return { text: result, count, pieces };
}

// Removing text can leave doubled spaces or a blank line behind.
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

export interface ReplaceResult {
  segments: Segment[];
  replaced: number;
}

// Replace every match (or only the captions listed in `only`). The replacement
// is literal text. Captions keep their timing, including per-word timing when
// the words can still be matched up.
export function replaceInSegments(
  segments: Segment[],
  query: string,
  replacement: string,
  options: FindOptions = {},
  only?: ReadonlySet<number>,
): ReplaceResult {
  const pattern = buildPattern(query, options);
  if (!pattern) return { segments, replaced: 0 };
  const literal = replacement.replace(/\s*\n\s*/g, " ");
  let replaced = 0;

  const next = segments.map((segment) => {
    if (only && !only.has(segment.index)) return segment;
    const result = replaceInText(segment.text, pattern, literal);
    if (result.count === 0) return segment;
    replaced += result.count;

    const { wordStarts, ...rest } = segment;
    const remapped = wordStarts
      ? remapWordStarts(segment.text, result.text, result.pieces, wordStarts)
      : undefined;
    const text = tidy(result.text);
    return remapped && remapped.length === (text.match(/\S+/g) ?? []).length
      ? { ...rest, text, wordStarts: remapped }
      : { ...rest, text };
  });

  return { segments: next, replaced };
}
