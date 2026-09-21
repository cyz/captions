import path from "path";
import { promises as fs } from "fs";

// Azure workers use ephemeral storage; local development keeps ./data.
export const DATA_ROOT = process.env.DATA_ROOT || path.join(process.cwd(), "data");
export const JOBS_ROOT = path.join(DATA_ROOT, "jobs");

export function jobDir(jobId: string): string {
  return path.join(JOBS_ROOT, jobId);
}

export function jobPaths(jobId: string) {
  const dir = jobDir(jobId);
  return {
    dir,
    meta: path.join(dir, "meta.json"),
    video: path.join(dir, "input.mp4"),
    srt: path.join(dir, "input.srt"),
    overlays: path.join(dir, "overlays"),
    output: path.join(dir, "output.mp4"),
  };
}

export async function ensureJobDir(jobId: string): Promise<string> {
  const dir = jobDir(jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
