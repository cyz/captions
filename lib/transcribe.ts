import path from "path";
import { extractAudioSamples, hasAudioStream, WHISPER_SAMPLE_RATE } from "./ffmpeg";
import type { TimedWord } from "./segmentation";
import { detectSilences, type Silence } from "./silence";
import { TRANSCRIPTION_PHASES } from "./transcription-progress";

const DEFAULT_MODEL = "onnx-community/whisper-small_timestamped";
const SLICE_SECONDS = 120;
// A slice boundary is moved to the quietest moment within this distance.
const SPLIT_SEARCH_SECONDS = 5;
const LANGUAGE_WINDOW_SECONDS = 30;
const SILENCE_RMS = 0.002;

interface Tensor {
  data: Float32Array;
  dims: number[];
}

// The parts of the Transformers.js ASR pipeline this module relies on.
interface SpeechPipeline {
  (
    audio: Float32Array,
    options: Record<string, unknown>,
  ): Promise<{ chunks?: Array<{ text: string; timestamp: [number, number | null] }> }>;
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: {
    generation_config?: {
      lang_to_id?: Record<string, number>;
      decoder_start_token_id?: number;
    };
    forward: (inputs: Record<string, unknown>) => Promise<{ logits: Tensor }>;
  };
}

export interface TranscribeOptions {
  // ISO 639-1 code; detected from the audio when omitted.
  language?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export interface TranscriptionResult {
  words: TimedWord[];
  language: string;
  silences: Silence[];
}

export class NoSpeechError extends Error {
  constructor(message = "No speech was detected in this video.") {
    super(message);
    this.name = "NoSpeechError";
  }
}

let speechPipeline: Promise<SpeechPipeline> | undefined;

// The model loads once per process. Production images bake it into
// WHISPER_CACHE_DIR and set WHISPER_OFFLINE=1 so nothing is downloaded at run time.
function loadPipeline(): Promise<SpeechPipeline> {
  speechPipeline ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir =
      process.env.WHISPER_CACHE_DIR ||
      path.join(process.cwd(), ".cache", "whisper");
    if (process.env.WHISPER_OFFLINE === "1") env.allowRemoteModels = false;
    const loaded = await pipeline(
      "automatic-speech-recognition",
      process.env.WHISPER_MODEL || DEFAULT_MODEL,
      {
        dtype: (process.env.WHISPER_DTYPE || "q8") as "q8",
        device: "cpu",
      },
    );
    return loaded as unknown as SpeechPipeline;
  })().catch((error) => {
    speechPipeline = undefined;
    throw error;
  });
  return speechPipeline;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Slice boundaries near every SLICE_SECONDS, nudged onto the quietest 50 ms
// frame so words are not cut in half.
export function findSliceBoundaries(samples: Float32Array): number[] {
  const rate = WHISPER_SAMPLE_RATE;
  const frame = Math.round(rate * 0.05);
  const boundaries = [0];
  let target = SLICE_SECONDS * rate;
  while (target < samples.length - SLICE_SECONDS * rate * 0.25) {
    const from = Math.max(
      boundaries[boundaries.length - 1] + rate,
      target - SPLIT_SEARCH_SECONDS * rate,
    );
    const to = Math.min(samples.length - frame, target + SPLIT_SEARCH_SECONDS * rate);
    let best = target;
    let bestEnergy = Infinity;
    for (let at = from; at + frame <= to; at += frame) {
      const energy = rms(samples.subarray(at, at + frame));
      if (energy < bestEnergy) {
        bestEnergy = energy;
        best = at;
      }
    }
    boundaries.push(best);
    target = best + SLICE_SECONDS * rate;
  }
  boundaries.push(samples.length);
  return boundaries;
}

