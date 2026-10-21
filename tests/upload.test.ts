import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/upload/route";

test("rejects invalid caption uploads instead of falling back to automatic captions", async (t) => {
  const originalStorage = process.env.CAPTION_STORAGE;
  const originalNetlify = process.env.NETLIFY;
  delete process.env.NETLIFY;
  t.after(() => {
    if (originalStorage === undefined) delete process.env.CAPTION_STORAGE;
    else process.env.CAPTION_STORAGE = originalStorage;
    if (originalNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = originalNetlify;
  });

  for (const mode of ["local", "azure"]) {
    process.env.CAPTION_STORAGE = mode;
    for (const { content, status } of [
      { content: "", status: 400 },
      { content: "not a caption file", status: 400 },
      { content: "WEBVTT\n\nno cues", status: 400 },
      { content: "a".repeat(2 * 1024 * 1024 + 1), status: 413 },
    ]) {
      await t.test(`${mode}: rejects ${content.length} bytes with ${status}`, async () => {
        let request: NextRequest;
        if (mode === "azure") {
          request = new NextRequest("http://localhost/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              srtText: content,
              video: { size: 100, width: 320, height: 180, durationMs: 2000 },
            }),
          });
        } else {
          const form = new FormData();
          form.append("video", new File(["video"], "video.mp4"));
          form.append("srt", new File([content], "captions.vtt"));
          request = new NextRequest("http://localhost/api/upload", {
            method: "POST",
            body: form,
          });
        }
        const response = await POST(request);
        assert.equal(response.status, status);
        const body = await response.json();
        assert.equal(typeof body.error, "string");
        assert.equal(body.jobId, undefined);
      });
    }
  }
});
