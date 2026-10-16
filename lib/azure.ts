import { DefaultAzureCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";
import {
  BlobServiceClient,
  ContainerClient,
} from "@azure/storage-blob";
import { QueueClient } from "@azure/storage-queue";

const DEFAULT_CONTAINER = "caption-jobs";
const DEFAULT_TABLE = "CaptionJobs";
const DEFAULT_QUEUE = "caption-renders";
const DEFAULT_TRANSCRIBE_QUEUE = "caption-transcriptions";

// Rendering and speech-to-text run on separate queues so each worker job can be
// sized for its own workload.
export type QueueKind = "render" | "transcribe";

let credential: DefaultAzureCredential | undefined;
let blobServiceClient: BlobServiceClient | undefined;
let tableClient: TableClient | undefined;
const queueClients = new Map<QueueKind, QueueClient>();

export function isAzureStorageEnabled(): boolean {
  return process.env.CAPTION_STORAGE === "azure";
}

export function getStorageAccountName(): string {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error("AZURE_STORAGE_ACCOUNT_NAME is required in Azure mode.");
  }
  return accountName;
}

function getCredential(): DefaultAzureCredential {
  credential ??= new DefaultAzureCredential();
  return credential;
}

export function getBlobServiceClient(): BlobServiceClient {
  const accountName = getStorageAccountName();
  blobServiceClient ??= new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    getCredential(),
  );
  return blobServiceClient;
}

export function getContainerClient(): ContainerClient {
  return getBlobServiceClient().getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER || DEFAULT_CONTAINER,
  );
}

export function getTableClient(): TableClient {
  const accountName = getStorageAccountName();
  tableClient ??= new TableClient(
    `https://${accountName}.table.core.windows.net`,
    process.env.AZURE_STORAGE_TABLE || DEFAULT_TABLE,
    getCredential(),
  );
  return tableClient;
}

export function getQueueClient(kind: QueueKind = "render"): QueueClient {
  let client = queueClients.get(kind);
  if (!client) {
    const queueName =
      kind === "transcribe"
        ? process.env.AZURE_STORAGE_TRANSCRIBE_QUEUE || DEFAULT_TRANSCRIBE_QUEUE
        : process.env.AZURE_STORAGE_QUEUE || DEFAULT_QUEUE;
    client = new QueueClient(
      `https://${getStorageAccountName()}.queue.core.windows.net/${queueName}`,
      getCredential(),
    );
    queueClients.set(kind, client);
  }
  return client;
}

export function assertJobId(jobId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("Invalid job ID.");
  }
}