// Whisper's own language identification: the decoder's first prediction after
// the start token is a distribution over language tokens. Several windows are
// combined so a silent or musical intro does not decide the result.
async function detectLanguage(
  asr: SpeechPipeline,
  samples: Float32Array,
  signal?: AbortSignal,
): Promise<string> {
  const config = asr.model.generation_config;
  const languages = Object.entries(config?.lang_to_id ?? {});
  if (languages.length === 0) return "en";
  const { Tensor } = await import("@huggingface/transformers");
  const start = BigInt(config?.decoder_start_token_id ?? 50258);

  const window = LANGUAGE_WINDOW_SECONDS * WHISPER_SAMPLE_RATE;
  const offsets =
    samples.length <= window
      ? [0]
      : [0, 1 / 3, 2 / 3].map((fraction) =>
          Math.floor((samples.length - window) * fraction),
        );
  const totals = new Map<string, number>();

  for (const offset of offsets) {
    if (signal?.aborted) throw new Error("Transcription cancelled.");
    const slice = samples.subarray(offset, offset + window);
    if (rms(slice) < SILENCE_RMS) continue;
    const { input_features } = await asr.processor(slice);
    const { logits } = await asr.model.forward({
      input_features,
      decoder_input_ids: new Tensor("int64", BigInt64Array.from([start]), [1, 1]),
    });
    const scores = languages.map(([, id]) => logits.data[id]);
    const peak = Math.max(...scores);
    const exp = scores.map((score) => Math.exp(score - peak));
    const sum = exp.reduce((a, b) => a + b, 0);
    languages.forEach(([token], i) => {
      const code = token.slice(2, -2);
      totals.set(code, (totals.get(code) ?? 0) + exp[i] / sum);
    });
  }

  let best = "en";
  let bestScore = -1;
  for (const [code, score] of totals) {
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return best;
}

// Whisper can loop on a word during noise; keep at most three in a row.
export function dropRepeatedWords(words: TimedWord[]): TimedWord[] {
  const normalize = (text: string) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const result: TimedWord[] = [];
  let run = 0;
  for (const word of words) {
    const previous = result[result.length - 1];
    run = previous && normalize(previous.text) === normalize(word.text) ? run + 1 : 1;
    if (run <= 3) result.push(word);
  }
  return result;
}

export async function transcribeVideo(
  videoPath: string,
  { language, signal, onProgress }: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const phase = (name: keyof typeof TRANSCRIPTION_PHASES, fraction: number) => {
    const [from, to] = TRANSCRIPTION_PHASES[name];
    onProgress?.(Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction))));
  };
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new Error("Transcription cancelled.");
  };

  phase("audio", 0);
  if (!(await hasAudioStream(videoPath))) {
    throw new NoSpeechError("This video has no audio track to transcribe.");
  }
  const samples = await extractAudioSamples(videoPath, signal);
  if (samples.length < WHISPER_SAMPLE_RATE * 0.5 || rms(samples) < SILENCE_RMS) {
    throw new NoSpeechError();
  }

  phase("language", 0);
  const asr = await loadPipeline();
  throwIfCancelled();
  const detected = language ?? (await detectLanguage(asr, samples, signal));
  phase("language", 1);

  const boundaries = findSliceBoundaries(samples);
  const words: TimedWord[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    throwIfCancelled();
    phase("speech", i / (boundaries.length - 1));
    const slice = samples.subarray(boundaries[i], boundaries[i + 1]);
    if (rms(slice) < SILENCE_RMS) continue;
    const offsetMs = (boundaries[i] / WHISPER_SAMPLE_RATE) * 1000;
    const output = await asr(slice, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      language: detected,
      task: "transcribe",
    });
    for (const chunk of output.chunks ?? []) {
      const [start, end] = chunk.timestamp;
      if (start === null || start === undefined) continue;
      words.push({
        text: chunk.text,
        start: offsetMs + start * 1000,
        end: offsetMs + (end ?? start + 0.3) * 1000,
      });
    }
  }
  phase("speech", 1);

  const cleaned = dropRepeatedWords(words).filter((word) => word.text.trim() !== "");
  if (cleaned.length === 0) throw new NoSpeechError();
  return {
    words: cleaned,
    language: detected,
    silences: detectSilences(samples, WHISPER_SAMPLE_RATE),
  };
}
