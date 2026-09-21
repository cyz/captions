import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { createArtifactReadUrl } from "@/lib/artifacts";
import { isAzureStorageEnabled } from "@/lib/azure";
import { jobPaths } from "@/lib/paths";
import { readMeta } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const meta = await readMeta(jobId);
  if (!meta || meta.status !== "done") {
    return NextResponse.json({ error: "Video is not ready yet." }, { status: 404 });
  }

  if (isAzureStorageEnabled()) {
    return NextResponse.redirect(await createArtifactReadUrl(jobId, "output"));
  }

  const outputPath = jobPaths(jobId).output;
  let size: number;
  try {
    size = (await fs.stat(outputPath)).size;
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const nodeStream = createReadStream(outputPath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="captioned-${jobId}.mp4"`,
    },
  });
}
