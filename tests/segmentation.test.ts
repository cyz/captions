import assert from "node:assert/strict";
import { test } from "node:test";
import { wordsToSegments, type TimedWord } from "../lib/segmentation";
import { validateSegments, wordTimings } from "../lib/srt";
import { dropRepeatedWords, findSliceBoundaries } from "../lib/transcribe";

function words(text: string, startMs = 0, stepMs = 300): TimedWord[] {
  return text.split(" ").map((word, i) => ({
    text: word,
    start: startMs + i * stepMs,
    end: startMs + i * stepMs + stepMs - 30,
  }));
}

test("splits on pauses and sentence ends", () => {
  const input = [
    ...words("Hello everyone and welcome back.", 0),
    ...words("Today we talk about captions", 4000),
  ];
  const segments = wordsToSegments(input, { format: "long-form" });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "Hello everyone and welcome back.");
  assert.equal(segments[1].start, 4000);
  assert.deepEqual(segments[0].wordStarts, [0, 300, 600, 900, 1200]);
});

test("segments respect the format limits and never overlap", () => {
  const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  for (const format of ["social", "long-form"] as const) {
    const segments = wordsToSegments(words(text), { format });
    assert.ok(segments.length > 1);
    assert.deepEqual(validateSegments(segments, format), []);
    for (const segment of segments) {
      assert.equal(wordTimings(segment).length, segment.text.split(/\s+/).length);
    }
  }
});

test("long-form fits more text per caption than social", () => {
  const text = Array.from({ length: 40 }, () => "caption").join(" ");
  const social = wordsToSegments(words(text, 0, 100), { format: "social" });
  const longForm = wordsToSegments(words(text, 0, 100), { format: "long-form" });
  assert.ok(longForm.length < social.length);
});

test("balances two-line captions", () => {
  const [segment] = wordsToSegments(
    words("this is a fairly long caption that needs two lines"),
    { format: "social" },
  );
  const [first, second] = segment.text.split("\n");
  assert.ok(first && second);
  assert.ok(Math.abs(first.length - second.length) < 10);
});

test("drops runaway repeated words", () => {
  const looped = words("no no no no no no stop");
  assert.equal(dropRepeatedWords(looped).length, 4);
});

test("slice boundaries cover the audio in order", () => {
  const samples = new Float32Array(16000 * 300).fill(0.1);
  const boundaries = findSliceBoundaries(samples);
  assert.equal(boundaries[0], 0);
  assert.equal(boundaries[boundaries.length - 1], samples.length);
  assert.ok(boundaries.every((value, i) => i === 0 || value > boundaries[i - 1]));
});
