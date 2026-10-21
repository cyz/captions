"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { readJsonResponse } from "@/lib/api-response";
import { parseCaptions } from "@/lib/srt";
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

// Automatic captions come from the audio. A failed request is not fatal: the
// editor retries it automatically and offers a manual retry.
async function requestTranscription(jobId: string): Promise<void> {
  await fetch(`/api/transcribe/${jobId}`, { method: "POST" }).catch(
    () => undefined,
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="m17 10 4-2v8l-4-2M8 9.5l4.5 2.5L8 14.5z" />
    </svg>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inspectionIdRef = useRef(0);
  const [video, setVideo] = useState<File | null>(null);
  const [captionSource, setCaptionSource] = useState<"automatic" | "file">("automatic");
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
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

    const unsupported = selectedFiles.filter((file) => !isVideoFile(file));
    if (unsupported.length > 0) {
      setError(
        `File not recognized: ${unsupported.map((file) => file.name).join(", ")}. Select a video file (MP4, MOV, or WebM).`,
      );
      return;
    }
    if (selectedFiles.length > 1) {
      setError("Select only one video.");
      return;
    }

    setError(null);
    await selectVideo(selectedFiles[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!video || !metadata) {
      setError("Add a video to continue.");
      return;
    }
    setBusy(true);
    try {
      const uploadedCaptions = captionSource === "file" ? captionFile : null;
      if (captionSource === "file" && !uploadedCaptions) {
        throw new Error("Choose an SRT or VTT caption file to continue.");
      }
      const captionText = uploadedCaptions ? await uploadedCaptions.text() : undefined;
      if (captionText !== undefined && parseCaptions(captionText).length === 0) {
        throw new Error("No captions found. Choose a valid SRT or VTT file.");
      }
      const capabilityResponse = await fetch("/api/upload");
      const capability = await readJsonResponse<{
        uploadMode: "direct" | "multipart";
      }>(capabilityResponse);

      if (capability.uploadMode === "direct") {
        const createResponse = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            srtText: captionText,
            video: {
              name: video.name,
              size: video.size,
              type: video.type,
              width: metadata.width,
              height: metadata.height,
              durationMs: metadata.durationMs,
            },
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
        if (!uploadedCaptions) await requestTranscription(created.jobId);
        router.push(`/editor/${created.jobId}`);
        return;
      }

      const form = new FormData();
      form.append("video", video);
      if (uploadedCaptions) form.append("srt", uploadedCaptions);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = await readJsonResponse<{ jobId: string }>(response);
      if (!uploadedCaptions) await requestTranscription(data.jobId);
      router.push(`/editor/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setBusy(false);
    }
  }

  const ready = Boolean(
    video && metadata && !busy && !inspecting &&
    (captionSource === "automatic" || captionFile),
  );

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
            From vertical video to full-length episodes: we detect the format and
            prepare a tailored review workspace. Generate captions automatically
            from the audio, or upload your own SRT or VTT file.
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
            <span>✓ Automatic captions or your own SRT/VTT</span>
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
                {video ? "1/1" : "0/1"} video
              </span>
            </div>

            <button
              type="button"
              disabled={busy}
              className={`dropzone combined-dropzone ${
                video ? "has-file" : ""
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
                accept="video/mp4,video/quicktime,video/webm,video/*"
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
                  <strong>Drag the video here</strong>
                  <span>
                    or click to select it. Choose how to add captions below.
                  </span>
                </div>
              </div>

              <div className="detected-files">
                <div className={`detected-file ${video && metadata ? "is-ready" : ""}`}>
                  <span className="detected-file-icon"><VideoIcon /></span>
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
              </div>
            </button>

            <fieldset className="caption-source" disabled={busy}>
              <legend>How would you like to add captions?</legend>
              <p className="caption-source-hint">
                Let us detect the spoken language and generate captions, or use a file you already have.
              </p>
              <div className="caption-source-options">
                <label className={`caption-source-option ${captionSource === "automatic" ? "is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="caption-source"
                    value="automatic"
                    checked={captionSource === "automatic"}
                    onChange={() => {
                      setCaptionSource("automatic");
                      setCaptionFile(null);
                      setError(null);
                    }}
                  />
                  <span>
                    <strong>Generate automatically</strong>
                    <small>Detect the language and transcribe the audio. No caption file needed.</small>
                  </span>
                </label>
                <label className={`caption-source-option ${captionSource === "file" ? "is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="caption-source"
                    value="file"
                    checked={captionSource === "file"}
                    onChange={() => {
                      setCaptionSource("file");
                      setError(null);
                    }}
                  />
                  <span>
                    <strong>Upload SRT or VTT</strong>
                    <small>Use your existing text and timing instead of automatic transcription.</small>
                  </span>
                </label>
              </div>
              {captionSource === "file" && (
                <div className="caption-file-upload">
                  <label htmlFor="caption-file">Caption file (.srt or .vtt)</label>
                  <input
                    id="caption-file"
                    type="file"
                    accept=".srt,.vtt"
                    aria-describedby="caption-file-hint"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setCaptionFile(null);
                      setError(null);
                      if (file && (!/\.(srt|vtt)$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024)) {
                        setError("Choose a non-empty SRT or VTT file up to 2 MB.");
                        e.target.value = "";
                        return;
                      }
                      setCaptionFile(file);
                    }}
                  />
                  <small id="caption-file-hint">
                    Up to 2 MB. Your captions will open in the editor for review. No automatic transcription will run.
                  </small>
                </div>
              )}
            </fieldset>

            {metadata && (
              <div className="detection-note" role="status">
                <span className="detection-icon">✓</span>
                <div>
                  <strong>
                    {metadata.format === "long-form" ? "Long-form" : "Social"} format detected
                  </strong>
                  <span>
                    Editor optimized for {metadata.width}:{metadata.height} and its safe zone.
                    {" "}{captionSource === "automatic"
                      ? "Captions will be generated automatically from the audio."
                      : "Captions will come from your SRT or VTT file."}
                  </span>
                </div>
              </div>
            )}

            {error && <div className="error-banner" role="alert">{error}</div>}

            <div className="upload-action">
              <button type="submit" className="primary-button" disabled={!ready}>
                {busy ? (
                  <>
                    <span className="spinner" /> Uploading video…
                  </>
                ) : (
                  <>Open review workspace <span aria-hidden="true">→</span></>
                )}
              </button>
              <p>
                <span aria-hidden="true">⌁</span>
                Your video remains protected during processing.
              </p>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
