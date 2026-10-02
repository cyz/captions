import { promises as fs } from "fs";
import {
  deleteArtifact,
  downloadArtifact,
  getArtifactSize,
  uploadArtifactFromFile,
} from "./artifacts";
import { getQueueClient, isAzureStorageEnabled } from "./azure";
import { renderOverlays, writeBlankOverlay } from "./overlay";
import { burnCaptions, probeVideo } from "./ffmpeg";
import { ensureJobDir, jobPaths } from "./paths";
import { readMeta, updateMeta } from "./store";
import { phaseProgress } from "./render-progress";

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

export function cancelQueued(jobId: string): void {
  state.pending = state.pending.filter((id) => id !== jobId);
}

// Exact for the local queue; approximate in Azure (visible + in-flight messages).
export async function jobsAhead(jobId: string): Promise<number | null> {
  try {
    if (isAzureStorageEnabled()) {
      const properties = await getQueueClient().getProperties();
      return Math.max(0, (properties.approximateMessagesCount ?? 1) - 1);
    }
    const position = state.pending.indexOf(jobId);
    if (position === -1) return null;
    return position + (state.running ? 1 : 0);
  } catch {
    return null;
  }
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
  if (!meta || meta.status === "done" || meta.status === "cancelled") return;

  const paths = jobPaths(jobId);
  const abort = new AbortController();
  // The worker may run in another process, so cancellation is read from the store.
  const cancelWatcher = setInterval(() => {
    void readMeta(jobId).then((current) => {
      if (current?.status === "cancelled") abort.abort();
    }, () => undefined);
  }, 2000);
  const throwIfCancelled = () => {
    if (abort.signal.aborted) throw new Error("Export cancelled.");
  };
  let progressUpdates = Promise.resolve<unknown>(undefined);
  let reportedProgress = 0;
  const report = (percent: number) => {
    if (abort.signal.aborted) return;
    if (percent < reportedProgress + 2) return;
    reportedProgress = percent;
    progressUpdates = progressUpdates.then(() =>
      updateMeta(jobId, { progress: percent }),
    );
  };
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
    report(phaseProgress("prepare", 1));

    const width = meta.video?.width || 1080;
    const height = meta.video?.height || 1920;
    const overlays = await renderOverlays(
      meta.segments,
      paths.overlays,
      width,
      height,
      meta.captionStyle,
      (done, total) => {
        throwIfCancelled();
        report(phaseProgress("captions", total ? done / total : 1));
      },
    );

    throwIfCancelled();
    await burnCaptions({
      input: paths.video,
      overlays,
      blank: await writeBlankOverlay(paths.overlays, width, height),
      output: paths.output,
      durationMs: meta.video?.durationMs ?? 0,
      signal: abort.signal,
      onProgress: (percent) => report(phaseProgress("encode", percent / 100)),
    });

    await progressUpdates;
    throwIfCancelled();
    await uploadArtifactFromFile(jobId, "output", paths.output, "video/mp4");
    await Promise.all([
      deleteArtifact(jobId, "video"),
      deleteArtifact(jobId, "srt"),
    ]);
    await updateMeta(jobId, { status: "done", progress: 100 });
  } catch (err) {
    await progressUpdates.catch(() => undefined);
    if (abort.signal.aborted) {
      await fs.rm(paths.output, { force: true });
      await deleteArtifact(jobId, "output").catch(() => undefined);
    } else {
      await fs.rm(paths.output, { force: true });
      await updateMeta(jobId, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    clearInterval(cancelWatcher);
    await fs.rm(paths.overlays, { recursive: true, force: true });
    if (isAzureStorageEnabled()) {
      await fs.rm(paths.dir, { recursive: true, force: true });
    }
  }
}
