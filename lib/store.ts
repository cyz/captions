import { promises as fs } from "fs";
import type { TableEntity, TableEntityResult } from "@azure/data-tables";
import { Segment } from "./srt";
import type { Cut } from "./cuts";
import type { Silence } from "./silence";
import { getTableClient, isAzureStorageEnabled } from "./azure";
import { ensureJobDir, jobPaths } from "./paths";
import type { VideoFormat } from "./video-format";
import {
  getDefaultCaptionStyle,
  normalizeCaptionStyle,
  type CaptionStyle,
} from "./caption-style";

export type JobStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "done"
  | "cancelled"
  | "error";

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  isVertical916: boolean;
  format: VideoFormat;
}

// Speech-to-text state, tracked apart from the render status so exporting and
// transcribing never overwrite each other.
export type TranscriptionStatus =
  | "pending"
  | "queued"
  | "processing"
  | "done"
  | "error";

export interface Transcription {
  status: TranscriptionStatus;
  progress: number; // 0..100
  // ISO 639-1 code of the detected (or requested) spoken language.
  language?: string;
  error?: string;
}

export function isTranscribing(meta: JobMeta): boolean {
  const status = meta.transcription?.status;
  return status === "queued" || status === "processing";
}

// "burned" draws the captions into the picture; "soft" keeps them as a
// selectable subtitle track inside the MP4.
export type ExportMode = "burned" | "soft";

export interface JobMeta {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  progress: number; // 0..100
  error?: string;
  video?: VideoInfo;
  segments: Segment[];
  captionStyle?: CaptionStyle;
  transcription?: Transcription;
  // Pauses found in the audio during transcription.
  silences?: Silence[];
  // Stretches of the source video removed from the export.
  cuts?: Cut[];
  exportMode?: ExportMode;
}

interface JobEntity {
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  progress: number;
  error?: string;
  videoJson?: string;
  segmentsJson: string;
  captionStyleJson?: string;
  transcriptionJson?: string;
  silencesJson?: string;
  cutsJson?: string;
  exportMode?: ExportMode;
}

const PARTITION_KEY = "jobs";
// Table Storage caps a string property at 32K characters.
const SEGMENT_CHUNK_CHARS = 30000;

function segmentChunks(
  segments: Segment[],
): { segmentsJson: string } & Record<string, string> {
  const json = JSON.stringify(segments);
  const chunks: Record<string, string> = { segmentsJson: "" };
  let start = 0;
  let n = 0;
  do {
    let end = Math.min(json.length, start + SEGMENT_CHUNK_CHARS);
    // Never split a surrogate pair across two properties.
    const next = json.charCodeAt(end);
    if (end < json.length && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    chunks[n === 0 ? "segmentsJson" : `segmentsJson${n}`] = json.slice(start, end);
    start = end;
    n += 1;
  } while (start < json.length);
  return chunks as { segmentsJson: string } & Record<string, string>;
}

function readSegments(entity: object): Segment[] {
  const fields = entity as Record<string, unknown>;
  let json = String(fields.segmentsJson ?? "[]");
  for (let n = 1; typeof fields[`segmentsJson${n}`] === "string"; n++) {
    json += fields[`segmentsJson${n}`];
  }
  return JSON.parse(json) as Segment[];
}

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
    ...segmentChunks(meta.segments),
    captionStyleJson: JSON.stringify(
      normalizeCaptionStyle(
        meta.captionStyle ?? getDefaultCaptionStyle(meta.video?.format),
        meta.video?.format,
      ),
    ),
    ...(meta.transcription
      ? { transcriptionJson: JSON.stringify(meta.transcription) }
      : {}),
    ...(meta.silences ? { silencesJson: JSON.stringify(meta.silences) } : {}),
    ...(meta.cuts ? { cutsJson: JSON.stringify(meta.cuts) } : {}),
    ...(meta.exportMode ? { exportMode: meta.exportMode } : {}),
  };
}

function fromEntity(entity: TableEntityResult<JobEntity>): JobMeta {
  const video = entity.videoJson
    ? (JSON.parse(entity.videoJson) as VideoInfo)
    : undefined;
  return {
    id: String(entity.rowKey),
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    progress: entity.progress,
    ...(entity.error ? { error: entity.error } : {}),
    ...(video ? { video } : {}),
    segments: readSegments(entity),
    captionStyle: normalizeCaptionStyle(
      entity.captionStyleJson ? JSON.parse(entity.captionStyleJson) : undefined,
      video?.format,
    ),
    ...(entity.transcriptionJson
      ? { transcription: JSON.parse(entity.transcriptionJson) as Transcription }
      : {}),
    ...(entity.silencesJson ? { silences: JSON.parse(entity.silencesJson) as Silence[] } : {}),
    ...(entity.cutsJson ? { cuts: JSON.parse(entity.cutsJson) as Cut[] } : {}),
    ...(entity.exportMode ? { exportMode: entity.exportMode } : {}),
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
