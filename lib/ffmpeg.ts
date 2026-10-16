import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { VideoInfo } from "./store";
import { classifyVideoFormat } from "./video-format";
import { TARGET_ASPECT } from "./safezone";
import { keptRanges, totalCutMs, type Cut, type Range } from "./cuts";

function run(
  cmd: string,
  args: string[],
  onStderr?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      onStderr?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

// Probe basic video info via ffprobe.
export async function probeVideo(inputPath: string): Promise<VideoInfo> {
  const { stdout, code, stderr } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:stream_side_data=rotation:stream_tags=rotate:format=duration",
    "-of",
    "json",
    inputPath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);

  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  let width = Number(stream.width) || 0;
  let height = Number(stream.height) || 0;
  // FFmpeg and browsers auto-apply rotation, so captions follow displayed size.
  const rotation = Math.abs(
    Number(
      stream.side_data_list?.find(
        (entry: { rotation?: number }) => entry.rotation !== undefined,
      )?.rotation ??
        stream.tags?.rotate ??
        0,
    ),
  );
  if (rotation % 180 === 90) [width, height] = [height, width];
  const durationMs = Math.round((Number(parsed.format?.duration) || 0) * 1000);

  const aspect = height > 0 ? width / height : 0;
  const isVertical916 = Math.abs(aspect - TARGET_ASPECT) < 0.02;

  return {
    width,
    height,
    durationMs,
    isVertical916,
    format: classifyVideoFormat(width, height),
  };
}

function sec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

export interface CaptionOverlay {
  path: string;
  start: number; // ms
  end: number; // ms
}

// Lay the overlays out as one timeline (blank frames fill the gaps) so ffmpeg
// reads a single input instead of one per caption or word.
async function writeOverlayTimeline(
  overlays: CaptionOverlay[],
  blank: string,
): Promise<string> {
  const quote = (file: string) => `'${file.replace(/'/g, "'\\''")}'`;
  const lines = ["ffconcat version 1.0"];
  const entry = (file: string, durationMs: number) =>
    lines.push(`file ${quote(file)}`, `duration ${sec(durationMs)}`);

  let cursor = 0;
  for (const overlay of [...overlays].sort((a, b) => a.start - b.start)) {
    const start = Math.max(overlay.start, cursor);
    const end = Math.max(overlay.end, start);
    if (end === start) continue;
    if (start > cursor) entry(blank, start - cursor);
    entry(overlay.path, end - start);
    cursor = end;
  }
  // The last frame stays on screen, so it must be the blank one; the concat
  // demuxer also ignores the duration of its final entry unless repeated.
  entry(blank, 1000);
  lines.push(`file ${quote(blank)}`);

  const listPath = path.join(path.dirname(blank), "timeline.ffconcat");
  await fs.writeFile(listPath, `${lines.join("\n")}\n`, "utf8");
  return listPath;
}

let ffmpegMajor: Promise<number> | undefined;

function getFfmpegMajor(): Promise<number> {
  ffmpegMajor ??= run("ffmpeg", ["-version"]).then(
    ({ stdout }) => Number(/ffmpeg version n?(\d+)/.exec(stdout)?.[1]) || 0,
    () => 0,
  );
  return ffmpegMajor;
}

// Long filter graphs go through a file. FFmpeg 7 renamed the option.
async function filterGraphArgs(graph: string, dir: string): Promise<string[]> {
  const file = path.join(dir, "filters.txt");
  await fs.writeFile(file, graph, "utf8");
  return (await getFfmpegMajor()) >= 7
    ? ["-/filter_complex", file]
    : ["-filter_complex_script", file];
}

// Keep only the given stretches of the source and join them. trim + concat
// (instead of select) keeps audio and video in sync for variable frame rate
// recordings such as screen captures.
function buildCutGraph(kept: Range[], hasAudio: boolean): string {
  const t = (ms: number) => (ms / 1000).toFixed(3);
  const count = kept.length;
  const lines: string[] = [];

  if (count === 1) {
    lines.push(`[0:v]trim=start=${t(kept[0].start)}:end=${t(kept[0].end)},setpts=PTS-STARTPTS[cv]`);
    if (hasAudio) {
      lines.push(`[0:a]atrim=start=${t(kept[0].start)}:end=${t(kept[0].end)},asetpts=PTS-STARTPTS[ca]`);
    }
    return lines.join(";\n");
  }

  const labels = (prefix: string) => kept.map((_, i) => `[${prefix}${i}]`).join("");
  lines.push(`[0:v]split=${count}${labels("sv")}`);
  if (hasAudio) lines.push(`[0:a]asplit=${count}${labels("sa")}`);
  kept.forEach((range, i) => {
    lines.push(`[sv${i}]trim=start=${t(range.start)}:end=${t(range.end)},setpts=PTS-STARTPTS[tv${i}]`);
    if (hasAudio) {
      lines.push(`[sa${i}]atrim=start=${t(range.start)}:end=${t(range.end)},asetpts=PTS-STARTPTS[ta${i}]`);
    }
  });
  const inputs = kept.map((_, i) => `[tv${i}]${hasAudio ? `[ta${i}]` : ""}`).join("");
  lines.push(`${inputs}concat=n=${count}:v=1:a=${hasAudio ? 1 : 0}[cv]${hasAudio ? "[ca]" : ""}`);
  return lines.join(";\n");
}

function parseProgress(chunk: string, durationMs: number): number | null {
  const m = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(chunk);
  if (!m || durationMs <= 0) return null;
  const ms =
    parseInt(m[1], 10) * 3600000 +
    parseInt(m[2], 10) * 60000 +
    parseInt(m[3], 10) * 1000 +
    parseInt(m[4], 10) * 10;
  return Math.min(99, Math.round((ms / durationMs) * 100));
}

