import type { Router } from "express";
import { API_KEY_SCOPES } from "../../middleware/auth";
import { WEBHOOK_EVENTS } from "./webhook.service";

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean>; stack: Array<{ handle: { capability?: string } }> } };

const QUERY_HINTS: Record<string, string> = {
  from: "Start date, YYYY-MM-DD",
  to: "End date, YYYY-MM-DD",
  asOf: "As at date, YYYY-MM-DD",
  format: "csv, xlsx or pdf to download the report instead of JSON",
};

/** Routes an API key can call: GET routes guarded by a capability that is a key scope. */
export function apiKeyRoutes(mounts: Array<[string, Router]>) {
  const scopes = new Set<string>(API_KEY_SCOPES);
  const routes: Array<{ path: string; scope: string }> = [];
  for (const [base, router] of mounts) {
    for (const layer of router.stack as unknown as Layer[]) {
      const route = layer.route;
      if (!route?.methods.get) continue;
      const scope = route.stack.map((s) => s.handle.capability).find((c) => c && scopes.has(c));
      if (!scope) continue;
      for (const path of Array.isArray(route.path) ? route.path : [route.path]) routes.push({ path: `${base}${path === "/" ? "" : path}`, scope });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/** OpenAPI 3.1 description of the API-key routes and the webhook payloads. */
export function openApiDocument(mounts: Array<[string, Router]>, serverUrl = "/") {
  const paths: Record<string, unknown> = {};
  for (const { path, scope } of apiKeyRoutes(mounts)) {
    const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    const openPath = path.replace(/:(\w+)/g, "{$1}");
    const tag = path.split("/")[3] ?? "api";
    paths[openPath] = {
      get: {
        tags: [tag],
        summary: `GET ${openPath}`,
        description: `Requires an API key with the \`${scope}\` scope.`,
        security: [{ apiKeyHeader: [] }, { apiKeyAuthorization: [] }],
        parameters: [
          ...params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
          ...Object.entries(QUERY_HINTS).map(([name, description]) => ({ name, in: "query", required: false, description, schema: { type: "string" } })),
        ],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
          "401": { description: "Missing, invalid, revoked or expired key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "The key lacks the scope", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": {
            description: "Over the key's rate limit; retry after the number of seconds in Retry-After",
            headers: { "Retry-After": { schema: { type: "integer" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Exceledge Accounting API",
      version: "1.0.0",
      description:
        "Read-only access to a company's books with an API key. Keys are issued on the Platform page; each has scopes and a per-minute rate limit. " +
        "Send the key as `X-API-Key: <key>` or `Authorization: ApiKey <key>`. Webhook deliveries are described under `webhooks`.",
    },
    servers: [{ url: serverUrl }],
    paths,
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((event) => [
        event,
        {
          post: {
            summary: event,
            description:
              "Signed with the endpoint secret: header `X-Exceledge-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of \"<t>.<raw body>\">`. " +
              "Answer 2xx within 10 seconds; other answers are retried with backoff up to 6 times.",
            requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookPayload" } } } },
            responses: { "200": { description: "Received" } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: {
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
        apiKeyAuthorization: { type: "apiKey", in: "header", name: "Authorization", description: "ApiKey <key>" },
      },
      schemas: {
        Success: { type: "object", required: ["success", "data"], properties: { success: { const: true }, data: {} } },
        Error: { type: "object", required: ["success", "error"], properties: { success: { const: false }, error: { type: "string" } } },
        WebhookPayload: {
          type: "object",
          required: ["id", "event", "occurredAt", "data"],
          properties: {
            id: { type: "string", description: "Delivery id; the same on retries" },
            event: { type: "string", enum: [...WEBHOOK_EVENTS, "ping"] },
            occurredAt: { type: "string", format: "date-time" },
            organizationId: { type: ["string", "null"], description: "ERP organization id" },
            data: { type: "object" },
          },
        },
      },
    },
  };
}
