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

let credential: DefaultAzureCredential | undefined;
let blobServiceClient: BlobServiceClient | undefined;
let tableClient: TableClient | undefined;
let queueClient: QueueClient | undefined;

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

export function getQueueClient(): QueueClient {
  const accountName = getStorageAccountName();
  queueClient ??= new QueueClient(
    `https://${accountName}.queue.core.windows.net/${
      process.env.AZURE_STORAGE_QUEUE || DEFAULT_QUEUE
    }`,
    getCredential(),
  );
  return queueClient;
}

export function assertJobId(jobId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("Invalid job ID.");
  }
}