import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCaptions, parseVtt, serializeSrt, serializeVtt } from "../lib/srt";

const segments = [
  { index: 1, start: 1250, end: 3500, text: "First line\nSecond line" },
  { index: 2, start: 4000, end: 6000, text: "Next caption" },
];

test("imports SRT with CRLF, BOM and comma or dotted milliseconds", () => {
  const srt = serializeSrt(segments);
  assert.deepEqual(parseCaptions(`\uFEFF${srt.replace(/\n/g, "\r\n")}`), segments);
  assert.deepEqual(parseCaptions(srt.replace(/,/g, ".")), segments);
});

test("imports exported VTT with BOM and CRLF", () => {
  const vtt = serializeVtt(segments);
  assert.deepEqual(parseCaptions(vtt), segments);
  assert.deepEqual(parseCaptions(`\uFEFF${vtt.replace(/\n/g, "\r\n")}`), segments);
});

test("imports VTT cue identifiers, optional hours, settings and inline markup", () => {
  const vtt = `WEBVTT - captions

intro
00:01.250 --> 00:03.500 align:start position:10%
<v Speaker><b>First line</b></v>
<00:02.000>Second line

next
00:00:04.000 --> 00:00:06.000
Next caption
`;
  assert.deepEqual(parseCaptions(vtt), segments);
  assert.deepEqual(parseCaptions(serializeSrt(parseCaptions(vtt))), segments);
});

test("ignores VTT metadata blocks and handles whitespace-only blank lines", () => {
  const vtt = `WEBVTT

NOTE an ignored cue
00:01.000 --> 00:02.000
Not a caption

STYLE
::cue { color: white; }

REGION
id:bottom

00:01.250 --> 00:03.500
First line
Second line
  
00:04.000 --> 00:06.000
Next caption`;
  assert.deepEqual(parseCaptions(vtt), segments);
});

test("decodes VTT entities without interpreting escaped markup as tags", () => {
  const input = [{ index: 1, start: 0, end: 1000, text: "A & B < C > D &lt;" }];
  assert.deepEqual(parseCaptions(serializeVtt(input)), input);
  assert.equal(parseVtt("WEBVTT\n\n00:00.000 --> 00:01.000\nA&nbsp;B&lrm;&rlm;")[0].text, "A B");
});

test("rejects empty, unreadable and malformed caption content", () => {
  for (const content of ["", "not subtitles", "WEBVTT", "WEBVTT\n\nno timings"]) {
    assert.deepEqual(parseCaptions(content), []);
  }
  for (const timing of [
    "00:99.000 --> 00:01.000",
    "invalid 00:00.000 --> 00:01.000",
    "00:00.000 --> 00:01.000invalid",
  ]) {
    assert.deepEqual(parseCaptions(`WEBVTT\n\n${timing}\nCaption`), []);
  }
});
