// Downloads the Whisper model into WHISPER_CACHE_DIR at image build time so
// transcription jobs start without a network fetch.
import { env, pipeline } from "@huggingface/transformers";

env.cacheDir = process.env.WHISPER_CACHE_DIR || ".cache/whisper";
const model =
  process.env.WHISPER_MODEL || "onnx-community/whisper-small_timestamped";

await pipeline("automatic-speech-recognition", model, {
  dtype: process.env.WHISPER_DTYPE || "q8",
  device: "cpu",
});
console.log(`Cached ${model} in ${env.cacheDir}`);
