import { promises as fs } from "fs";
import {
  deleteArtifact,
  downloadArtifact,
  getArtifactSize,
  uploadArtifactFromFile,
} from "./artifacts";
import { getQueueClient, isAzureStorageEnabled } from "./azure";
import { wordsToSegments } from "./segmentation";
import { classifyVideoFormat } from "./video-format";
import { renderOverlays, writeBlankOverlay } from "./overlay";
import { burnCaptions, muxSoftSubtitles, probeVideo } from "./ffmpeg";
import { normalizeCuts, remapSegments } from "./cuts";
import { serializeSrt } from "./srt";
import { ensureJobDir, jobPaths } from "./paths";
import { readMeta, updateMeta, type Transcription } from "./store";
import { phaseProgress } from "./render-progress";

const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;

export type QueueTask = "render" | "transcribe";

// Lightweight in-process FIFO queue with a single worker. Structured so it can
// be swapped for BullMQ/Redis later without touching the API routes.
interface QueueItem {
  jobId: string;
  task: QueueTask;
}

interface QueueState {
  pending: QueueItem[];
  running: boolean;
}

// Persist across hot reloads / route invocations in dev.
const g = globalThis as unknown as { __captionQueue?: QueueState };
const state: QueueState =
  g.__captionQueue ?? { pending: [], running: false };
g.__captionQueue = state;

async function enqueue(jobId: string, task: QueueTask): Promise<void> {
  if (isAzureStorageEnabled()) {
    await getQueueClient(task).sendMessage(JSON.stringify({ jobId, task }));
    return;
  }
  if (!state.pending.some((item) => item.jobId === jobId && item.task === task)) {
    state.pending.push({ jobId, task });
  }
  void drain();
}

export const enqueueRender = (jobId: string) => enqueue(jobId, "render");
export const enqueueTranscription = (jobId: string) =>
  enqueue(jobId, "transcribe");

export function cancelQueued(jobId: string): void {
  state.pending = state.pending.filter(
    (item) => !(item.jobId === jobId && item.task === "render"),
  );
}

// Exact for the local queue; approximate in Azure (visible + in-flight messages).
export async function jobsAhead(jobId: string): Promise<number | null> {
  try {
    if (isAzureStorageEnabled()) {
      const properties = await getQueueClient().getProperties();
      return Math.max(0, (properties.approximateMessagesCount ?? 1) - 1);
    }
    const position = state.pending.findIndex(
      (item) => item.jobId === jobId && item.task === "render",
    );
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
      const { jobId, task } = state.pending.shift()!;
      if (task === "transcribe") await processTranscription(jobId);
      else await processJob(jobId);
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
    const durationMs = meta.video?.durationMs ?? 0;
    // Captions are authored on the source timeline; the export may be shorter.
    const cuts = normalizeCuts(meta.cuts ?? [], durationMs || Infinity);
    const segments = remapSegments(meta.segments, cuts);

    if (meta.exportMode === "soft") {
      report(phaseProgress("captions", 1));
      await fs.writeFile(paths.srt, serializeSrt(segments), "utf8");
      await muxSoftSubtitles({
        input: paths.video,
        srt: paths.srt,
        output: paths.output,
        durationMs,
        language: meta.transcription?.language,
        cuts,
        signal: abort.signal,
        onProgress: (percent) => report(phaseProgress("encode", percent / 100)),
      });
    } else {
      const overlays = await renderOverlays(
        segments,
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
        durationMs,
        cuts,
        signal: abort.signal,
        onProgress: (percent) => report(phaseProgress("encode", percent / 100)),
      });
    }

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

// Generate captions from the video's audio with Whisper.
export async function processTranscription(jobId: string): Promise<void> {
  const meta = await readMeta(jobId);
  if (!meta || !meta.transcription || meta.transcription.status === "done") return;

  const paths = jobPaths(jobId);
  let updates = Promise.resolve<unknown>(undefined);
  let reported = 0;
  const setTranscription = (next: Transcription) => {
    updates = updates.then(() => updateMeta(jobId, { transcription: next }));
    return updates;
  };
  const report = (percent: number) => {
    if (percent < reported + 2) return;
    reported = percent;
    void setTranscription({ status: "processing", progress: percent });
  };

  try {
    await setTranscription({ status: "processing", progress: 0 });

    let video = meta.video;
    if (isAzureStorageEnabled()) {
      await ensureJobDir(jobId);
      const size = await getArtifactSize(jobId, "video");
      if (size > MAX_VIDEO_BYTES) throw new Error("Video exceeds the 600 MB limit.");
      await downloadArtifact(jobId, "video", paths.video);
      video = await probeVideo(paths.video);
      if (video.durationMs > MAX_DURATION_MS) {
        throw new Error("Video exceeds the 10-minute limit.");
      }
    }

    const { transcribeVideo } = await import("./transcribe");
    const result = await transcribeVideo(paths.video, { onProgress: report });
    const segments = wordsToSegments(result.words, {
      format: video ? classifyVideoFormat(video.width, video.height) : "social",
    });
    await updates;
    await updateMeta(jobId, {
      segments,
      silences: result.silences,
      cuts: [],
      ...(video ? { video } : {}),
      transcription: { status: "done", progress: 100, language: result.language },
    });
  } catch (error) {
    await updates.catch(() => undefined);
    console.error("Transcription failed", error);
    await updateMeta(jobId, {
      transcription: {
        status: "error",
        progress: 0,
        error:
          error instanceof Error ? error.message : "Could not transcribe this video.",
      },
    });
  } finally {
    if (isAzureStorageEnabled()) {
      await fs.rm(paths.dir, { recursive: true, force: true });
    }
  }
}
