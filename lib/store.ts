import { promises as fs } from "fs";
import { Segment } from "./srt";
import { ensureJobDir, jobPaths } from "./paths";

export type JobStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "done"
  | "error";

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  isVertical916: boolean;
}

export interface JobMeta {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  progress: number; // 0..100
  error?: string;
  video?: VideoInfo;
  segments: Segment[];
}

export async function readMeta(jobId: string): Promise<JobMeta | null> {
  try {
    const raw = await fs.readFile(jobPaths(jobId).meta, "utf8");
    return JSON.parse(raw) as JobMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(meta: JobMeta): Promise<void> {
  await ensureJobDir(meta.id);
  meta.updatedAt = Date.now();
  await fs.writeFile(jobPaths(meta.id).meta, JSON.stringify(meta, null, 2), "utf8");
}

export async function updateMeta(
  jobId: string,
  patch: Partial<JobMeta>,
): Promise<JobMeta | null> {
  const current = await readMeta(jobId);
  if (!current) return null;
  const next = { ...current, ...patch, id: current.id };
  await writeMeta(next);
  return next;
}
