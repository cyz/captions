// Overall export progress is split into phases so the UI can show a steady bar
// and a human-readable stage instead of sitting at 0% until FFmpeg starts.
export const RENDER_PHASES = {
  prepare: [0, 5],
  captions: [5, 15],
  encode: [15, 99],
} as const satisfies Record<string, readonly [number, number]>;

export type RenderPhase = keyof typeof RENDER_PHASES;

export function phaseProgress(phase: RenderPhase, fraction: number): number {
  const [from, to] = RENDER_PHASES[phase];
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(from + (to - from) * clamped);
}

export function renderStageLabel(status: string | null, progress: number): string {
  if (status === "queued") return "Waiting in queue";
  if (status === "done") return "Video ready";
  if (progress < RENDER_PHASES.captions[0]) return "Preparing video";
  if (progress < RENDER_PHASES.encode[0]) return "Drawing captions";
  return "Encoding video";
}