// Burn captions by compositing pre-rendered transparent PNG overlays onto the
// video with the core `overlay` filter (no libass/freetype required). Cuts
// remove stretches of the source first, and the overlays are already timed for
// the shortened video. `durationMs` is the length of the source video.
// Reports progress 0..100.
export async function burnCaptions(opts: {
  input: string;
  overlays: CaptionOverlay[];
  blank: string;
  output: string;
  durationMs: number;
  cuts?: Cut[];
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { input, overlays, blank, output, durationMs, signal, onProgress } = opts;
  const cuts = opts.cuts ?? [];
  const outputMs = durationMs - totalCutMs(cuts);

  const args: string[] = ["-y", "-i", input];
  const graph: string[] = [];
  let videoLabel = "0:v";
  let audioMap = "0:a?";
  const reencodeAudio = cuts.length > 0;

  if (cuts.length > 0) {
    const kept = keptRanges(cuts, durationMs);
    if (kept.length === 0) throw new Error("Nothing is left after the cuts.");
    const hasAudio = await hasAudioStream(input);
    graph.push(buildCutGraph(kept, hasAudio));
    videoLabel = "cv";
    if (hasAudio) audioMap = "[ca]";
    else audioMap = "";
  }

  if (overlays.length > 0) {
    args.push("-f", "concat", "-safe", "0", "-i", await writeOverlayTimeline(overlays, blank));
    graph.push(
      `[${videoLabel}][1:v]overlay=0:0:format=auto:eof_action=repeat[vout]`,
    );
    videoLabel = "vout";
  }

  if (graph.length > 0) {
    if (cuts.length > 0) {
      args.push(...(await filterGraphArgs(graph.join(";\n"), path.dirname(blank))));
    } else {
      args.push("-filter_complex", graph.join(";"));
    }
  }
  args.push("-map", graph.length > 0 ? `[${videoLabel}]` : "0:v");
  if (audioMap) args.push("-map", audioMap);

  args.push(
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    ...(reencodeAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]),
    output,
  );

  const { code, stderr } = await run(
    "ffmpeg",
    args,
    (chunk) => {
      const percent = parseProgress(chunk, outputMs);
      if (percent !== null) onProgress?.(percent);
    },
    signal,
  );

  if (code !== 0) throw new Error(`ffmpeg burn-in failed: ${stderr.slice(-800)}`);
}

// ISO 639-1 (Whisper) to the ISO 639-2 code MP4 subtitle tracks use.
const LANGUAGE_CODES: Record<string, string> = {
  pt: "por", en: "eng", es: "spa", fr: "fra", de: "deu", it: "ita", nl: "nld",
  ja: "jpn", ko: "kor", zh: "zho", ru: "rus", pl: "pol", tr: "tur", ar: "ara",
  hi: "hin", sv: "swe", uk: "ukr", cs: "ces", ro: "ron", id: "ind",
};

// Export with the captions as a selectable subtitle track (mov_text) instead of
// drawing them into the picture. Without cuts the streams are copied, so it is
// nearly instant and lossless.
export async function muxSoftSubtitles(opts: {
  input: string;
  srt: string;
  output: string;
  durationMs: number;
  language?: string;
  cuts?: Cut[];
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { input, srt, output, durationMs, signal, onProgress } = opts;
  const cuts = opts.cuts ?? [];
  const outputMs = durationMs - totalCutMs(cuts);
  const args: string[] = ["-y", "-i", input, "-i", srt];

  if (cuts.length > 0) {
    const kept = keptRanges(cuts, durationMs);
    if (kept.length === 0) throw new Error("Nothing is left after the cuts.");
    const hasAudio = await hasAudioStream(input);
    args.push(...(await filterGraphArgs(buildCutGraph(kept, hasAudio), path.dirname(output))));
    args.push("-map", "[cv]");
    if (hasAudio) args.push("-map", "[ca]");
    args.push("-map", "1:0", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p");
    if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-map", "0:v", "-map", "0:a?", "-map", "1:0", "-c:v", "copy", "-c:a", "copy");
  }
  args.push(
    "-c:s",
    "mov_text",
    "-metadata:s:s:0",
    `language=${LANGUAGE_CODES[(opts.language ?? "").toLowerCase()] ?? "und"}`,
    "-disposition:s:0",
    "default",
    "-movflags",
    "+faststart",
    output,
  );

  const { code, stderr } = await run(
    "ffmpeg",
    args,
    (chunk) => {
      const percent = parseProgress(chunk, outputMs);
      if (percent !== null) onProgress?.(percent);
    },
    signal,
  );
  if (code !== 0) throw new Error(`ffmpeg subtitle export failed: ${stderr.slice(-800)}`);
}

export async function hasAudioStream(inputPath: string): Promise<boolean> {
  const { stdout, code, stderr } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    inputPath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);
  return stdout.trim().length > 0;
}

export const WHISPER_SAMPLE_RATE = 16000;

// Decode the first audio track to the mono 16 kHz float samples Whisper expects.
export function extractAudioSamples(
  inputPath: string,
  signal?: AbortSignal,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(WHISPER_SAMPLE_RATE),
        "-f",
        "f32le",
        "pipe:1",
      ],
      { signal },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg audio extraction failed: ${stderr.slice(-500)}`));
        return;
      }
      const bytes = Buffer.concat(chunks);
      const samples = new Float32Array(Math.floor(bytes.length / 4));
      for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
      resolve(samples);
    });
  });
}
