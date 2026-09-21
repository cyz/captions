import { NextRequest, NextResponse } from "next/server";
import { readMeta } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  return NextResponse.json({
    status: meta.status,
    progress: meta.progress,
    error: meta.error ?? null,
  });
}
