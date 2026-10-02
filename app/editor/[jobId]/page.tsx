"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CaptionStylePanel from "@/components/editor/CaptionStylePanel";
import CaptionTimeline from "@/components/editor/CaptionTimeline";
import TimeField from "@/components/editor/TimeField";
import SafeZoneOverlay from "@/components/SafeZoneOverlay";
import { readJsonResponse } from "@/lib/api-response";
import {
  DEFAULT_CAPTION_STYLE,
  normalizeCaptionStyle,
  type CaptionStyle,
} from "@/lib/caption-style";
import { MAX_CHARS_PER_LINE, MAX_LINES } from "@/lib/safezone";
import {
  Segment,
  groupShortSegments,
  looksWordByWord,
  mergeWithNext,
  serializeSrt,
  validateSegments,
  wordTimings,
  wrapText,
} from "@/lib/srt";
import { renderStageLabel, RENDER_PHASES } from "@/lib/render-progress";
import type { VideoInfo } from "@/lib/store";
import {
  classifyVideoFormat,
  type VideoFormat,
} from "@/lib/video-format";

type EditorTool = "style" | "captions";

interface Snapshot {
  segments: Segment[];
  captionStyle: CaptionStyle;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;
const MAX_POLL_FAILURES = 10;

const SHORTCUTS: Array<[string, string]> = [
  ["Space / K", "Play or pause"],
  ["J / L", "Back / forward 5 seconds"],
  ["↑ / ↓", "Previous / next caption"],
  ["I / O", "Set caption start / end at the playhead"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["⌘↵", "Export video"],
  ["?", "Show or hide this list"],
];

function compactTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
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
  const [outputReady, setOutputReady] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [etaMs, setEtaMs] = useState<number | null>(null);
  const encodeStartRef = useRef<{ at: number; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [followPlayback, setFollowPlayback] = useState(true);
  const [connectionLost, setConnectionLost] = useState(false);
  const [ahead, setAhead] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const latestRef = useRef<Snapshot>({
    segments: [],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
  });
  const historyRef = useRef<{
    past: Snapshot[];
    future: Snapshot[];
    key: string | null;
    at: number;
  }>({ past: [], future: [], key: null, at: 0 });

  useEffect(() => {
    latestRef.current = { segments, captionStyle };
  }, [segments, captionStyle]);

  // Edits made in quick succession with the same key share one undo step.
  const pushHistory = useCallback((key?: string) => {
    const history = historyRef.current;
    const now = Date.now();
    const coalesce =
      key !== undefined && key === history.key && now - history.at < COALESCE_MS;
    history.key = key ?? null;
    history.at = now;
    setDirty(true);
    if (coalesce) return;
    history.past.push(latestRef.current);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    setHistoryCounts({ undo: history.past.length, redo: 0 });
  }, []);

  const restoreSnapshot = useCallback((snapshot: Snapshot) => {
    latestRef.current = snapshot;
    setSegments(snapshot.segments);
    setCaptionStyle(snapshot.captionStyle);
    setSelectedIndex((current) =>
      snapshot.segments.some((segment) => segment.index === current)
        ? current
        : (snapshot.segments[0]?.index ?? null),
    );
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(latestRef.current);
    history.key = null;
    setHistoryCounts({ undo: history.past.length, redo: history.future.length });
    restoreSnapshot(previous);
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return;
    history.past.push(latestRef.current);
    history.key = null;
    setHistoryCounts({ undo: history.past.length, redo: history.future.length });
    restoreSnapshot(next);
  }, [restoreSnapshot]);

  const changeStyle = useCallback(
    (next: CaptionStyle) => {
      pushHistory("style");
      setCaptionStyle(next);
    },
    [pushHistory],
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/segments/${jobId}`);
        const data = await readJsonResponse<{
          segments: Segment[];
          video?: VideoInfo;
          captionStyle?: CaptionStyle;
          render?: { status: string; progress?: number; outputReady?: boolean };
        }>(response);
        setSegments(data.segments);
        setVideo(data.video ?? null);
        setCaptionStyle(normalizeCaptionStyle(data.captionStyle));
        setSelectedIndex(data.segments[0]?.index ?? null);
        const render = data.render;
        if (render?.status === "queued" || render?.status === "processing") {
          setStatus(render.status);
          setProgress(render.progress ?? 0);
        } else if (render?.status === "done" && render.outputReady) {
          setStatus("done");
          setProgress(100);
          setOutputReady(true);
        }
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
  const timedSegment = useMemo(
    () =>
      segments.find(
        (segment) => currentMs >= segment.start && currentMs <= segment.end,
      ),
    [currentMs, segments],
  );
  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.index === selectedIndex),
    [segments, selectedIndex],
  );
  const activeSegment = selectedSegment ?? timedSegment;
  const previewSegment = isPlaying ? timedSegment : activeSegment;
  const activeCaption = previewSegment
    ? wrapText(previewSegment.text).lines.join("\n")
    : "";
  const activeWord = useMemo(() => {
    if (!captionStyle.wordHighlight || !previewSegment) return null;
    const timings = wordTimings(previewSegment);
    if (timings.length === 0) return null;
    let spoken = 0;
    timings.forEach((word, position) => {
      if (currentMs >= word.start) spoken = position;
    });
    return spoken;
  }, [captionStyle.wordHighlight, currentMs, previewSegment]);

  const updateSegment = useCallback(
    (index: number, patch: Partial<Segment>) => {
      pushHistory(`${index}:${Object.keys(patch).join(",")}`);
      setSegments((current) =>
        current.map((segment) =>
          segment.index === index ? { ...segment, ...patch } : segment,
        ),
      );
    },
    [pushHistory],
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
    pushHistory();

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
  }, [pushHistory, seek]);

  const mergeSegmentWithNext = useCallback(
    (segment: Segment) => {
      pushHistory();
      setSegments((current) => mergeWithNext(current, segment.index));
      setSelectedIndex(segment.index);
    },
    [pushHistory],
  );

  const groupWords = useCallback(() => {
    const grouped = groupShortSegments(segments);
    if (grouped.length === segments.length) return;
    pushHistory();
    setSegments(grouped);
    const containing =
      grouped.find((s) => currentMs >= s.start && currentMs <= s.end) ??
      grouped[0];
    setSelectedIndex(containing?.index ?? null);
  }, [currentMs, pushHistory, segments]);

  const wordByWord = useMemo(() => looksWordByWord(segments), [segments]);

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
      setDirty(false);
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
      encodeStartRef.current = null;
      setEtaMs(null);
      setProgress(0);
      setOutputReady(false);
      setDownloaded(false);
      setStatus("queued");
    } catch (renderError) {
      setError(
        renderError instanceof Error
          ? renderError.message
          : "Could not start the export.",
      );
    }
  }

  const rendering = status === "queued" || status === "processing";
  const downloadable = status === "done" && outputReady && !downloaded;

  useEffect(() => {
    if (!rendering) return;
    let cancelled = false;
    let failures = 0;
    let timer = 0;

    const tick = async () => {
      try {
        const response = await fetch(`/api/status/${jobId}`, { cache: "no-store" });
        const data = await readJsonResponse<{
          status: string;
          progress?: number;
          error?: string | null;
          ahead?: number | null;
        }>(response);
        if (cancelled) return;
        failures = 0;
        setConnectionLost(false);
        const nextProgress = data.progress ?? 0;
        setStatus(data.status);
        setProgress(nextProgress);
        setAhead(data.ahead ?? null);

        // Estimate remaining time from the encoding rate (the longest phase).
        const encodeFrom = RENDER_PHASES.encode[0];
        if (data.status === "processing" && nextProgress >= encodeFrom) {
          const now = Date.now();
          encodeStartRef.current ??= { at: now, progress: nextProgress };
          const done = nextProgress - encodeStartRef.current.progress;
          const elapsed = now - encodeStartRef.current.at;
          setEtaMs(
            done >= 3 && elapsed > 2000
              ? (elapsed / done) * (100 - nextProgress)
              : null,
          );
        }

        if (data.status === "done") {
          setOutputReady(true);
          setEtaMs(null);
        } else if (data.status === "error") {
          setEtaMs(null);
          setError(data.error || "An error occurred during export.");
        }
      } catch (pollError) {
        if (cancelled) return;
        // The export keeps running on the server, so a network blip is not fatal.
        failures += 1;
        if (failures >= 3) setConnectionLost(true);
        if (failures >= MAX_POLL_FAILURES) {
          setStatus("error");
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Could not read the export status.",
          );
          return;
        }
      }
      const delay =
        failures > 0
          ? Math.min(10000, 1000 * 2 ** failures)
          : document.hidden
            ? 5000
            : 1000;
      timer = window.setTimeout(() => void tick(), delay);
    };

    timer = window.setTimeout(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, rendering]);

  useEffect(() => {
    const base = "Caption Studio";
    document.title = rendering
      ? `${progress}% · Exporting — ${base}`
      : downloadable
        ? `✓ Video ready — ${base}`
        : base;
    return () => {
      document.title = base;
    };
  }, [downloadable, progress, rendering]);

  const cancelRender = useCallback(async () => {
    try {
      const response = await fetch(`/api/render/${jobId}`, { method: "DELETE" });
      await readJsonResponse(response);
      setStatus("cancelled");
      setProgress(0);
      setEtaMs(null);
      setAhead(null);
      setConnectionLost(false);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel the export.",
      );
    }
  }, [jobId]);

  function downloadSrt() {
    const blob = new Blob([serializeSrt(segments)], {
      type: "application/x-subrip",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `captions-${jobId.slice(0, 6)}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const markAtPlayhead = useCallback(
    (field: "start" | "end") => {
      if (!activeSegment) return;
      const time = Math.round((videoRef.current?.currentTime ?? currentMs / 1000) * 1000);
      updateSegment(activeSegment.index, { [field]: time });
    },
    [activeSegment, currentMs, updateSegment],
  );

  const goToSegment = useCallback(
    (offset: number) => {
      if (segments.length === 0) return;
      const position = segments.findIndex(
        (segment) => segment.index === activeSegment?.index,
      );
      const next =
        position === -1
          ? offset > 0
            ? 0
            : segments.length - 1
          : Math.min(segments.length - 1, Math.max(0, position + offset));
      selectSegment(segments[next]);
    },
    [activeSegment, segments, selectSegment],
  );

  // Warn before closing the tab while work (or a not yet downloaded video) would be lost.
  useEffect(() => {
    if (!dirty && !rendering && !downloadable) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, downloadable, rendering]);

  useEffect(() => {
    if (!isPlaying || !followPlayback || !timedSegment) return;
    setSelectedIndex(timedSegment.index);
  }, [followPlayback, isPlaying, timedSegment]);

  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandlerRef.current = (event) => {
      const target = event.target;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      const exportable = !rendering && !saving && status !== "done";

      if (modifier && key === "enter") {
        event.preventDefault();
        if (exportable) void startRender();
        return;
      }
      if (modifier && (key === "z" || key === "y")) {
        // Single-line inputs keep their native undo.
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
          return;
        }
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.altKey && (key === "arrowup" || key === "arrowdown")) {
        event.preventDefault();
        goToSegment(key === "arrowdown" ? 1 : -1);
        return;
      }
      if (key === "escape") {
        setShowShortcuts(false);
        return;
      }
      if (modifier || event.altKey || isEditableTarget(target)) return;

      const onControl =
        target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
      if ((key === " " && !onControl) || key === "k") {
        event.preventDefault();
        togglePlayback();
      } else if (key === "j" || key === "l") {
        seek(currentMs + (key === "l" ? 5000 : -5000));
      } else if (key === "arrowup" || key === "arrowdown") {
        event.preventDefault();
        goToSegment(key === "arrowdown" ? 1 : -1);
      } else if (key === "i") {
        markAtPlayhead("start");
      } else if (key === "o") {
        markAtPlayhead("end");
      } else if (event.key === "?") {
        setShowShortcuts((current) => !current);
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const stageLabel =
    status === "queued" && ahead
      ? `Waiting in queue · ${ahead} ahead`
      : renderStageLabel(status, progress);
  const etaLabel =
    etaMs === null
      ? null
      : etaMs < 60000
        ? `~${Math.max(5, Math.round(etaMs / 5000) * 5)} s left`
        : `~${Math.round(etaMs / 60000)} min left`;

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
          <div className="studio-history" role="group" aria-label="History">
            <button
              type="button"
              onClick={undo}
              disabled={historyCounts.undo === 0}
              aria-label="Undo"
              title="Undo (⌘Z)"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={historyCounts.redo === 0}
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
            >
              ↷
            </button>
          </div>
          <button
            type="button"
            className="studio-ghost"
            onClick={() => setShowShortcuts((current) => !current)}
            aria-label="Keyboard shortcuts"
            aria-expanded={showShortcuts}
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
          {rendering ? (
            <>
              <div className="studio-export-busy" aria-hidden="true">
                <i style={{ width: `${progress}%` }} />
                <span className="studio-export-spinner" />
                <span>Exporting {progress}%</span>
              </div>
              <button
                type="button"
                className="studio-ghost"
                onClick={() => void cancelRender()}
              >
                Cancel
              </button>
            </>
          ) : (
            status !== "done" && (
              <button
                type="button"
                onClick={() => void startRender()}
                disabled={saving}
                className="studio-export"
                title="Export (⌘↵)"
              >
                {status === "error" ? "Retry export" : "Export"}
              </button>
            )
          )}
          {downloadable && (
            <a
              className="studio-download-button"
              href={`/api/download/${jobId}`}
              download
              onClick={() => setDownloaded(true)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />
              </svg>
              Download video
            </a>
          )}
          {status === "done" && downloaded && (
            <span className="studio-downloaded">✓ Downloaded</span>
          )}
        </div>
      </header>

      {(rendering || downloadable) && (
        <div
          className={`studio-render-progress ${downloadable ? "done" : ""} ${
            status === "queued" ? "queued" : ""
          }`}
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${stageLabel}, ${progress}%`}
        >
          <div className="render-progress-label" aria-live="polite">
            <strong>{downloadable ? "✓ Video ready" : stageLabel}</strong>
            <span>
              {downloadable
                ? "Use Download video in the top bar to save it. It is deleted from the server after download."
                : connectionLost
                  ? "Connection lost, retrying… the export keeps running"
                  : [`${progress}%`, etaLabel].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="render-progress-track">
            <i style={{ width: `${downloadable ? 100 : progress}%` }} />
          </div>
        </div>
      )}
      {error && (
        <div className="studio-error" role="alert">
          <span>{error}</span>
          {status === "error" && (
            <button type="button" onClick={() => void startRender()}>
              Try again
            </button>
          )}
        </div>
      )}
      {showShortcuts && (
        <div className="shortcuts-panel" role="dialog" aria-label="Keyboard shortcuts">
          <div>
            <strong>Keyboard shortcuts</strong>
            <button type="button" onClick={() => setShowShortcuts(false)} aria-label="Close shortcuts">
              ×
            </button>
          </div>
          <dl>
            {SHORTCUTS.map(([keys, description]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </div>
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
            aria-label="Caption style"
            aria-pressed={activeTool === "style"}
            title="Caption style"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="14" height="6" rx="1.6" />
              <path d="M17 6h2.2a1.3 1.3 0 0 1 1.3 1.3v3.4a1.3 1.3 0 0 1-1.3 1.3H12a1.3 1.3 0 0 0-1.3 1.3V15" />
              <rect x="8.7" y="15" width="4" height="6.5" rx="1.1" fill="currentColor" />
            </svg>
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
            aria-label="Captions"
            aria-pressed={activeTool === "captions"}
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
                onChange={changeStyle}
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
              <div className="side-grouping">
                {wordByWord && (
                  <p>
                    Captions show one word at a time. Group them into short
                    phrases?
                  </p>
                )}
                <div>
                  <button type="button" onClick={groupWords}>
                    ⧉ Group words into phrases
                  </button>
                  <button type="button" onClick={downloadSrt}>
                    ↓ Download SRT
                  </button>
                </div>
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
                      aria-current={
                        selectedIndex === segment.index ? "true" : undefined
                      }
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
                activeWord={activeWord}
              />
            </div>
          </div>

          <div className="playback-bar">
            <span>
              {compactTime(currentMs)} / {compactTime(video?.durationMs ?? 0)}
            </span>
            <div>
              <button
                type="button"
                onClick={() => seek(currentMs - 5000)}
                aria-label="Back 5 seconds"
                title="Back 5 seconds (J)"
              >
                ↶ 5
              </button>
              <button
                type="button"
                className="play-button"
                onClick={togglePlayback}
                aria-label={isPlaying ? "Pause" : "Play"}
                title="Play or pause (Space)"
              >
                {isPlaying ? "Ⅱ" : "▶"}
              </button>
              <button
                type="button"
                onClick={() => seek(currentMs + 5000)}
                aria-label="Forward 5 seconds"
                title="Forward 5 seconds (L)"
              >
                5 ↷
              </button>
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
                onClick={() => setFollowPlayback((current) => !current)}
                aria-pressed={!followPlayback}
                title="Keep the selected caption while the video plays"
              >
                {followPlayback ? "◎ Following video" : "◉ Caption locked"}
              </button>
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
              <button
                type="button"
                onClick={() => mergeSegmentWithNext(activeSegment)}
                disabled={
                  segments[segments.length - 1]?.index === activeSegment.index
                }
                title="Join this caption with the next one"
              >
                ⊕ Merge with next
              </button>
            </div>
          )}
        </div>

        {activeSegment && (
          <div className="inline-segment-editor">
            <div className="inline-timing">
              <TimeField
                label="Caption start"
                valueMs={activeSegment.start}
                playheadMs={currentMs}
                onCommit={(next) => updateSegment(activeSegment.index, { start: next })}
              />
              <span>→</span>
              <TimeField
                label="Caption end"
                valueMs={activeSegment.end}
                playheadMs={currentMs}
                onCommit={(next) => updateSegment(activeSegment.index, { end: next })}
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
              aria-live="polite"
            >
              {issueMap.get(activeSegment.index)?.join(" ") ??
                (() => {
                  const { lines } = wrapText(activeSegment.text);
                  return `${lines.length}/${MAX_LINES} lines · ${lines
                    .map((line) => line.length)
                    .join(" / ")} of ${MAX_CHARS_PER_LINE} chars`;
                })()}
            </span>
          </div>
        )}
      </section>

    </main>
  );
}
