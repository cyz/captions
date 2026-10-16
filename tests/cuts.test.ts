import assert from "node:assert/strict";
import { test } from "node:test";
import { isCovered, keptRanges, mapTime, normalizeCuts, remapSegments, totalCutMs } from "../lib/cuts";
import { applyCleanup, DEFAULT_CLEANUP, findCleanupCandidates } from "../lib/cleanup";
import { detectSilences } from "../lib/silence";
import type { Segment } from "../lib/srt";

test("normalizes, merges and clamps cuts", () => {
  const cuts = normalizeCuts(
    [
      { start: 3000, end: 4000 },
      { start: 1000, end: 2000 },
      { start: 1900, end: 2500 },
      { start: 5000, end: 5010 },
      { start: 9000, end: 99999 },
    ],
    10000,
  );
  assert.deepEqual(cuts, [
    { start: 1000, end: 2500 },
    { start: 3000, end: 4000 },
    { start: 9000, end: 10000 },
  ]);
  assert.equal(totalCutMs(cuts), 3500);
});

test("maps source time to the exported timeline", () => {
  const cuts = [{ start: 1000, end: 2000 }, { start: 3000, end: 3500 }];
  assert.equal(mapTime(cuts, 500), 500);
  assert.equal(mapTime(cuts, 1500), 1000);
  assert.equal(mapTime(cuts, 2000), 1000);
  assert.equal(mapTime(cuts, 4000), 2500);
  assert.deepEqual(keptRanges(cuts, 5000), [
    { start: 0, end: 1000 },
    { start: 2000, end: 3000 },
    { start: 3500, end: 5000 },
  ]);
  assert.ok(isCovered(cuts, { start: 1200, end: 1800 }));
  assert.ok(!isCovered(cuts, { start: 900, end: 1800 }));
});

test("remaps captions and drops the ones fully removed", () => {
  const cuts = [{ start: 1000, end: 2000 }];
  const segments: Segment[] = [
    { index: 1, start: 0, end: 900, text: "a" },
    { index: 2, start: 1100, end: 1900, text: "b" },
    { index: 3, start: 2000, end: 3000, text: "c d", wordStarts: [2000, 2500] },
  ];
  const result = remapSegments(segments, cuts);
  assert.deepEqual(result.map((s) => [s.index, s.start, s.end]), [[1, 0, 900], [2, 1000, 2000]]);
  assert.deepEqual(result[1].wordStarts, [1000, 1500]);
});

function tone(seconds: number, amplitude: number, rate = 16000): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / rate);
  return out;
}

test("detects pauses between speech", () => {
  const rate = 16000;
  const audio = new Float32Array(rate * 6);
  audio.set(tone(2, 0.3), 0);
  audio.set(tone(2, 0.3), rate * 4);
  const silences = detectSilences(audio, rate);
  assert.equal(silences.length, 1);
  assert.ok(Math.abs(silences[0][0] - 2000) <= 40);
  assert.ok(Math.abs(silences[0][1] - 4000) <= 40);
});

test("ignores short gaps and silent files", () => {
  const rate = 16000;
  const audio = new Float32Array(rate * 3);
  audio.set(tone(1, 0.3), 0);
  audio.set(tone(1.7, 0.3), Math.round(rate * 1.3));
  assert.deepEqual(detectSilences(audio, rate), []);
  assert.deepEqual(detectSilences(new Float32Array(rate * 3), rate), []);
});

const words = (text: string, starts: number[]): Segment => ({
  index: 1,
  start: starts[0],
  end: starts[starts.length - 1] + 400,
  text,
  wordStarts: starts,
});

test("finds hesitations per language without touching real words", () => {
  const pt = [words("Então hum vamos ver um exemplo ééé", [0, 400, 800, 1200, 1500, 2000, 2400])];
  const found = findCleanupCandidates(pt, [], [], { ...DEFAULT_CLEANUP, language: "pt" });
  assert.deepEqual(found.map((c) => c.label), ["“hum”", "“ééé”"]);

  const en = [words("So um we like use um this", [0, 300, 600, 800, 1000, 1300, 1600, 1900].slice(0, 7))];
  const enFound = findCleanupCandidates(en, [], [], { ...DEFAULT_CLEANUP, language: "en" });
  assert.equal(enFound.length, 2);
  const withFillers = findCleanupCandidates(en, [], [], { ...DEFAULT_CLEANUP, language: "en", fillers: true });
  assert.equal(withFillers.length, 3);
});

test("custom words are matched ignoring case and punctuation", () => {
  const found = findCleanupCandidates(
    [words("Right, okay so", [0, 300, 700])],
    [],
    [],
    { ...DEFAULT_CLEANUP, hesitations: false, customWords: ["right", "OKAY"] },
  );
  assert.equal(found.length, 2);
});

test("pauses keep a natural gap and skip ones already cut", () => {
  const silences: Array<[number, number]> = [[1000, 3000], [5000, 5500], [8000, 10000]];
  const found = findCleanupCandidates([], silences, [{ start: 8100, end: 9900 }], DEFAULT_CLEANUP);
  assert.deepEqual(found.map((c) => [c.start, c.end]), [[1150, 2850]]);
});

test("applying cleanup removes the words and merges the cuts", () => {
  const segments = [words("bem hum vamos", [0, 400, 900]), words("hum", [2000])];
  segments[1].index = 2;
  const found = findCleanupCandidates(segments, [[1200, 2000]], [], {
    ...DEFAULT_CLEANUP,
    silenceMinMs: 500,
    keepMs: 100,
    language: "pt",
  });
  const result = applyCleanup(segments, [], found, 5000);
  assert.deepEqual(result.segments.map((s) => s.text), ["bem vamos"]);
  assert.deepEqual(result.segments[0].wordStarts, [0, 900]);
  assert.equal(result.cuts.length >= 2, true);
  assert.ok(result.cuts.some((cut) => cut.start === 400 && cut.end === 900));
});
