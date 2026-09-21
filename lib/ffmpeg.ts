import { spawn } from "child_process";
import { VideoInfo } from "./store";
import { TARGET_ASPECT } from "./safezone";

function run(
  cmd: string,
  args: string[],
  onStderr?: (chunk: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
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

  return { width, height, durationMs, isVertical916 };
}

function sec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

export interface CaptionOverlay {
  path: string;
  start: number; // ms
  end: number; // ms
}

// Burn captions by compositing pre-rendered transparent PNG overlays onto the
// video with the core `overlay` filter (no libass/freetype required).
// Reports progress 0..100.
export async function burnCaptions(opts: {
  input: string;
  overlays: CaptionOverlay[];
  output: string;
  durationMs: number;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { input, overlays, output, durationMs, onProgress } = opts;

  const inputArgs: string[] = ["-y", "-i", input];
  for (const ov of overlays) inputArgs.push("-i", ov.path);

  // Chain one overlay per segment, each active only within its time window.
  const filterParts: string[] = [];
  let last = "0:v";
  overlays.forEach((ov, i) => {
    const label = i === overlays.length - 1 ? "vout" : `t${i}`;
    filterParts.push(
      `[${last}][${i + 1}:v]overlay=0:0:enable='between(t,${sec(
        ov.start,
      )},${sec(ov.end)})'[${label}]`,
    );
    last = label;
  });

  const args = [...inputArgs];
  if (overlays.length > 0) {
    args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]", "-map", "0:a?");
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
  const { code, stderr } = await run("ffmpeg", args, (chunk) => {
    const m = timeRe.exec(chunk);
    if (m && durationMs > 0 && onProgress) {
      const ms =
        parseInt(m[1], 10) * 3600000 +
        parseInt(m[2], 10) * 60000 +
        parseInt(m[3], 10) * 1000 +
        parseInt(m[4], 10) * 10;
      onProgress(Math.min(99, Math.round((ms / durationMs) * 100)));
    }
  });

  if (code !== 0) throw new Error(`ffmpeg burn-in failed: ${stderr.slice(-800)}`);
}
