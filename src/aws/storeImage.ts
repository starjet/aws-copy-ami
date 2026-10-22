import { setTimeout as delay } from "node:timers/promises";
import {
  EC2Client,
  CreateStoreImageTaskCommand,
  DescribeStoreImageTasksCommand,
  DescribeImagesCommand,
} from "@aws-sdk/client-ec2";

export interface ImageSummary {
  imageId: string;
  name?: string;
  state?: string;
  ownerId?: string;
}

/** Confirm the AMI exists and is visible to the caller; returns a summary. */
export async function describeImage(ec2: EC2Client, amiId: string): Promise<ImageSummary> {
  const out = await ec2.send(new DescribeImagesCommand({ ImageIds: [amiId] }));
  const image = out.Images?.[0];
  if (!image) {
    throw new Error(`AMI ${amiId} not found or not accessible with these credentials in this region.`);
  }
  return { imageId: image.ImageId ?? amiId, name: image.Name, state: image.State, ownerId: image.OwnerId };
}

export interface StoreOptions {
  amiId: string;
  bucket: string;
  tags?: { key: string; value: string }[];
  pollIntervalMs: number;
  timeoutMs: number;
  onProgress?: (percent: number, state: string) => void;
}

export interface StoreResult {
  objectKey: string;
  bucket: string;
}

/**
 * Store an AMI into S3 via EC2 CreateStoreImageTask (object key `<ami-id>.bin`),
 * then poll DescribeStoreImageTasks until the task completes, fails, or times out.
 */
export async function storeAmiToS3(ec2: EC2Client, opts: StoreOptions): Promise<StoreResult> {
  const created = await ec2.send(
    new CreateStoreImageTaskCommand({
      ImageId: opts.amiId,
      Bucket: opts.bucket,
      S3ObjectTags:
        opts.tags && opts.tags.length > 0
          ? opts.tags.map((t) => ({ Key: t.key, Value: t.value }))
          : undefined,
    }),
  );
  const objectKey = created.ObjectKey;
  if (!objectKey) {
    throw new Error("CreateStoreImageTask did not return an object key.");
  }

  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const described = await ec2.send(new DescribeStoreImageTasksCommand({ ImageIds: [opts.amiId] }));
    const task = described.StoreImageTaskResults?.find((t) => t.AmiId === opts.amiId);
    const state = task?.StoreTaskState ?? "Pending";
    const percent = task?.ProgressPercentage ?? 0;
    opts.onProgress?.(percent, state);

    if (state === "Completed") {
      return { objectKey, bucket: opts.bucket };
    }
    if (state === "Failed") {
      throw new Error(`Store task failed: ${task?.StoreTaskFailureReason ?? "unknown reason"}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${Math.round(opts.timeoutMs / 1000)}s waiting for store task ` +
          `(last state: ${state}, ${percent}%).`,
      );
    }

    await delay(opts.pollIntervalMs);
  }
}
