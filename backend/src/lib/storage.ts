import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env";

/** Where uploaded document content lives. Keys are generated here, never taken from users. */
export interface DocumentStorage {
  put(key: string, content: Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9]{1,40}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newStorageKey(companyId: string) {
  return `${companyId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40) || "company"}/${randomUUID()}`;
}

export class LocalDiskStorage implements DocumentStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, content: Readable) {
    const full = this.pathFor(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(content, createWriteStream(full, { flags: "wx" }));
  }

  async get(key: string) {
    const full = this.pathFor(key);
    await stat(full);
    return createReadStream(full);
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}

/**
 * S3-compatible object storage (AWS S3, MinIO, R2, …) via the REST API and SigV4.
 * Avoids a hard dependency on the AWS SDK; configure with DOCUMENT_STORAGE=s3 and the usual env vars.
 */
export class S3Storage implements DocumentStorage {
  constructor(
    private readonly opts: {
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    },
  ) {}

  private objectUrl(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    if (this.opts.endpoint) {
      const base = this.opts.endpoint.replace(/\/$/, "");
      return this.opts.forcePathStyle !== false
        ? `${base}/${this.opts.bucket}/${encoded}`
        : `${base.replace(/^(https?:\/\/)/, `$1${this.opts.bucket}.`)}/${encoded}`;
    }
    return `https://${this.opts.bucket}.s3.${this.opts.region}.amazonaws.com/${encoded}`;
  }

  private async signed(method: string, key: string, body?: Buffer) {
    const url = new URL(this.objectUrl(key));
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(body ?? Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (body) headers["content-type"] = "application/octet-stream";
    const signedHeaders = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
      .join(";");
    const canonicalHeaders = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
      .map((h) => `${h}:${headers[h].trim()}\n`)
      .join("");
    const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${this.opts.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");
    const signingKey = await awsSigningKey(this.opts.secretAccessKey, dateStamp, this.opts.region, "s3");
    const signature = await hmacHex(signingKey, stringToSign);
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url: url.toString(), headers };
  }

  async put(key: string, content: Readable) {
    const body = await bufferFrom(content);
    const { url, headers } = await this.signed("PUT", key, body);
    const res = await fetch(url, { method: "PUT", headers, body });
    if (!res.ok) throw new Error(`S3 put failed (${res.status}): ${await res.text()}`);
  }

  async get(key: string) {
    const { url, headers } = await this.signed("GET", key);
    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 404) throw Object.assign(new Error("Document not found in storage"), { status: 404 });
    if (!res.ok) throw new Error(`S3 get failed (${res.status}): ${await res.text()}`);
    if (!res.body) throw new Error("S3 get returned an empty body");
    return Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  }

  async delete(key: string) {
    const { url, headers } = await this.signed("DELETE", key);
    const res = await fetch(url, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status}): ${await res.text()}`);
  }
}

async function bufferFrom(content: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function sha256Hex(data: string | Buffer) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

async function hmac(key: Buffer | string, data: string) {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", key).update(data).digest();
}

async function hmacHex(key: Buffer, data: string) {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", key).update(data).digest("hex");
}

async function awsSigningKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = await hmac(`AWS4${secret}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** Resolved per call so the directory / driver can be configured (and swapped in tests) at runtime. */
export function documentStorage(): DocumentStorage {
  if (env.documentStorageDriver === "s3") {
    if (!env.s3Bucket || !env.s3AccessKeyId || !env.s3SecretAccessKey) {
      throw new Error("DOCUMENT_STORAGE=s3 requires DOCUMENT_S3_BUCKET, DOCUMENT_S3_ACCESS_KEY_ID and DOCUMENT_S3_SECRET_ACCESS_KEY");
    }
    return new S3Storage({
      bucket: env.s3Bucket,
      region: env.s3Region,
      endpoint: env.s3Endpoint,
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
      forcePathStyle: env.s3ForcePathStyle,
    });
  }
  return new LocalDiskStorage(env.documentStorageDir);
}
