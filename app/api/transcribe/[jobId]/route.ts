import { NextRequest, NextResponse } from "next/server";
import { getArtifactSize } from "@/lib/artifacts";
import { enqueueTranscription } from "@/lib/queue";
import { isTranscribing, readMeta, updateMeta } from "@/lib/store";

export const runtime = "nodejs";

// Queue speech-to-text for a job. Existing captions are only replaced when the
// caller passes { "replace": true }.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // Idempotent: a retry must not enqueue the same work twice.
  if (isTranscribing(meta)) {
    return NextResponse.json({ transcription: meta.transcription });
  }
  if (meta.status === "queued" || meta.status === "processing") {
    return NextResponse.json(
      { error: "Wait for the export to finish before transcribing." },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { replace?: boolean };
  if (meta.segments.length > 0 && body.replace !== true) {
    return NextResponse.json(
      { error: "This project already has captions." },
      { status: 409 },
    );
  }

  const sourceAvailable = await getArtifactSize(jobId, "video").then(
    (size) => size > 0,
    () => false,
  );
  if (!sourceAvailable) {
    return NextResponse.json(
      { error: "The source video is not available." },
      { status: 409 },
    );
  }

  const transcription = { status: "queued" as const, progress: 0 };
  await updateMeta(jobId, { transcription });
  try {
    await enqueueTranscription(jobId);
  } catch (error) {
    await updateMeta(jobId, {
      transcription: {
        status: "error",
        progress: 0,
        error: "Could not start the transcription.",
      },
    });
    throw error;
  }

  return NextResponse.json({ transcription });
}
