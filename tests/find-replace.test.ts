import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, replaceInSegments } from "../lib/find-replace";
import type { Segment } from "../lib/srt";

const seg = (index: number, text: string, wordStarts?: number[]): Segment => ({
  index,
  start: 0,
  end: 4000,
  text,
  ...(wordStarts ? { wordStarts } : {}),
});

test("finds matches ignoring case and across line breaks", () => {
  const segments = [seg(1, "open vs code now"), seg(2, "use VS\nCode today"), seg(3, "nothing")];
  const found = findMatches(segments, "VS Code");
  assert.equal(found.total, 2);
  assert.deepEqual([...found.perSegment.keys()], [1, 2]);
  assert.equal(findMatches(segments, "VS Code", { matchCase: true }).total, 1);
});

test("whole word does not match inside other words", () => {
  const segments = [seg(1, "a cat catalog cat.")];
  assert.equal(findMatches(segments, "cat", { wholeWord: true }).total, 2);
  assert.equal(findMatches(segments, "cat").total, 3);
});

test("replacement is literal and keeps word timing when counts match", () => {
  const original = seg(1, "abra o vscode agora", [0, 500, 1200, 2000]);
  const { segments, replaced } = replaceInSegments([original], "vscode", "VS$&Code");
  assert.equal(replaced, 1);
  assert.equal(segments[0].text, "abra o VS$&Code agora");
  assert.deepEqual(segments[0].wordStarts, [0, 500, 1200, 2000]);
});

test("a longer replacement shares the timing of the word it replaced", () => {
  const original = seg(1, "abra o vscode agora", [0, 500, 1200, 2000]);
  const { segments } = replaceInSegments([original], "vscode", "VS Code");
  assert.equal(segments[0].text, "abra o VS Code agora");
  assert.deepEqual(segments[0].wordStarts, [0, 500, 1200, 1200, 2000]);
});

test("deleting a word drops its timing and tidies spaces", () => {
  const original = seg(1, "bem hum vamos", [0, 400, 900]);
  const { segments } = replaceInSegments([original], "hum", "");
  assert.equal(segments[0].text, "bem vamos");
  assert.deepEqual(segments[0].wordStarts, [0, 900]);
});

test("only touches the requested captions", () => {
  const input = [seg(1, "foo"), seg(2, "foo")];
  const { segments, replaced } = replaceInSegments(input, "foo", "bar", {}, new Set([2]));
  assert.equal(replaced, 1);
  assert.deepEqual(segments.map((s) => s.text), ["foo", "bar"]);
});

test("an empty query changes nothing", () => {
  const input = [seg(1, "foo")];
  assert.equal(replaceInSegments(input, "  ", "x").replaced, 0);
  assert.equal(findMatches(input, "").total, 0);
});
