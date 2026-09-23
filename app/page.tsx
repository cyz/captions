"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { readJsonResponse } from "@/lib/api-response";
import {
  classifyVideoFormat,
  type VideoFormat,
} from "@/lib/video-format";

interface VideoMetadata {
  width: number;
  height: number;
  durationMs: number;
  format: VideoFormat;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function inspectVideo(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("video");
    const url = URL.createObjectURL(file);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const width = element.videoWidth;
      const height = element.videoHeight;
      resolve({
        width,
        height,
        durationMs: Math.round(element.duration * 1000),
        format: classifyVideoFormat(width, height),
      });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected video could not be read."));
    };
    element.src = url;
  });
}

function UploadIcon({ kind }: { kind: "video" | "caption" }) {
  return kind === "video" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="m17 10 4-2v8l-4-2M8 9.5l4.5 2.5L8 14.5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h4m2 0h4M7 14h3m2 0h5" />
    </svg>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [dragging, setDragging] = useState<"video" | "caption" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectVideo(file: File | null) {
    if (!file) return;
    setError(null);
    setMetadata(null);
    setInspecting(true);
    try {
      const nextMetadata = await inspectVideo(file);
      setVideo(file);
      setMetadata(nextMetadata);
    } catch (err) {
      setVideo(null);
      setError(err instanceof Error ? err.message : "Invalid video.");
    } finally {
      setInspecting(false);
    }
  }

  function selectSrt(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".srt")) {
      setError("Select a caption file in .srt format.");
      return;
    }
    setError(null);
    setSrt(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!video || !srt || !metadata) {
      setError("Add the video and caption files to continue.");
      return;
    }
    setBusy(true);
    try {
      const capabilityResponse = await fetch("/api/upload");
      const capability = await readJsonResponse<{
        uploadMode: "direct" | "multipart";
      }>(capabilityResponse);

      if (capability.uploadMode === "direct") {
        const createResponse = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video: {
              name: video.name,
              size: video.size,
              type: video.type,
              width: metadata.width,
              height: metadata.height,
              durationMs: metadata.durationMs,
            },
            srtText: await srt.text(),
          }),
        });
        const created = await readJsonResponse<{
          jobId: string;
          upload: { url: string; headers: Record<string, string> };
        }>(createResponse);
        const uploadResponse = await fetch(created.upload.url, {
          method: "PUT",
          headers: created.upload.headers,
          body: video,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Video upload failed (${uploadResponse.status}).`);
        }
        router.push(`/editor/${created.jobId}`);
        return;
      }

      const form = new FormData();
      form.append("video", video);
      form.append("srt", srt);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = await readJsonResponse<{ jobId: string }>(response);
      router.push(`/editor/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setBusy(false);
    }
  }

  const ready = Boolean(video && srt && metadata && !busy && !inspecting);

  return (
    <main className="upload-page">
      <header className="brand-bar">
        <a className="brand" href="/" aria-label="Caption Studio, home">
          <span className="brand-mark">C</span>
          <span>Caption Studio</span>
        </a>
        <div className="header-meta">
          <span className="privacy-dot" />
          Private processing
        </div>
      </header>

      <div className="landing-layout">
        <section className="upload-hero">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            NEW PROJECT
          </div>
          <h1>Captions in the right place, on every screen.</h1>
          <p>
            From vertical video to full-length episodes: we detect the format
            and prepare a tailored review workspace.
          </p>
          <div className="format-showcase" aria-hidden="true">
            <div className="showcase-landscape">
              <span className="showcase-topline">LONG FORM</span>
              <div className="showcase-caption">
                <i />
                <i />
              </div>
            </div>
            <div className="showcase-social">
              <span className="showcase-topline">SOCIAL</span>
              <div className="showcase-caption">
                <i />
                <i />
              </div>
            </div>
            <span className="showcase-check">✓</span>
          </div>
          <div className="benefit-list">
            <span>✓ Automatic aspect ratio detection</span>
            <span>✓ Format-specific safe zones</span>
            <span>✓ Video-synced review</span>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="upload-workspace">
          <div className="workspace-card">
            <div className="workspace-heading">
              <div>
                <span className="panel-kicker">START HERE</span>
                <h2>Create your review workspace</h2>
              </div>
              <span className="step-progress">2 files</span>
            </div>
            <div className="upload-grid">
          <section className="upload-step">
            <div className="step-heading">
              <span className="step-number">1</span>
              <div>
                <h2>Add the video</h2>
                <p>MP4, MOV, or WebM · up to 600 MB</p>
              </div>
            </div>
            <button
              type="button"
              className={`dropzone ${video ? "has-file" : ""} ${
                dragging === "video" ? "is-dragging" : ""
              }`}
              onClick={() => videoInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging("video");
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragging(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(null);
                void selectVideo(e.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*"
                onChange={(e) => void selectVideo(e.target.files?.[0] ?? null)}
                hidden
              />
              <span className="dropzone-icon"><UploadIcon kind="video" /></span>
              {inspecting ? (
                <>
                  <strong>Analyzing the video…</strong>
                  <span>This only takes a few seconds</span>
                </>
              ) : video && metadata ? (
                <>
                  <strong className="file-name">{video.name}</strong>
                  <span>{formatBytes(video.size)} · {formatDuration(metadata.durationMs)}</span>
                  <span className={`format-badge ${metadata.format}`}>
                    {metadata.format === "long-form" ? "▭ Long form" : "▯ Social"}
                    <small>{metadata.width} × {metadata.height}</small>
                  </span>
                </>
              ) : (
                <>
                  <strong>Drag the video here</strong>
                  <span>or click to select</span>
                </>
              )}
            </button>
          </section>

          <section className="upload-step">
            <div className="step-heading">
              <span className="step-number">2</span>
              <div>
                <h2>Add the captions</h2>
                <p>SRT file · up to 2 MB</p>
              </div>
            </div>
            <button
              type="button"
              className={`dropzone ${srt ? "has-file" : ""} ${
                dragging === "caption" ? "is-dragging" : ""
              }`}
              onClick={() => srtInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging("caption");
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragging(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(null);
                selectSrt(e.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                ref={srtInputRef}
                type="file"
                accept=".srt,application/x-subrip,text/plain"
                onChange={(e) => selectSrt(e.target.files?.[0] ?? null)}
                hidden
              />
              <span className="dropzone-icon"><UploadIcon kind="caption" /></span>
              {srt ? (
                <>
                  <strong className="file-name">{srt.name}</strong>
                  <span>{formatBytes(srt.size)} · SRT file</span>
                  <span className="file-ready">✓ Ready to review</span>
                </>
              ) : (
                <>
                  <strong>Drag the SRT file here</strong>
                  <span>or click to select</span>
                </>
              )}
            </button>
          </section>
            </div>

            {metadata && (
              <div className="detection-note" role="status">
                <span className="detection-icon">✓</span>
                <div>
                  <strong>
                    {metadata.format === "long-form" ? "Long-form" : "Social"} format detected
                  </strong>
                  <span>
                    Editor optimized for {metadata.width}:{metadata.height} and its safe zone.
                  </span>
                </div>
              </div>
            )}

            {error && <div className="error-banner" role="alert">{error}</div>}

            <div className="upload-action">
              <button type="submit" className="primary-button" disabled={!ready}>
                {busy ? (
                  <>
                    <span className="spinner" /> Uploading files…
                  </>
                ) : (
                  <>Open review workspace <span aria-hidden="true">→</span></>
                )}
              </button>
              <p>
                <span aria-hidden="true">⌁</span>
                Your files remain protected during processing.
              </p>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
