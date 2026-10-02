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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inspectionIdRef = useRef(0);
  const [video, setVideo] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectVideo(file: File | null) {
    if (!file) return;
    const inspectionId = ++inspectionIdRef.current;
    setMetadata(null);
    setInspecting(true);
    try {
      const nextMetadata = await inspectVideo(file);
      if (inspectionId !== inspectionIdRef.current) return;
      setVideo(file);
      setMetadata(nextMetadata);
    } catch (err) {
      if (inspectionId !== inspectionIdRef.current) return;
      setVideo(null);
      setError(err instanceof Error ? err.message : "Invalid video.");
    } finally {
      if (inspectionId === inspectionIdRef.current) setInspecting(false);
    }
  }

  function isVideoFile(file: File) {
    return (
      file.type.startsWith("video/") ||
      /\.(mp4|mov|webm)$/i.test(file.name)
    );
  }

  async function selectFiles(files: FileList | File[]) {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;

    const videos = selectedFiles.filter(isVideoFile);
    const captions = selectedFiles.filter((file) =>
      file.name.toLowerCase().endsWith(".srt"),
    );
    const recognized = new Set([...videos, ...captions]);
    const unsupported = selectedFiles.filter((file) => !recognized.has(file));

    if (unsupported.length > 0) {
      setError(
        `File not recognized: ${unsupported.map((file) => file.name).join(", ")}. Select one video and one .srt file.`,
      );
      return;
    }
    if (videos.length > 1 || captions.length > 1) {
      setError("Select only one video and one .srt caption file.");
      return;
    }

    setError(null);
    if (captions[0]) setSrt(captions[0]);
    if (videos[0]) await selectVideo(videos[0]);
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
              <span className="step-progress">
                {Number(Boolean(video)) + Number(Boolean(srt))}/2 files
              </span>
            </div>

            <button
              type="button"
              className={`dropzone combined-dropzone ${
                video || srt ? "has-file" : ""
              } ${
                dragging ? "is-dragging" : ""
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setDragging(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void selectFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*,.srt,application/x-subrip"
                multiple
                onChange={(e) => {
                  if (e.target.files) void selectFiles(e.target.files);
                  e.target.value = "";
                }}
                hidden
              />
              <div className="combined-dropzone-heading">
                <span className="dropzone-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                    <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
                  </svg>
                </span>
                <div>
                  <strong>Drag the video and captions here</strong>
                  <span>or click to select both files at once</span>
                </div>
              </div>

              <div className="detected-files">
                <div className={`detected-file ${video && metadata ? "is-ready" : ""}`}>
                  <span className="detected-file-icon"><UploadIcon kind="video" /></span>
                  <span className="detected-file-copy">
                    <strong className="file-name">
                      {inspecting ? "Analyzing video…" : video?.name ?? "Video"}
                    </strong>
                    <small>
                      {video && metadata
                        ? `${formatBytes(video.size)} · ${formatDuration(metadata.durationMs)}`
                        : inspecting
                          ? "Detecting format"
                          : "MP4, MOV, or WebM · up to 600 MB"}
                    </small>
                  </span>
                  <span className="detected-file-status">
                    {video && metadata ? "✓ Detected" : "Required"}
                  </span>
                </div>

                <div className={`detected-file ${srt ? "is-ready" : ""}`}>
                  <span className="detected-file-icon"><UploadIcon kind="caption" /></span>
                  <span className="detected-file-copy">
                    <strong className="file-name">{srt?.name ?? "Captions"}</strong>
                    <small>
                      {srt ? `${formatBytes(srt.size)} · SRT file` : "SRT · up to 2 MB"}
                    </small>
                  </span>
                  <span className="detected-file-status">
                    {srt ? "✓ Detected" : "Required"}
                  </span>
                </div>
              </div>
            </button>

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
