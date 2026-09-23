import { promises as fs } from "fs";
import {
  deleteArtifact,
  downloadArtifact,
  getArtifactSize,
  uploadArtifactFromFile,
} from "./artifacts";
import { getQueueClient, isAzureStorageEnabled } from "./azure";
import { renderOverlays } from "./overlay";
import { burnCaptions, probeVideo } from "./ffmpeg";
import { ensureJobDir, jobPaths } from "./paths";
import { readMeta, updateMeta } from "./store";

const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;

// Lightweight in-process FIFO queue with a single worker. Structured so it can
// be swapped for BullMQ/Redis later without touching the API routes.
interface QueueState {
  pending: string[];
  running: boolean;
}

// Persist across hot reloads / route invocations in dev.
const g = globalThis as unknown as { __captionQueue?: QueueState };
const state: QueueState = g.__captionQueue ?? { pending: [], running: false };
g.__captionQueue = state;

export async function enqueueRender(jobId: string): Promise<void> {
  if (isAzureStorageEnabled()) {
    await getQueueClient().sendMessage(JSON.stringify({ jobId }));
    return;
  }
  if (!state.pending.includes(jobId)) state.pending.push(jobId);
  void drain();
}

async function drain(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    while (state.pending.length > 0) {
      const jobId = state.pending.shift()!;
      await processJob(jobId);
    }
  } finally {
    state.running = false;
  }
}

export async function processJob(jobId: string): Promise<void> {
  const meta = await readMeta(jobId);
  if (!meta || meta.status === "done") return;

  const paths = jobPaths(jobId);
  let progressUpdates = Promise.resolve<unknown>(undefined);
  let reportedProgress = 0;
  try {
    await updateMeta(jobId, { status: "processing", progress: 0, error: undefined });

    if (isAzureStorageEnabled()) {
      await ensureJobDir(jobId);
      const size = await getArtifactSize(jobId, "video");
      if (size > MAX_VIDEO_BYTES) throw new Error("Video exceeds the 600 MB limit.");
      await downloadArtifact(jobId, "video", paths.video);
      const video = await probeVideo(paths.video);
      if (video.durationMs > MAX_DURATION_MS) {
        throw new Error("Video exceeds the 10-minute limit.");
      }
      meta.video = video;
      await updateMeta(jobId, { video });
    }

    const width = meta.video?.width || 1080;
    const height = meta.video?.height || 1920;
    const overlays = await renderOverlays(
      meta.segments,
      paths.overlays,
      width,
      height,
      meta.captionStyle,
    );

    await burnCaptions({
      input: paths.video,
      overlays,
      output: paths.output,
      durationMs: meta.video?.durationMs ?? 0,
      onProgress: (percent) => {
        if (percent < reportedProgress + 5) return;
        reportedProgress = percent;
        progressUpdates = progressUpdates.then(() =>
          updateMeta(jobId, { progress: percent }),
        );
      },
    });

    await progressUpdates;
    await uploadArtifactFromFile(jobId, "output", paths.output, "video/mp4");
    await Promise.all([
      deleteArtifact(jobId, "video"),
      deleteArtifact(jobId, "srt"),
    ]);
    await updateMeta(jobId, { status: "done", progress: 100 });
  } catch (err) {
    await progressUpdates.catch(() => undefined);
    await updateMeta(jobId, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (isAzureStorageEnabled()) {
      await fs.rm(paths.dir, { recursive: true, force: true });
    }
  }
}
