// Overall transcription progress is split into phases so the UI can label what
// the worker is doing instead of sitting on one number.
export const TRANSCRIPTION_PHASES = {
  audio: [0, 8],
  language: [8, 14],
  speech: [14, 98],
} as const satisfies Record<string, readonly [number, number]>;

export function transcriptionStageLabel(
  status: string | undefined,
  progress: number,
): string {
  if (status === "queued") return "Waiting to transcribe";
  if (status === "pending") return "Starting transcription";
  if (progress < TRANSCRIPTION_PHASES.audio[1]) return "Extracting audio";
  if (progress < TRANSCRIPTION_PHASES.language[1]) return "Detecting language";
  return "Transcribing speech";
}
