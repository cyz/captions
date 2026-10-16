import { Cut, isCovered, normalizeCuts } from "./cuts";
import type { Silence } from "./silence";
import { Segment, segmentWords, wordTimings } from "./srt";

export interface CleanupOptions {
  // Pauses at least this long are shortened.
  silenceMinMs: number;
  // Natural pause kept on each side of a shortened pause.
  keepMs: number;
  hesitations: boolean;
  fillers: boolean;
  customWords: string[];
  // ISO 639-1 code of the spoken language.
  language?: string;
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  silenceMinMs: 700,
  keepMs: 150,
  hesitations: true,
  fillers: false,
  customWords: [],
};

export type CandidateKind = "silence" | "hesitation" | "filler" | "custom";

export interface CleanupCandidate {
  id: string;
  kind: CandidateKind;
  // Range of the source video that is cut.
  start: number;
  end: number;
  label: string;
  // Set for words, which are also removed from the caption text.
  segmentIndex?: number;
  wordIndex?: number;
}

// Sounds of hesitation. Words that are also real words ("um" in Portuguese)
// are left out on purpose.
const HESITATIONS: Record<string, RegExp> = {
  en: /^(?:u+m+|u+h+m*|e+r+m*|h+m+|m+h*m+|a+h+m+)$/,
  pt: /^(?:a+h+n+|h+ã+|h+u+m+|h+m+|u+h+m+|é+h+|é{2,}|e+h+m*|ã+h*m*)$/,
  es: /^(?:e+h+m*|e{2,}|e+m+|u+m+|h+m+|m+h*m+)$/,
};

// Words people lean on. Off by default because they can carry meaning.
const FILLERS: Record<string, string[]> = {
  en: ["like", "basically", "literally", "actually", "honestly"],
  pt: ["né", "tipo", "sabe", "entendeu", "daí"],
  es: ["pues", "bueno", "sabes"],
};

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function languageKey(language?: string): string {
  const code = (language ?? "en").toLowerCase().slice(0, 2);
  return code in HESITATIONS ? code : "en";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function findCleanupCandidates(
  segments: Segment[],
  silences: ReadonlyArray<Silence>,
  existingCuts: ReadonlyArray<Cut>,
  options: CleanupOptions,
): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];
  const key = languageKey(options.language);
  const hesitation = HESITATIONS[key];
  const fillers = new Set(FILLERS[key] ?? []);
  const custom = new Set(options.customWords.map(normalize).filter(Boolean));

  for (const [start, end] of silences) {
    if (end - start < options.silenceMinMs) continue;
    const range = { start: start + options.keepMs, end: end - options.keepMs };
    if (range.end - range.start < 150 || isCovered(existingCuts, range)) continue;
    candidates.push({
      id: `silence:${start}`,
      kind: "silence",
      start: range.start,
      end: range.end,
      label: `Pause ${seconds(end - start)}`,
    });
  }

  for (const segment of segments) {
    wordTimings(segment).forEach((word, wordIndex) => {
      const token = normalize(word.text);
      if (!token) return;
      const kind: CandidateKind | null = custom.has(token)
        ? "custom"
        : options.hesitations && hesitation.test(token)
          ? "hesitation"
          : options.fillers && fillers.has(token)
            ? "filler"
            : null;
      if (!kind) return;
      candidates.push({
        id: `word:${segment.index}:${wordIndex}`,
        kind,
        start: word.start,
        end: word.end,
        label: `“${word.text.replace(/[^\p{L}\p{N}'-]/gu, "")}”`,
        segmentIndex: segment.index,
        wordIndex,
      });
    });
  }

  return candidates.sort((a, b) => a.start - b.start);
}

// Drop the given words (by position) from a caption, keeping its line breaks
// and the timing of the words that stay.
function removeWords(segment: Segment, remove: ReadonlySet<number>): Segment | null {
  const total = segmentWords(segment.text).length;
  let position = 0;
  const lines = segment.text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      (line.match(/\S+/g) ?? [])
        .filter(() => !remove.has(position++))
        .join(" "),
    )
    .filter((line) => line !== "");
  if (lines.length === 0) return null;

  const { wordStarts, ...rest } = segment;
  const keptStarts =
    wordStarts?.length === total
      ? wordStarts.filter((_, index) => !remove.has(index))
      : undefined;
  return { ...rest, text: lines.join("\n"), ...(keptStarts ? { wordStarts: keptStarts } : {}) };
}

export interface CleanupResult {
  segments: Segment[];
  cuts: Cut[];
}

// Apply the chosen candidates: remove the spoken words from the captions and
// add every range to the cut list. Captions stay on the source timeline.
export function applyCleanup(
  segments: Segment[],
  existingCuts: ReadonlyArray<Cut>,
  chosen: ReadonlyArray<CleanupCandidate>,
  durationMs: number,
): CleanupResult {
  const wordsToRemove = new Map<number, Set<number>>();
  for (const candidate of chosen) {
    if (candidate.segmentIndex === undefined || candidate.wordIndex === undefined) continue;
    const set = wordsToRemove.get(candidate.segmentIndex) ?? new Set<number>();
    set.add(candidate.wordIndex);
    wordsToRemove.set(candidate.segmentIndex, set);
  }

  const next: Segment[] = [];
  for (const segment of segments) {
    const remove = wordsToRemove.get(segment.index);
    const updated = remove ? removeWords(segment, remove) : segment;
    if (updated) next.push(updated);
  }

  return {
    segments: next.map((segment, i) => ({ ...segment, index: i + 1 })),
    cuts: normalizeCuts(
      [...existingCuts, ...chosen.map(({ start, end }) => ({ start, end }))],
      durationMs,
    ),
  };
}
