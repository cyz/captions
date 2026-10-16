// Silent stretches of the audio, as [startMs, endMs] pairs.
export type Silence = [number, number];

const FRAME_MS = 20;

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

// Find pauses in mono audio. The threshold adapts to the recording: it sits
// between the noise floor and the speech level, so a noisy room or a quiet
// voice does not turn every breath into a pause.
export function detectSilences(
  samples: Float32Array,
  sampleRate: number,
  minMs = 350,
): Silence[] {
  const frameSize = Math.round((sampleRate * FRAME_MS) / 1000);
  const frames = Math.floor(samples.length / frameSize);
  if (frames === 0) return [];

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const offset = f * frameSize;
    for (let i = 0; i < frameSize; i++) sum += samples[offset + i] * samples[offset + i];
    energy[f] = Math.sqrt(sum / frameSize);
  }

  const sorted = [...energy].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const speech = percentile(sorted, 0.9);
  if (speech < 0.003) return [];
  const threshold = Math.min(speech * 0.15, Math.max(floor * 2.5, speech * 0.04));

  const silences: Silence[] = [];
  let runStart = -1;
  const close = (endFrame: number) => {
    if (runStart < 0) return;
    const start = runStart * FRAME_MS;
    const end = endFrame * FRAME_MS;
    if (end - start >= minMs) silences.push([start, end]);
    runStart = -1;
  };
  for (let f = 0; f < frames; f++) {
    if (energy[f] < threshold) {
      if (runStart < 0) runStart = f;
    } else {
      close(f);
    }
  }
  close(frames);
  return silences;
}

export function isSilence(value: unknown): value is Silence {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[1] > value[0]
  );
}
