"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CaptionStylePanel from "@/components/editor/CaptionStylePanel";
import CaptionTimeline from "@/components/editor/CaptionTimeline";
import SafeZoneOverlay from "@/components/SafeZoneOverlay";
import { readJsonResponse } from "@/lib/api-response";
import {
  DEFAULT_CAPTION_STYLE,
  normalizeCaptionStyle,
  type CaptionStyle,
} from "@/lib/caption-style";
import { Segment, validateSegments, wrapText } from "@/lib/srt";
import type { VideoInfo } from "@/lib/store";
import {
  classifyVideoFormat,
  type VideoFormat,
} from "@/lib/video-format";

type EditorTool = "style" | "captions";

function msToInput(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${minutes}:${remainder}.${millis}`;
}

function compactTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

function inputToMs(value: string): number {
  const match = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return Number.NaN;
  return (
    Number.parseInt(match[1], 10) * 60000 +
    Number.parseInt(match[2], 10) * 1000 +
    (match[3] ? Number.parseInt(match[3].padEnd(3, "0"), 10) : 0)
  );
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
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>({
    ...DEFAULT_CAPTION_STYLE,
  });
  const [currentMs, setCurrentMs] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool | null>("style");
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/segments/${jobId}`);
        const data = await readJsonResponse<{
          segments: Segment[];
          video?: VideoInfo;
          captionStyle?: CaptionStyle;
        }>(response);
        setSegments(data.segments);
        setVideo(data.video ?? null);
        setCaptionStyle(normalizeCaptionStyle(data.captionStyle));
        setSelectedIndex(data.segments[0]?.index ?? null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the project.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const issues = useMemo(() => validateSegments(segments), [segments]);
  const issueMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const issue of issues) map.set(issue.index, issue.errors);
    return map;
  }, [issues]);
  const format: VideoFormat =
    video?.format ??
    (video ? classifyVideoFormat(video.width, video.height) : "social");
  const activeSegment = useMemo(() => {
    const timed = segments.find(
      (segment) => currentMs >= segment.start && currentMs <= segment.end,
    );
    const selected = segments.find(
      (segment) => segment.index === selectedIndex,
    );
    return isPlaying ? timed : selected ?? timed;
  }, [currentMs, isPlaying, segments, selectedIndex]);
  const activeCaption = activeSegment
    ? wrapText(activeSegment.text).lines.join("\n")
    : "";

  const updateSegment = useCallback(
    (index: number, patch: Partial<Segment>) => {
      setSegments((current) =>
        current.map((segment) =>
          segment.index === index ? { ...segment, ...patch } : segment,
        ),
      );
    },
    [],
  );

  const seek = useCallback((milliseconds: number) => {
    const next = Math.max(0, milliseconds);
    setCurrentMs(next);
    if (videoRef.current) videoRef.current.currentTime = next / 1000;
  }, []);

  const selectSegment = useCallback(
    (segment: Segment) => {
      setSelectedIndex(segment.index);
      const nudge = Math.min(60, Math.max(0, (segment.end - segment.start) / 3));
      videoRef.current?.pause();
      seek(segment.start + nudge);
    },
    [seek],
  );

  const togglePlayback = useCallback(() => {
    const player = videoRef.current;
    if (!player) return;
    if (player.paused) void player.play();
    else player.pause();
  }, []);

  const breakIntoTwoLines = useCallback(
    (segment: Segment) => {
      const raw = segment.text.replace(/\s+/g, " ").trim();
      if (!raw.includes(" ")) return;
      const middle = Math.floor(raw.length / 2);
      const before = raw.lastIndexOf(" ", middle);
      const after = raw.indexOf(" ", middle + 1);
      const split =
        before === -1
          ? after
          : after !== -1 && after - middle < middle - before
            ? after
            : before;
      if (split <= 0) return;
      updateSegment(segment.index, {
        text: `${raw.slice(0, split)}\n${raw.slice(split + 1)}`,
      });
    },
    [updateSegment],
  );

  const splitInTime = useCallback((segment: Segment) => {
    const text = segment.text.replace(/\r/g, "");
    let firstText: string;
    let secondText: string;

    if (text.includes("\n")) {
      const breakIndex = text.indexOf("\n");
      firstText = text.slice(0, breakIndex).replace(/\s+/g, " ").trim();
      secondText = text.slice(breakIndex + 1).replace(/\s+/g, " ").trim();
    } else {
      const flat = text.replace(/\s+/g, " ").trim();
      const middle = Math.floor(flat.length / 2);
      const before = flat.lastIndexOf(" ", middle);
      const after = flat.indexOf(" ", middle + 1);
      const split =
        before === -1
          ? after
          : after !== -1 && after - middle < middle - before
            ? after
            : before;
      if (split <= 0) return;
      firstText = flat.slice(0, split).trim();
      secondText = flat.slice(split + 1).trim();
    }

    if (!firstText || !secondText) return;

    const duration = segment.end - segment.start;
    const ratio = firstText.length / (firstText.length + secondText.length);
    const midpoint = Math.round(segment.start + duration * ratio);

    setSegments((current) => {
      const next: Segment[] = [];
      for (const currentSegment of current) {
        if (currentSegment.index === segment.index) {
          next.push(
            {
              index: 0,
              start: segment.start,
              end: midpoint,
              text: firstText,
            },
            {
              index: 0,
              start: midpoint,
              end: segment.end,
              text: secondText,
            },
          );
        } else {
          next.push(currentSegment);
        }
      }
      return next.map((currentSegment, index) => ({
        ...currentSegment,
        index: index + 1,
      }));
    });
    setSelectedIndex(segment.index);
    seek(segment.start);
  }, [seek]);

  async function save(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/segments/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments, captionStyle }),
      });
      await readJsonResponse(response);
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the project.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function startRender() {
    setError(null);
    if (issues.length > 0) {
      setError("Review the highlighted segments before exporting.");
      setActiveTool("captions");
      return;
    }
    if (!(await save())) return;
    try {
      const response = await fetch(`/api/render/${jobId}`, { method: "POST" });
      await readJsonResponse(response);
      setStatus("queued");
      pollRender();
    } catch (renderError) {
      setError(
        renderError instanceof Error
          ? renderError.message
          : "Could not start the export.",
      );
    }
  }

  function pollRender() {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/status/${jobId}`);
        const data = await readJsonResponse<{
          status: string;
          progress?: number;
          error?: string | null;
        }>(response);
        setStatus(data.status);
        setProgress(data.progress ?? 0);
        if (data.status === "done" || data.status === "error") {
          window.clearInterval(timer);
          if (data.status === "error") {
            setError(data.error || "An error occurred during export.");
          }
        }
      } catch (pollError) {
        window.clearInterval(timer);
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Could not read the export status.",
        );
      }
    }, 1000);
  }

  if (loading) {
    return (
      <main className="editor-loading">
        <span className="spinner" />
        Preparing your review workspace…
      </main>
    );
  }

  return (
    <main className="studio-editor">
      <header className="studio-topbar">
        <a href="/" className="studio-home" aria-label="Back to home">⌂</a>
        <div className="studio-project-title">
          <strong>Caption Studio</strong>
          <span>project-{jobId.slice(0, 6)}.mp4</span>
        </div>
        <div className="studio-top-actions">
          <span className={`save-indicator ${saving ? "busy" : ""}`}>
            {saving ? "Saving…" : "Local changes"}
          </span>
          <button type="button" onClick={() => void save()} className="studio-save">
            Save
          </button>
          <button
            type="button"
            onClick={() => void startRender()}
            disabled={status === "queued" || status === "processing"}
            className="studio-export"
          >
            Export
          </button>
        </div>
      </header>

      {error && <div className="studio-error" role="alert">{error}</div>}
      {status && status !== "done" && (
        <div className="studio-render-progress">
          <span>Renderizando {progress}%</span>
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
      {status === "done" && (
        <a className="studio-download" href={`/api/download/${jobId}`}>
          Video ready — download file
        </a>
      )}

      <div
        className={`studio-body ${
          activeTool ? "sidebar-open" : "sidebar-closed"
        }`}
      >
        <nav className="studio-rail" aria-label="Editor tools">
          <button
            type="button"
            className={activeTool === "style" ? "active" : ""}
            onClick={() =>
              setActiveTool((current) => (current === "style" ? null : "style"))
            }
            title="Style"
          >
            ◩
          </button>
          <button
            type="button"
            className={activeTool === "captions" ? "active" : ""}
            onClick={() =>
              setActiveTool((current) =>
                current === "captions" ? null : "captions",
              )
            }
            title="Captions"
          >
            CC
          </button>
          <button
            type="button"
            className={showSafeZone ? "active-soft" : ""}
            onClick={() => setShowSafeZone((current) => !current)}
            aria-label="Toggle safe zone"
            aria-pressed={showSafeZone}
            title="Safe zone"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <rect
                x="6.5"
                y="7"
                width="11"
                height="10"
                rx="1"
                strokeDasharray="2 2"
              />
            </svg>
          </button>
          <span className="rail-spacer" />
          <span className={`format-rail-badge ${format}`}>
            {format === "long-form" ? "16:9" : "9:16"}
          </span>
        </nav>

        {activeTool && (
          <aside className="studio-sidebar">
            {activeTool === "style" ? (
              <CaptionStylePanel
                style={captionStyle}
                onChange={setCaptionStyle}
              />
            ) : (
              <div className="segments-side-panel">
              <div className="side-panel-heading">
                <span>CAPTIONS</span>
                <h2>{segments.length} segments</h2>
              </div>
              <div
                className={`side-validation ${
                  issues.length ? "has-errors" : ""
                }`}
              >
                {issues.length ? `${issues.length} to review` : "✓ All clear"}
              </div>
              <div className="side-segment-list">
                {segments.map((segment) => {
                  const segmentIssues = issueMap.get(segment.index) ?? [];
                  return (
                    <button
                      key={segment.index}
                      type="button"
                      className={`side-segment ${
                        selectedIndex === segment.index ? "active" : ""
                      } ${segmentIssues.length ? "has-errors" : ""}`}
                      onClick={() => selectSegment(segment)}
                    >
                      <span>
                        #{String(segment.index).padStart(2, "0")}
                        <small>{compactTime(segment.start)}</small>
                      </span>
                      <strong>{segment.text}</strong>
                    </button>
                  );
                })}
              </div>
              </div>
            )}
          </aside>
        )}

        <section className="studio-canvas">
          <div className="canvas-toolbar">
            <div className="ratio-switcher">
              <button
                type="button"
                className={format === "long-form" ? "active" : ""}
                disabled
              >
                ▭
              </button>
              <button
                type="button"
                className={format === "social" ? "active" : ""}
                disabled
              >
                ▯
              </button>
            </div>
            <label className="canvas-safe-toggle">
              <input
                type="checkbox"
                checked={showSafeZone}
                onChange={(event) => setShowSafeZone(event.target.checked)}
              />
              Safe zone
            </label>
          </div>

          <div className={`canvas-video-area ${format}`}>
            <div
              className="studio-video-frame"
              style={{
                aspectRatio: video
                  ? `${video.width} / ${video.height}`
                  : "9 / 16",
              }}
            >
              <video
                ref={videoRef}
                src={`/api/preview/${jobId}`}
                className="studio-video"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onTimeUpdate={(event) =>
                  setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))
                }
              />
              <SafeZoneOverlay
                caption={activeCaption}
                format={format}
                showGuides={showSafeZone}
                captionStyle={captionStyle}
              />
            </div>
          </div>

          <div className="playback-bar">
            <span>
              {compactTime(currentMs)} / {compactTime(video?.durationMs ?? 0)}
            </span>
            <div>
              <button type="button" onClick={() => seek(currentMs - 5000)}>↶ 5</button>
              <button
                type="button"
                className="play-button"
                onClick={togglePlayback}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? "Ⅱ" : "▶"}
              </button>
              <button type="button" onClick={() => seek(currentMs + 5000)}>5 ↷</button>
            </div>
            <span>
              {video?.width ?? 0} × {video?.height ?? 0}
            </span>
          </div>
        </section>

        <CaptionTimeline
          segments={segments}
          durationMs={video?.durationMs ?? 0}
          currentMs={currentMs}
          selectedIndex={selectedIndex}
          onSelect={selectSegment}
        />
      </div>

      <section className="studio-edit-strip">
        <div className="segment-editor-toolbar">
          <div>
            <button
              type="button"
              className="active"
              onClick={() => setActiveTool("captions")}
            >
              ✎ Edit caption
            </button>
            <span>
              {activeSegment
                ? `Segment #${String(activeSegment.index).padStart(2, "0")}`
                : "Select a segment"}
            </span>
          </div>
          {activeSegment && (
            <div className="segment-editor-actions">
              <button
                type="button"
                onClick={() => breakIntoTwoLines(activeSegment)}
              >
                ↵ Break line
              </button>
              <button
                type="button"
                onClick={() => splitInTime(activeSegment)}
              >
                ✂ Split timing
              </button>
            </div>
          )}
        </div>

        {activeSegment && (
          <div className="inline-segment-editor">
            <div className="inline-timing">
              <input
                key={`start-${activeSegment.index}-${activeSegment.start}`}
                defaultValue={msToInput(activeSegment.start)}
                onBlur={(event) => {
                  const next = inputToMs(event.target.value);
                  if (!Number.isNaN(next)) {
                    updateSegment(activeSegment.index, { start: next });
                  }
                }}
                aria-label="Caption start"
              />
              <span>→</span>
              <input
                key={`end-${activeSegment.index}-${activeSegment.end}`}
                defaultValue={msToInput(activeSegment.end)}
                onBlur={(event) => {
                  const next = inputToMs(event.target.value);
                  if (!Number.isNaN(next)) {
                    updateSegment(activeSegment.index, { end: next });
                  }
                }}
                aria-label="Caption end"
              />
            </div>
            <textarea
              value={activeSegment.text}
              onFocus={() => selectSegment(activeSegment)}
              onChange={(event) =>
                updateSegment(activeSegment.index, { text: event.target.value })
              }
              rows={2}
              aria-label="Selected caption text"
            />
            <span
              className={
                issueMap.has(activeSegment.index) ? "inline-issue error" : "inline-issue"
              }
            >
              {issueMap.get(activeSegment.index)?.join(" ") ??
                `${wrapText(activeSegment.text).lines.length}/2 lines`}
            </span>
          </div>
        )}
      </section>

    </main>
  );
}
