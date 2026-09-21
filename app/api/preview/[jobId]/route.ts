import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { createArtifactReadUrl } from "@/lib/artifacts";
import { isAzureStorageEnabled } from "@/lib/azure";
import { jobPaths } from "@/lib/paths";

export const runtime = "nodejs";

// Serves the original uploaded video for in-browser preview.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (isAzureStorageEnabled()) {
    return NextResponse.redirect(await createArtifactReadUrl(jobId, "video"));
  }
  const videoPath = jobPaths(jobId).video;
  let size: number;
  try {
    size = (await fs.stat(videoPath)).size;
  } catch {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const nodeStream = createReadStream(videoPath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
