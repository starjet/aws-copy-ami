import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import type { S3Client } from "@aws-sdk/client-s3";
import { compressS3Object, type StreamUploader } from "../src/aws/compress";

/** Minimal in-memory S3 double: Head/Get/Delete only (upload is injected). */
class FakeS3 {
  readonly store = new Map<string, Buffer>();
  readonly deleted: string[] = [];

  constructor(seed: Record<string, Buffer>) {
    for (const [key, value] of Object.entries(seed)) this.store.set(key, value);
  }

  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> {
    const name = command.constructor.name;
    const key = String(command.input.Key);

    if (name === "HeadObjectCommand") {
      const buf = this.store.get(key);
      if (!buf) {
        const err = new Error("NotFound");
        err.name = "NotFound";
        throw err;
      }
      return { ContentLength: buf.length };
    }
    if (name === "GetObjectCommand") {
      return { Body: Readable.from(this.store.get(key) ?? Buffer.alloc(0)) };
    }
    if (name === "DeleteObjectCommand") {
      this.store.delete(key);
      this.deleted.push(key);
      return {};
    }
    throw new Error(`Unexpected S3 command in test: ${name}`);
  }
}

function harness(seed: Record<string, Buffer>): {
  fake: FakeS3;
  client: S3Client;
  uploader: StreamUploader;
  progressEvents: number[];
} {
  const fake = new FakeS3(seed);
  // Test double: structurally sufficient for compressS3Object's usage.
  const client = fake as unknown as S3Client;
  const progressEvents: number[] = [];

  const uploader: StreamUploader = async (_s3, params) => {
    const chunks: Buffer[] = [];
    for await (const chunk of params.body) chunks.push(Buffer.from(chunk as Uint8Array));
    const buf = Buffer.concat(chunks);
    fake.store.set(params.key, buf);
    params.onProgress?.(buf.length);
    progressEvents.push(buf.length);
  };

  return { fake, client, uploader, progressEvents };
}

describe("compressS3Object", () => {
  const original = Buffer.from("hello world ".repeat(5000), "utf8");

  it("gzips the source into <key>.gz and deletes the original by default", async () => {
    const { fake, client, uploader, progressEvents } = harness({ "ami-123.bin": original });

    const result = await compressS3Object(
      client,
      { bucket: "my-bucket", sourceKey: "ami-123.bin", gzipLevel: 6, deleteOriginal: true },
      uploader,
    );

    expect(result.targetKey).toBe("ami-123.bin.gz");
    expect(result.deletedOriginal).toBe(true);
    expect(result.sourceBytes).toBe(original.length);

    const gz = fake.store.get("ami-123.bin.gz");
    expect(gz).toBeDefined();
    expect(gunzipSync(gz!).equals(original)).toBe(true);
    expect(result.targetBytes).toBe(gz!.length);
    expect(gz!.length).toBeLessThan(original.length); // repetitive data compresses
    expect(progressEvents.length).toBeGreaterThan(0);

    expect(fake.store.has("ami-123.bin")).toBe(false);
    expect(fake.deleted).toContain("ami-123.bin");
  });

  it("keeps the original when deleteOriginal is false", async () => {
    const { fake, client, uploader } = harness({ "ami-456.bin": original });

    const result = await compressS3Object(
      client,
      { bucket: "my-bucket", sourceKey: "ami-456.bin", gzipLevel: 1, deleteOriginal: false },
      uploader,
    );

    expect(result.deletedOriginal).toBe(false);
    expect(fake.store.has("ami-456.bin")).toBe(true);
    expect(fake.store.has("ami-456.bin.gz")).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it("refuses a target key equal to the source key", async () => {
    const { client, uploader } = harness({ "x.bin": original });
    await expect(
      compressS3Object(
        client,
        { bucket: "b", sourceKey: "x.bin", targetKey: "x.bin", gzipLevel: 6, deleteOriginal: false },
        uploader,
      ),
    ).rejects.toThrow(/differ from the source key/);
  });
});
