"use client";

import { useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import SafeZoneOverlay from "@/components/SafeZoneOverlay";
import { readJsonResponse } from "@/lib/api-response";
import { Segment, wrapText, validateSegments } from "@/lib/srt";
import type { VideoInfo } from "@/lib/store";

function msToInput(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${mm}:${ss}.${millis}`;
}

function inputToMs(value: string): number {
  const m = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!m) return NaN;
  const mm = parseInt(m[1], 10);
  const ss = parseInt(m[2], 10);
  const millis = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
  return mm * 60000 + ss * 1000 + millis;
}

export default function EditorPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/segments/${jobId}`);
        const data = await readJsonResponse<{
          segments: Segment[];
          video?: VideoInfo;
        }>(res);
        setSegments(data.segments);
        setVideo(data.video ?? null);
      } catch (err) {
        setRenderError(
          err instanceof Error ? err.message : "Failed to load the captions.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const issues = useMemo(() => validateSegments(segments), [segments]);
  const issueMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const it of issues) map.set(it.index, it.errors);
    return map;
  }, [issues]);

  const activeCaption = useMemo(() => {
    // Show the caption under the playhead during playback; otherwise show the
    // segment the user clicked so it appears on screen while editing.
    const timeSeg = segments.find(
      (s) => currentMs >= s.start && currentMs <= s.end,
    );
    const seg =
      timeSeg ??
      (selectedIndex != null
        ? segments.find((s) => s.index === selectedIndex)
        : undefined);
    if (!seg) return "";
    return wrapText(seg.text).lines.join("\n");
  }, [segments, currentMs, selectedIndex]);

  const updateSegment = useCallback(
    (index: number, patch: Partial<Segment>) => {
      setSegments((prev) =>
        prev.map((s) => (s.index === index ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  // Select a segment: show its caption and jump the video to the exact instant
  // the caption appears (paused), landing just inside the segment window.
  const selectSegment = useCallback((seg: Segment) => {
    setSelectedIndex(seg.index);
    setCurrentMs(seg.start);
    const v = videoRef.current;
    if (v) {
      v.pause();
      const nudge = Math.min(60, Math.max(0, (seg.end - seg.start) / 3));
      v.currentTime = (seg.start + nudge) / 1000;
    }
  }, []);

  // Break the text into two balanced lines at the nearest word boundary so it
  // stays within the two-line safe-zone pattern.
  const breakIntoTwoLines = useCallback(
    (seg: Segment) => {
      const raw = seg.text.replace(/\s+/g, " ").trim();
      if (!raw.includes(" ")) return;
      const mid = Math.floor(raw.length / 2);
      const before = raw.lastIndexOf(" ", mid);
      const after = raw.indexOf(" ", mid + 1);
      let split = before;
      if (before === -1) split = after;
      else if (after !== -1 && after - mid < mid - before) split = after;
      if (split <= 0) return;
      const next = `${raw.slice(0, split)}\n${raw.slice(split + 1)}`;
      updateSegment(seg.index, { text: next });
    },
    [updateSegment],
  );

  // Split a caption into two captions across time (useful when text would need
  // three lines). Splits at the manual break if present, else at the middle
  // word, and divides the time window proportionally to each part's length.
  const splitInTime = useCallback((seg: Segment) => {
    const text = seg.text.replace(/\r/g, "");
    let firstText: string;
    let secondText: string;
    if (text.includes("\n")) {
      const idx = text.indexOf("\n");
      firstText = text.slice(0, idx).replace(/\s+/g, " ").trim();
      secondText = text.slice(idx + 1).replace(/\s+/g, " ").trim();
    } else {
      const flat = text.replace(/\s+/g, " ").trim();
      const mid = Math.floor(flat.length / 2);
      const before = flat.lastIndexOf(" ", mid);
      const after = flat.indexOf(" ", mid + 1);
      let split = before;
      if (before === -1) split = after;
      else if (after !== -1 && after - mid < mid - before) split = after;
      if (split <= 0) return;
      firstText = flat.slice(0, split).trim();
      secondText = flat.slice(split + 1).trim();
    }
    if (!firstText || !secondText) return;

    const dur = seg.end - seg.start;
    const ratio = firstText.length / (firstText.length + secondText.length);
    const mid = Math.round(seg.start + dur * ratio);
    const first: Segment = { index: 0, start: seg.start, end: mid, text: firstText };
    const second: Segment = { index: 0, start: mid, end: seg.end, text: secondText };

    setSegments((prev) => {
      const out: Segment[] = [];
      for (const s of prev) {
        if (s.index === seg.index) out.push(first, second);
        else out.push(s);
      }
      return out.map((s, i) => ({ ...s, index: i + 1 }));
    });
  }, []);

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch(`/api/segments/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments }),
      });
      await readJsonResponse(res);
      return true;
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : "Failed to save the captions.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function startRender() {
    setRenderError(null);
    if (issues.length > 0) {
      setRenderError("Fix the highlighted segments before finishing.");
      return;
    }
    const ok = await save();
    if (!ok) {
      setRenderError("Failed to save the captions.");
      return;
    }
    const res = await fetch(`/api/render/${jobId}`, { method: "POST" });
    await readJsonResponse<{ status: string }>(res);
    setStatus("queued");
    poll();
  }

  function poll() {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        const data = await readJsonResponse<{
          status: string;
          progress?: number;
          error?: string | null;
        }>(res);
        setStatus(data.status);
        setProgress(data.progress ?? 0);
        if (data.status === "done" || data.status === "error") {
          clearInterval(timer);
          if (data.status === "error") {
            setRenderError(data.error || "Rendering error.");
          }
        }
      } catch (err) {
        clearInterval(timer);
        setRenderError(
          err instanceof Error ? err.message : "Failed to read rendering status.",
        );
      }
    }, 1000);
  }

  if (loading) {
    return <main className="p-8 text-sm text-neutral-400">Loading…</main>;
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[360px_1fr]">
      {/* Preview */}
      <section className="lg:sticky lg:top-10 lg:self-start">
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            src={`/api/preview/${jobId}`}
            controls
            className="h-full w-full object-contain"
            onTimeUpdate={(e) =>
              setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))
            }
          />
          <SafeZoneOverlay caption={activeCaption} />
        </div>
        {video && (
          <p className="mt-3 text-center text-xs text-neutral-500">
            {video.width}×{video.height}
            {video.isVertical916 ? " · 9:16 ✓" : " · not 9:16 ⚠"}
          </p>
        )}
      </section>

      {/* Editor */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Edit captions</h1>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={startRender}
              disabled={status === "processing" || status === "queued"}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              Finish and render
            </button>
          </div>
        </div>

        {renderError && <p className="mb-4 text-sm text-red-400">{renderError}</p>}

        {status && (
          <div className="mb-6 rounded-md border border-neutral-800 bg-neutral-900 p-4">
            {status === "done" ? (
              <a
                href={`/api/download/${jobId}`}
                className="inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
              >
                Download video with captions
              </a>
            ) : (
              <div>
                <p className="text-sm capitalize text-neutral-300">
                  {status}… {progress}%
                </p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-neutral-800">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <ul className="space-y-3">
          {segments.map((seg) => {
            const errs = issueMap.get(seg.index) ?? [];
            const { lines, overflow } = wrapText(seg.text);
            const selected = selectedIndex === seg.index;
            return (
              <li
                key={seg.index}
                onClick={() => selectSegment(seg)}
                className={`cursor-pointer rounded-md border p-3 transition-colors ${
                  errs.length
                    ? "border-red-500/60 bg-red-500/5"
                    : selected
                      ? "border-indigo-500 bg-indigo-500/5"
                      : "border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
                  <span className="font-mono">#{seg.index}</span>
                  <input
                    defaultValue={msToInput(seg.start)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const ms = inputToMs(e.target.value);
                      if (!Number.isNaN(ms)) updateSegment(seg.index, { start: ms });
                    }}
                    className="w-24 rounded bg-neutral-900 px-2 py-1 font-mono text-neutral-200"
                  />
                  <span>→</span>
                  <input
                    defaultValue={msToInput(seg.end)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const ms = inputToMs(e.target.value);
                      if (!Number.isNaN(ms)) updateSegment(seg.index, { end: ms });
                    }}
                    className="w-24 rounded bg-neutral-900 px-2 py-1 font-mono text-neutral-200"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      selectSegment(seg);
                    }}
                    className="ml-auto rounded px-2 py-1 hover:bg-neutral-800"
                  >
                    ▶ show on screen
                  </button>
                </div>
                <textarea
                  value={seg.text}
                  onFocus={() => selectSegment(seg)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateSegment(seg.index, { text: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded bg-neutral-900 p-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className={overflow ? "text-red-400" : "text-neutral-500"}>
                    {lines.length}/2 lines
                  </span>
                  <div className="flex items-center gap-2">
                    {errs.length > 0 && (
                      <span className="text-red-400">{errs.join(" ")}</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        breakIntoTwoLines(seg);
                      }}
                      className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
                    >
                      ↵ Break line
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        splitInTime(seg);
                      }}
                      className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
                    >
                      ✂ Split in time
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
