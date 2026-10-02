import { NextRequest, NextResponse } from "next/server";
import { readMeta, updateMeta } from "@/lib/store";
import { validateSegments } from "@/lib/srt";
import { cancelQueued, enqueueRender } from "@/lib/queue";
import { getArtifactSize } from "@/lib/artifacts";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // Idempotent: a second click must not enqueue (and bill) another render.
  if (meta.status === "queued" || meta.status === "processing") {
    return NextResponse.json({ status: meta.status });
  }

  // The source video is deleted after a successful export.
  const sourceAvailable = await getArtifactSize(jobId, "video").then(
    (size) => size > 0,
    () => false,
  );
  if (!sourceAvailable) {
    return NextResponse.json(
      { error: "The source video was already deleted after export." },
      { status: 409 },
    );
  }

  const issues = validateSegments(meta.segments);
  if (issues.length > 0) {
    return NextResponse.json(
      { error: "There are invalid segments.", issues },
      { status: 400 },
    );
  }

  await updateMeta(jobId, { status: "queued", progress: 0, error: undefined });
  await enqueueRender(jobId);

  return NextResponse.json({ status: "queued" });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (meta.status !== "queued" && meta.status !== "processing") {
    return NextResponse.json({ status: meta.status });
  }

  cancelQueued(jobId);
  await updateMeta(jobId, { status: "cancelled", progress: 0 });
  return NextResponse.json({ status: "cancelled" });
}
