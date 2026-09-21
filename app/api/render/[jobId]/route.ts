import { NextRequest, NextResponse } from "next/server";
import { readMeta, updateMeta } from "@/lib/store";
import { validateSegments } from "@/lib/srt";
import { enqueueRender } from "@/lib/queue";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });

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
