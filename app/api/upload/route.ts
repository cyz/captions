import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { ensureJobDir, jobPaths } from "@/lib/paths";
import { parseSrt } from "@/lib/srt";
import { probeVideo } from "@/lib/ffmpeg";
import { JobMeta, writeMeta } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_VIDEO_BYTES = 600 * 1024 * 1024; // 600 MB
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 min

export function GET() {
  const supported = process.env.NETLIFY !== "true";
  return NextResponse.json({
    status: "ok",
    uploadSupported: supported,
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
    return await handleUpload(req);
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

async function handleUpload(req: NextRequest) {
  const form = await req.formData();
  const video = form.get("video");
  const srt = form.get("srt");

  if (!(video instanceof File) || !(srt instanceof File)) {
    return NextResponse.json(
      { error: "Upload a video file and a .srt file." },
      { status: 400 },
    );
  }

  if (video.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: "Video exceeds the 600 MB limit." },
      { status: 413 },
    );
  }

  const jobId = randomUUID();
  await ensureJobDir(jobId);
  const paths = jobPaths(jobId);

  await fs.writeFile(paths.video, Buffer.from(await video.arrayBuffer()));
  const srtText = await srt.text();
  await fs.writeFile(paths.srt, srtText, "utf8");

  const segments = parseSrt(srtText);
  if (segments.length === 0) {
    return NextResponse.json(
      { error: "Could not read subtitles from the .srt file." },
      { status: 400 },
    );
  }

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
  };
  await writeMeta(meta);

  return NextResponse.json({ jobId, video: videoInfo, segments });
}
