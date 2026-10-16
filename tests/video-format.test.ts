import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyVideoFormat, getFormatProfile } from "../lib/video-format";
import { wrapText, validateSegments } from "../lib/srt";

test("classifies aspect ratios", () => {
  assert.equal(classifyVideoFormat(1920, 1080), "long-form");
  assert.equal(classifyVideoFormat(1280, 960), "long-form");
  assert.equal(classifyVideoFormat(1080, 1920), "social");
  assert.equal(classifyVideoFormat(1080, 1080), "social");
  assert.equal(classifyVideoFormat(1080, 1350), "social");
  assert.equal(classifyVideoFormat(0, 0), "social");
});

test("long-form allows longer lines than social", () => {
  const text = "this sentence has exactly thirty-nine ch";
  assert.equal(text.length, 40);
  assert.equal(wrapText(text, "social").lines.length, 2);
  assert.deepEqual(wrapText(text, "long-form").lines, [text]);
  assert.equal(getFormatProfile("long-form").boxMode, "hug");
});

test("validation uses the format's line limit", () => {
  const line = "a".repeat(40);
  const segments = [{ index: 1, start: 0, end: 1000, text: `${line}\n${line}` }];
  assert.equal(validateSegments(segments, "social").length, 1);
  assert.equal(validateSegments(segments, "long-form").length, 0);
});

test("VTT uses dotted timestamps and escapes markup", async () => {
  const { serializeVtt } = await import("../lib/srt");
  const vtt = serializeVtt([{ index: 1, start: 1500, end: 3200, text: "A & B <c>" }]);
  assert.equal(vtt, "WEBVTT\n\n00:00:01.500 --> 00:00:03.200\nA &amp; B &lt;c&gt;\n");
});
