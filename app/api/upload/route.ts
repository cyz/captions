import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { ensureJobDir, jobPaths } from "@/lib/paths";
import { createVideoUploadUrl, writeArtifact } from "@/lib/artifacts";
import { isAzureStorageEnabled } from "@/lib/azure";
import { parseCaptions, serializeSrt } from "@/lib/srt";
import { probeVideo } from "@/lib/ffmpeg";
import { JobMeta, Transcription, VideoInfo, writeMeta } from "@/lib/store";
import { classifyVideoFormat } from "@/lib/video-format";
import { getDefaultCaptionStyle } from "@/lib/caption-style";

// Without a subtitle file, captions are generated from the audio afterwards.
const PENDING_TRANSCRIPTION: Transcription = { status: "pending", progress: 0 };

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_VIDEO_BYTES = 600 * 1024 * 1024; // 600 MB
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 min
const MAX_CAPTION_BYTES = 2 * 1024 * 1024;

export function GET() {
  const supported = process.env.NETLIFY !== "true";
  return NextResponse.json({
    status: "ok",
    uploadSupported: supported,
    uploadMode: isAzureStorageEnabled() ? "direct" : "multipart",
    ...(supported
      ? {}
      : {
          reason:
            "Caption processing requires persistent storage, FFmpeg, and a long-running worker, which are not available in this Netlify deployment.",
        }),
  });
}

export async function POST(req: NextRequest) {
  if (process.env.NETLIFY === "true") {
    return NextResponse.json(
      {
        error:
          "Video processing is unavailable on Netlify. Deploy the app to a persistent Node.js server with writable storage and FFmpeg installed.",
      },
      { status: 503 },
    );
  }

  try {
    return isAzureStorageEnabled()
      ? await handleAzureUpload(req)
      : await handleLocalUpload(req);
  } catch (error) {
    console.error("Upload processing failed", error);
    return NextResponse.json(
      {
        error:
          "Upload processing failed. Verify that the server has writable storage and FFmpeg installed.",
      },
      { status: 500 },
    );
  }
}

interface AzureUploadRequest {
  srtText?: string;
  video?: {
    name?: string;
    size?: number;
    type?: string;
    width?: number;
    height?: number;
    durationMs?: number;
  };
}

async function handleAzureUpload(req: NextRequest) {
  const body = (await req.json()) as AzureUploadRequest;
  const video = body.video;
  const srtText = body.srtText;
  if (srtText !== undefined && typeof srtText !== "string") {
    return NextResponse.json({ error: "Upload an SRT or VTT caption file." }, { status: 400 });
  }

  if (!video) {
    return NextResponse.json({ error: "Upload a video file." }, { status: 400 });
  }
  if ((video.size ?? 0) <= 0 || (video.size ?? 0) > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: "Video exceeds the 600 MB limit." },
      { status: 413 },
    );
  }
  if (srtText !== undefined && Buffer.byteLength(srtText, "utf8") > MAX_CAPTION_BYTES) {
    return NextResponse.json({ error: "Subtitle file is too large." }, { status: 413 });
  }

  const segments = srtText !== undefined ? parseCaptions(srtText) : [];
  if (srtText !== undefined && segments.length === 0) {
    return NextResponse.json(
      { error: "Could not read captions. Upload a valid SRT or VTT file." },
      { status: 400 },
    );
  }

  const width = Math.max(0, Math.round(Number(video.width) || 0));
  const height = Math.max(0, Math.round(Number(video.height) || 0));
  const durationMs = Math.max(0, Math.round(Number(video.durationMs) || 0));
  if (!width || !height || !durationMs) {
    return NextResponse.json({ error: "Could not read the video metadata." }, { status: 400 });
  }
  if (durationMs > MAX_DURATION_MS) {
    return NextResponse.json(
      { error: "Video exceeds the 10-minute limit." },
      { status: 413 },
    );
  }

  const videoInfo: VideoInfo = {
    width,
    height,
    durationMs,
    isVertical916: Math.abs(width / height - 9 / 16) < 0.02,
    format: classifyVideoFormat(width, height),
  };
  const jobId = randomUUID();
  const now = Date.now();
  const meta: JobMeta = {
    id: jobId,
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
    progress: 0,
    video: videoInfo,
    segments,
    captionStyle: getDefaultCaptionStyle(videoInfo.format),
    ...(srtText !== undefined ? {} : { transcription: PENDING_TRANSCRIPTION }),
  };

  await Promise.all([
    writeMeta(meta),
    ...(srtText !== undefined
      ? [writeArtifact(jobId, "srt", serializeSrt(segments), "application/x-subrip")]
      : []),
  ]);
  const uploadUrl = await createVideoUploadUrl(jobId);

  return NextResponse.json({
    jobId,
    video: videoInfo,
    segments,
    transcription: meta.transcription ?? null,
    upload: {
      url: uploadUrl,
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": video.type || "video/mp4",
      },
    },
  });
}

async function handleLocalUpload(req: NextRequest) {
  const form = await req.formData();
  const video = form.get("video");
  const srt = form.get("srt");

  if (!(video instanceof File)) {
    return NextResponse.json({ error: "Upload a video file." }, { status: 400 });
  }
  if (srt !== null && !(srt instanceof File)) {
    return NextResponse.json({ error: "Upload an SRT or VTT caption file." }, { status: 400 });
  }
  const srtFile = srt instanceof File ? srt : null;

  if (video.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: "Video exceeds the 600 MB limit." },
      { status: 413 },
    );
  }

  let segments: JobMeta["segments"] = [];
  if (srtFile) {
    if (srtFile.size > MAX_CAPTION_BYTES) {
      return NextResponse.json({ error: "Subtitle file is too large." }, { status: 413 });
    }
    const srtText = await srtFile.text();
    if (Buffer.byteLength(srtText, "utf8") > MAX_CAPTION_BYTES) {
      return NextResponse.json({ error: "Subtitle file is too large." }, { status: 413 });
    }

    segments = parseCaptions(srtText);
    if (segments.length === 0) {
      return NextResponse.json(
        { error: "Could not read captions. Upload a valid SRT or VTT file." },
        { status: 400 },
      );
    }
  }

  const jobId = randomUUID();
  await ensureJobDir(jobId);
  const paths = jobPaths(jobId);
  await fs.writeFile(paths.video, Buffer.from(await video.arrayBuffer()));
  if (srtFile) await fs.writeFile(paths.srt, serializeSrt(segments), "utf8");

  let videoInfo;
  try {
    videoInfo = await probeVideo(paths.video);
  } catch {
    return NextResponse.json(
      { error: "Could not process the uploaded video." },
      { status: 400 },
    );
  }

  if (videoInfo.durationMs > MAX_DURATION_MS) {
    return NextResponse.json(
      { error: "Video exceeds the 10-minute limit." },
      { status: 413 },
    );
  }

  const meta: JobMeta = {
    id: jobId,
    status: "uploaded",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    video: videoInfo,
    segments,
    captionStyle: getDefaultCaptionStyle(videoInfo.format),
    ...(srtFile ? {} : { transcription: PENDING_TRANSCRIPTION }),
  };
  await writeMeta(meta);

  return NextResponse.json({
    jobId,
    video: videoInfo,
    segments,
    transcription: meta.transcription ?? null,
  });
}
