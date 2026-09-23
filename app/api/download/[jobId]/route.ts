import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { deleteArtifact, openArtifactDownload } from "@/lib/artifacts";
import { readMeta } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta || meta.status !== "done") {
    return NextResponse.json({ error: "Video is not ready yet." }, { status: 404 });
  }

  let download: Awaited<ReturnType<typeof openArtifactDownload>>;
  try {
    download = await openArtifactDownload(jobId, "output");
  } catch (error) {
    console.error(`Could not open output for job ${jobId}`, error);
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  download.stream.once("end", () => {
    void deleteArtifact(jobId, "output").catch((error) => {
      console.error(`Could not delete downloaded output for job ${jobId}`, error);
    });
  });
  req.signal.addEventListener("abort", () => download.stream.destroy(), {
    once: true,
  });
  const webStream = Readable.toWeb(download.stream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      ...(download.contentLength !== undefined
        ? { "Content-Length": String(download.contentLength) }
        : {}),
      "Content-Disposition": `attachment; filename="captioned-${jobId}.mp4"`,
      "Cache-Control": "no-store",
    },
  });
}
