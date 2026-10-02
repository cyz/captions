import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { VideoInfo } from "./store";
import { classifyVideoFormat } from "./video-format";
import { TARGET_ASPECT } from "./safezone";

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
    "stream=width,height:format=duration",
    "-of",
    "json",
    inputPath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`);

  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  const width = Number(stream.width) || 0;
  const height = Number(stream.height) || 0;
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

// Burn captions by compositing pre-rendered transparent PNG overlays onto the
// video with the core `overlay` filter (no libass/freetype required).
// Reports progress 0..100.
export async function burnCaptions(opts: {
  input: string;
  overlays: CaptionOverlay[];
  blank: string;
  output: string;
  durationMs: number;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { input, overlays, blank, output, durationMs, signal, onProgress } = opts;

  const args: string[] = ["-y", "-i", input];
  if (overlays.length > 0) {
    const timeline = await writeOverlayTimeline(overlays, blank);
    args.push(
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      timeline,
      "-filter_complex",
      "[0:v][1:v]overlay=0:0:format=auto:eof_action=repeat[vout]",
      "-map",
      "[vout]",
      "-map",
      "0:a?",
    );
  } else {
    args.push("-map", "0:v", "-map", "0:a?");
  }
  args.push(
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    output,
  );

  const timeRe = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;
  const { code, stderr } = await run(
    "ffmpeg",
    args,
    (chunk) => {
      const m = timeRe.exec(chunk);
      if (m && durationMs > 0 && onProgress) {
        const ms =
          parseInt(m[1], 10) * 3600000 +
          parseInt(m[2], 10) * 60000 +
          parseInt(m[3], 10) * 1000 +
          parseInt(m[4], 10) * 10;
        onProgress(Math.min(99, Math.round((ms / durationMs) * 100)));
      }
    },
    signal,
  );

  if (code !== 0) throw new Error(`ffmpeg burn-in failed: ${stderr.slice(-800)}`);
}
