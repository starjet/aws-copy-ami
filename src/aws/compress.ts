import { createGzip } from "node:zlib";
import type { Readable } from "node:stream";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export interface CompressOptions {
  bucket: string;
  sourceKey: string;
  targetKey?: string;
  gzipLevel: number;
  deleteOriginal: boolean;
  partSizeBytes?: number;
  queueSize?: number;
  onProgress?: (uploadedBytes: number) => void;
}

export interface CompressResult {
  sourceKey: string;
  targetKey: string;
  sourceBytes?: number;
  targetBytes?: number;
  deletedOriginal: boolean;
}

export interface StreamUploadParams {
  bucket: string;
  key: string;
  body: Readable;
  contentType: string;
  partSizeBytes: number;
  queueSize: number;
  onProgress?: (uploadedBytes: number) => void;
}

/** Streaming-upload seam: the real impl uses lib-storage; tests inject a double. */
export type StreamUploader = (s3: S3Client, params: StreamUploadParams) => Promise<void>;

/** Default uploader: multipart streaming upload via @aws-sdk/lib-storage. */
export const libStorageUploader: StreamUploader = async (s3, params) => {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    },
    partSize: params.partSizeBytes,
    queueSize: params.queueSize,
  });
  if (params.onProgress) {
    const report = params.onProgress;
    upload.on("httpUploadProgress", (p) => {
      if (p.loaded !== undefined) report(p.loaded);
    });
  }
  await upload.done();
};

/**
 * Stream an existing S3 object through gzip into `<key>.gz` using a multipart
 * upload (no local disk), then optionally delete the uncompressed original.
 */
export async function compressS3Object(
  s3: S3Client,
  opts: CompressOptions,
  uploader: StreamUploader = libStorageUploader,
): Promise<CompressResult> {
  const targetKey = opts.targetKey ?? `${opts.sourceKey}.gz`;
  if (targetKey === opts.sourceKey) {
    throw new Error("Compressed target key must differ from the source key.");
  }

  const head = await s3.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: opts.sourceKey }));
  const sourceBytes = head.ContentLength;

  const got = await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: opts.sourceKey }));
  if (!got.Body) {
    throw new Error(`Source object s3://${opts.bucket}/${opts.sourceKey} returned no body.`);
  }

  // In Node, S3 GetObject Body is always a Readable stream (not Blob/ReadableStream); safe to treat as such.
  const body = got.Body as Readable;
  const gzip = createGzip({ level: opts.gzipLevel });
  // Propagate download errors into the gzip stream so the upload rejects.
  body.on("error", (err) => gzip.destroy(err));
  const compressed = body.pipe(gzip);

  await uploader(s3, {
    bucket: opts.bucket,
    key: targetKey,
    body: compressed,
    contentType: "application/gzip",
    partSizeBytes: opts.partSizeBytes ?? 64 * 1024 * 1024,
    queueSize: opts.queueSize ?? 4,
    onProgress: opts.onProgress,
  });

  const targetHead = await s3.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: targetKey }));
  const targetBytes = targetHead.ContentLength;

  let deletedOriginal = false;
  if (opts.deleteOriginal) {
    await s3.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: opts.sourceKey }));
    deletedOriginal = true;
  }

  return { sourceKey: opts.sourceKey, targetKey, sourceBytes, targetBytes, deletedOriginal };
}
