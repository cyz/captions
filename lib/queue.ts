import { renderOverlays } from "./overlay";
import { burnCaptions } from "./ffmpeg";
import { jobPaths } from "./paths";
import { readMeta, updateMeta } from "./store";

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

export function enqueueRender(jobId: string): void {
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

async function processJob(jobId: string): Promise<void> {
  const meta = await readMeta(jobId);
  if (!meta) return;

  const paths = jobPaths(jobId);
  try {
    await updateMeta(jobId, { status: "processing", progress: 0, error: undefined });

    const width = meta.video?.width || 1080;
    const height = meta.video?.height || 1920;
    const overlays = await renderOverlays(
      meta.segments,
      paths.overlays,
      width,
      height,
    );

    await burnCaptions({
      input: paths.video,
      overlays,
      output: paths.output,
      durationMs: meta.video?.durationMs ?? 0,
      onProgress: (percent) => {
        void updateMeta(jobId, { progress: percent });
      },
    });

    await updateMeta(jobId, { status: "done", progress: 100 });
  } catch (err) {
    await updateMeta(jobId, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
