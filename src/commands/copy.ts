import { EC2Client } from "@aws-sdk/client-ec2";
import { S3Client } from "@aws-sdk/client-s3";
import type { CredentialOptions } from "../aws/credentials";
import { clientConfig, requireRegion, resolveAuth, verifyIdentity } from "../aws/credentials";
import { describeImage, storeAmiToS3 } from "../aws/storeImage";
import { compressS3Object } from "../aws/compress";
import { formatBytes, parsePositiveInt, parseTags } from "../util";
import * as log from "../logger";

export interface CopyOptions extends CredentialOptions {
  amiId: string;
  bucket: string;
  compress: boolean; // commander maps --no-compress to false (default true)
  keepOriginal?: boolean;
  tags?: string;
  pollInterval: string;
  timeout: string;
  gzipLevel: string;
}

export async function copyCommand(opts: CopyOptions): Promise<void> {
  const tags = parseTags(opts.tags);
  const pollIntervalMs = parsePositiveInt(opts.pollInterval, "--poll-interval") * 1000;
  const timeoutMs = parsePositiveInt(opts.timeout, "--timeout") * 1000;
  const gzipLevel = parsePositiveInt(opts.gzipLevel, "--gzip-level");
  if (gzipLevel > 9) {
    throw new Error("--gzip-level must be between 1 and 9.");
  }

  const auth = resolveAuth(opts);
  const region = requireRegion(auth);

  log.step(`Authenticating (source: ${auth.source})…`);
  const identity = await verifyIdentity(auth);
  log.success(
    `Authenticated as ${identity.arn ?? identity.userId ?? "unknown"} (account ${identity.account ?? "?"}).`,
  );

  const ec2 = new EC2Client(clientConfig(auth));
  const s3 = new S3Client(clientConfig(auth));
  try {
    log.step(`Looking up AMI ${opts.amiId} in ${region}…`);
    const image = await describeImage(ec2, opts.amiId);
    log.info(`  Name:  ${image.name ?? "(unnamed)"}`);
    log.info(`  State: ${image.state ?? "unknown"}`);

    log.step(`Starting store-image task to s3://${opts.bucket}/ …`);
    let lastState = "";
    const stored = await storeAmiToS3(ec2, {
      amiId: opts.amiId,
      bucket: opts.bucket,
      tags,
      pollIntervalMs,
      timeoutMs,
      onProgress: (percent, state) => {
        lastState = state;
        log.progress(`Storing AMI → S3: ${state} ${percent}%`);
      },
    });
    log.progressDone();
    log.success(`Stored AMI to s3://${stored.bucket}/${stored.objectKey} (task ${lastState}).`);

    let finalKey = stored.objectKey;
    if (opts.compress) {
      log.step(`Compressing s3://${stored.bucket}/${stored.objectKey} with gzip (level ${gzipLevel})…`);
      const compressed = await compressS3Object(s3, {
        bucket: stored.bucket,
        sourceKey: stored.objectKey,
        gzipLevel,
        deleteOriginal: !opts.keepOriginal,
        onProgress: (uploaded) => log.progress(`Uploading compressed object: ${formatBytes(uploaded)} written`),
      });
      log.progressDone();
      finalKey = compressed.targetKey;

      const savings =
        compressed.sourceBytes && compressed.targetBytes
          ? ` (${((1 - compressed.targetBytes / compressed.sourceBytes) * 100).toFixed(1)}% smaller)`
          : "";
      log.success(`Compressed → s3://${stored.bucket}/${compressed.targetKey}`);
      log.info(`  Original:   ${formatBytes(compressed.sourceBytes)}`);
      log.info(`  Compressed: ${formatBytes(compressed.targetBytes)}${savings}`);
      if (compressed.deletedOriginal) {
        log.success(`Removed uncompressed original s3://${stored.bucket}/${compressed.sourceKey}.`);
      } else {
        log.info(`Kept uncompressed original s3://${stored.bucket}/${compressed.sourceKey} (--keep-original).`);
      }
    } else {
      log.info("Compression skipped (--no-compress); uncompressed object retained.");
    }

    // Machine-readable final location on stdout.
    log.result(`s3://${stored.bucket}/${finalKey}`);
  } finally {
    ec2.destroy();
    s3.destroy();
  }
}
