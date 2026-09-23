import { NextRequest, NextResponse } from "next/server";
import { readMeta, updateMeta } from "@/lib/store";
import { Segment, validateSegments } from "@/lib/srt";
import { normalizeCaptionStyle } from "@/lib/caption-style";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({
    segments: meta.segments,
    video: meta.video,
    captionStyle: normalizeCaptionStyle(meta.captionStyle),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });

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
  }));

  const issues = validateSegments(segments);
  const captionStyle = normalizeCaptionStyle(body.captionStyle ?? meta.captionStyle);
  await updateMeta(jobId, { segments, captionStyle });

  return NextResponse.json({ segments, issues, captionStyle });
}
