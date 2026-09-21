import { promises as fs } from "fs";
import type { TableEntity, TableEntityResult } from "@azure/data-tables";
import { Segment } from "./srt";
import { getTableClient, isAzureStorageEnabled } from "./azure";
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

interface JobEntity {
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  progress: number;
  error?: string;
  videoJson?: string;
  segmentsJson: string;
}

const PARTITION_KEY = "jobs";

function toEntity(meta: JobMeta): TableEntity<JobEntity> {
  return {
    partitionKey: PARTITION_KEY,
    rowKey: meta.id,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    progress: meta.progress,
    ...(meta.error ? { error: meta.error } : {}),
    ...(meta.video ? { videoJson: JSON.stringify(meta.video) } : {}),
    segmentsJson: JSON.stringify(meta.segments),
  };
}

function fromEntity(entity: TableEntityResult<JobEntity>): JobMeta {
  return {
    id: String(entity.rowKey),
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    progress: entity.progress,
    ...(entity.error ? { error: entity.error } : {}),
    ...(entity.videoJson ? { video: JSON.parse(entity.videoJson) as VideoInfo } : {}),
    segments: JSON.parse(entity.segmentsJson) as Segment[],
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

export async function readMeta(jobId: string): Promise<JobMeta | null> {
  if (isAzureStorageEnabled()) {
    try {
      const entity = await getTableClient().getEntity<JobEntity>(PARTITION_KEY, jobId);
      return fromEntity(entity);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
  try {
    const raw = await fs.readFile(jobPaths(jobId).meta, "utf8");
    return JSON.parse(raw) as JobMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(meta: JobMeta): Promise<void> {
  meta.updatedAt = Date.now();
  if (isAzureStorageEnabled()) {
    await getTableClient().upsertEntity(toEntity(meta), "Replace");
    return;
  }
  await ensureJobDir(meta.id);
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
