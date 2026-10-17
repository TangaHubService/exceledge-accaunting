import { config as loadEnv } from "dotenv";
import path from "path";

// Load monorepo root .env when running from apps/api
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

export const env = {
  port: Number(process.env.PORT ?? 4600),
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  integrationApiKey: process.env.INTEGRATION_API_KEY ?? "dev-integration-key",
  erpApiUrl: (process.env.ERP_API_URL ?? "http://localhost:4500/api").replace(/\/$/, ""),
  nodeEnv: process.env.NODE_ENV ?? "development",
  /** Base URL of the accounting web app, for links in emailed notifications */
  webAppUrl: (process.env.ACCOUNTING_WEB_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  documentStorageDir: path.resolve(process.env.DOCUMENT_STORAGE_DIR ?? path.resolve(__dirname, "../../storage/documents")),
  documentMaxBytes: Number(process.env.DOCUMENT_MAX_BYTES ?? 10 * 1024 * 1024),
  /** `local` (default) or `s3` for S3-compatible object storage */
  documentStorageDriver: (process.env.DOCUMENT_STORAGE ?? "local").toLowerCase() === "s3" ? ("s3" as const) : ("local" as const),
  s3Bucket: process.env.DOCUMENT_S3_BUCKET ?? "",
  s3Region: process.env.DOCUMENT_S3_REGION ?? process.env.AWS_REGION ?? "us-east-1",
  s3Endpoint: process.env.DOCUMENT_S3_ENDPOINT || undefined,
  s3AccessKeyId: process.env.DOCUMENT_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.DOCUMENT_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
  s3ForcePathStyle: (process.env.DOCUMENT_S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
};
