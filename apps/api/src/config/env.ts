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
};
