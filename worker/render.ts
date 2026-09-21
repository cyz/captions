import { getQueueClient, isAzureStorageEnabled } from "../lib/azure";
import { processJob } from "../lib/queue";

async function main(): Promise<void> {
  if (!isAzureStorageEnabled()) {
    throw new Error("The render worker requires CAPTION_STORAGE=azure.");
  }

  const queue = getQueueClient();
  const response = await queue.receiveMessages({
    numberOfMessages: 1,
    visibilityTimeout: 3600,
  });
  const message = response.receivedMessageItems[0];
  if (!message) return;

  let jobId: string;
  try {
    const body = JSON.parse(message.messageText) as { jobId?: string };
    if (!body.jobId) throw new Error("Queue message has no jobId.");
    jobId = body.jobId;
  } catch (error) {
    await queue.deleteMessage(message.messageId, message.popReceipt);
    throw error;
  }

  await processJob(jobId);
  await queue.deleteMessage(message.messageId, message.popReceipt);
}

main().catch((error) => {
  console.error("Render worker failed", error);
  process.exitCode = 1;
});