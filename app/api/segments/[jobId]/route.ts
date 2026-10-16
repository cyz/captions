import { NextRequest, NextResponse } from "next/server";
import { isTranscribing, readMeta, updateMeta } from "@/lib/store";
import { Segment, validateSegments } from "@/lib/srt";
import { normalizeCaptionStyle } from "@/lib/caption-style";
import { getArtifactSize } from "@/lib/artifacts";
import { normalizeCuts } from "@/lib/cuts";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  // The output is deleted after it is downloaded, so "done" alone is not enough.
  const outputReady =
    meta.status === "done" &&
    (await getArtifactSize(jobId, "output").then(
      (size) => size > 0,
      () => false,
    ));
  return NextResponse.json({
    segments: meta.segments,
    video: meta.video,
    captionStyle: normalizeCaptionStyle(meta.captionStyle, meta.video?.format),
    transcription: meta.transcription ?? null,
    silences: meta.silences ?? [],
    cuts: meta.cuts ?? [],
    render: { status: meta.status, progress: meta.progress, outputReady },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  // The transcription worker writes the captions when it finishes.
  if (isTranscribing(meta)) {
    return NextResponse.json(
      { error: "Captions are still being generated." },
      { status: 409 },
    );
  }

  const body = await req.json();
  const incoming = body.segments;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "Invalid segments." }, { status: 400 });
  }

  const segments: Segment[] = incoming.map((s: Segment, i: number) => ({
    index: i + 1,
    start: Math.max(0, Math.round(Number(s.start) || 0)),
    end: Math.max(0, Math.round(Number(s.end) || 0)),
    text: String(s.text ?? ""),
    ...(Array.isArray(s.wordStarts) && s.wordStarts.length <= 200
      ? {
          wordStarts: s.wordStarts.map((value) =>
            Math.max(0, Math.round(Number(value) || 0)),
          ),
        }
      : {}),
  }));

  const issues = validateSegments(segments, meta.video?.format);
  const captionStyle = normalizeCaptionStyle(
    body.captionStyle ?? meta.captionStyle,
    meta.video?.format,
  );
  const cuts = Array.isArray(body.cuts)
    ? normalizeCuts(body.cuts, meta.video?.durationMs || Infinity)
    : (meta.cuts ?? []);
  await updateMeta(jobId, { segments, captionStyle, cuts });

  return NextResponse.json({ segments, issues, captionStyle, cuts });
}
