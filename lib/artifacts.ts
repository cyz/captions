import { createReadStream, promises as fs } from "fs";
import { Readable } from "stream";
import {
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import {
  assertJobId,
  getBlobServiceClient,
  getContainerClient,
  getStorageAccountName,
  isAzureStorageEnabled,
} from "./azure";
import { jobPaths } from "./paths";

export type JobArtifact = "video" | "srt" | "output";

const BLOB_NAMES: Record<JobArtifact, string> = {
  video: "input.mp4",
  srt: "input.srt",
  output: "output.mp4",
};

function blobName(jobId: string, artifact: JobArtifact): string {
  assertJobId(jobId);
  const prefix = artifact === "output" ? "output" : "input";
  return `${prefix}/${jobId}/${BLOB_NAMES[artifact]}`;
}

function localPath(jobId: string, artifact: JobArtifact): string {
  return jobPaths(jobId)[artifact];
}

async function createBlobUrl(
  jobId: string,
  artifact: JobArtifact,
  permissions: string,
  lifetimeMinutes: number,
): Promise<string> {
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + lifetimeMinutes * 60 * 1000);
  const serviceClient = getBlobServiceClient();
  const delegationKey = await serviceClient.getUserDelegationKey(startsOn, expiresOn);
  const containerClient = getContainerClient();
  const name = blobName(jobId, artifact);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: containerClient.containerName,
      blobName: name,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      ...(artifact === "output"
        ? {
            contentType: "video/mp4",
            contentDisposition: `attachment; filename="captioned-${jobId}.mp4"`,
          }
        : {}),
    },
    delegationKey,
    getStorageAccountName(),
  );
  return `${containerClient.getBlockBlobClient(name).url}?${sas}`;
}

export async function createVideoUploadUrl(jobId: string): Promise<string> {
  if (!isAzureStorageEnabled()) {
    throw new Error("Direct uploads are only available in Azure mode.");
  }
  return createBlobUrl(jobId, "video", "cw", 30);
}

export async function createArtifactReadUrl(
  jobId: string,
  artifact: "video" | "output",
): Promise<string> {
  if (!isAzureStorageEnabled()) {
    throw new Error("Signed URLs are only available in Azure mode.");
  }
  return createBlobUrl(jobId, artifact, "r", 15);
}

export async function getArtifactSize(
  jobId: string,
  artifact: JobArtifact,
): Promise<number> {
  if (!isAzureStorageEnabled()) {
    return (await fs.stat(localPath(jobId, artifact))).size;
  }
  const client = getContainerClient().getBlockBlobClient(blobName(jobId, artifact));
  const properties = await client.getProperties();
  return properties.contentLength ?? 0;
}

export async function writeArtifact(
  jobId: string,
  artifact: JobArtifact,
  data: Buffer | string,
  contentType: string,
): Promise<void> {
  if (!isAzureStorageEnabled()) {
    await fs.writeFile(localPath(jobId, artifact), data);
    return;
  }
  const client = getContainerClient().getBlockBlobClient(blobName(jobId, artifact));
  await client.uploadData(typeof data === "string" ? Buffer.from(data) : data, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

export async function downloadArtifact(
  jobId: string,
  artifact: JobArtifact,
  destination: string,
): Promise<void> {
  if (!isAzureStorageEnabled()) {
    await fs.copyFile(localPath(jobId, artifact), destination);
    return;
  }
  const client = getContainerClient().getBlockBlobClient(blobName(jobId, artifact));
  await client.downloadToFile(destination);
}

export async function uploadArtifactFromFile(
  jobId: string,
  artifact: JobArtifact,
  source: string,
  contentType: string,
): Promise<void> {
  if (!isAzureStorageEnabled()) return;
  const client = getContainerClient().getBlockBlobClient(blobName(jobId, artifact));
  await client.uploadFile(source, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

export async function openArtifactDownload(
  jobId: string,
  artifact: JobArtifact,
): Promise<{ stream: Readable; contentLength?: number }> {
  if (!isAzureStorageEnabled()) {
    const path = localPath(jobId, artifact);
    return {
      stream: createReadStream(path),
      contentLength: (await fs.stat(path)).size,
    };
  }

  const client = getContainerClient().getBlockBlobClient(blobName(jobId, artifact));
  const response = await client.download();
  if (!(response.readableStreamBody instanceof Readable)) {
    throw new Error(`Blob ${artifact} has no readable body.`);
  }
  return {
    stream: response.readableStreamBody,
    contentLength: response.contentLength,
  };
}

export async function deleteArtifact(
  jobId: string,
  artifact: JobArtifact,
): Promise<void> {
  if (!isAzureStorageEnabled()) {
    await fs.rm(localPath(jobId, artifact), { force: true });
    return;
  }

  const client = getContainerClient().getBlockBlobClient(blobName(jobId, artifact));
  await client.deleteIfExists({ deleteSnapshots: "include" });
}
