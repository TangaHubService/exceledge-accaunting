import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = { erpUserId?: number; erpRole?: string };

export const WEBHOOK_EVENTS = ["posting.failed", "period.closed", "period.reopened"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const MAX_DELIVERY_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;

async function audit(companyId: string, actor: Actor, action: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType: "WebhookEndpoint", entityId, afterJson, beforeJson: beforeJson ?? undefined });
}

function privateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(h) === 6) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

/** In production a webhook must use https and a public host name or address. */
export function checkWebhookUrl(raw: string, production = env.nodeEnv === "production") {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The webhook URL is not valid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The webhook URL must use https");
  if (url.username || url.password) throw new Error("The webhook URL must not contain credentials");
  if (production && url.protocol !== "https:") throw new Error("The webhook URL must use https");
  if (production && privateHost(url.hostname)) throw new Error("The webhook URL must point to a public host");
  return url.toString();
}

function checkEvents(events: string[]) {
  const unique = [...new Set(events)];
  if (!unique.length) throw new Error("Choose at least one event");
  const unknown = unique.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (unknown.length) throw new Error(`Unknown event ${unknown.join(", ")}; events are ${WEBHOOK_EVENTS.join(", ")}`);
  return unique;
}

const publicFields = { id: true, url: true, events: true, isActive: true, description: true, createdAt: true, updatedAt: true } as const;

export async function listWebhooks(companyId: string) {
  return prisma.webhookEndpoint.findMany({ where: { companyId }, select: publicFields, orderBy: { createdAt: "desc" } });
}

/** Creates an endpoint; the signing secret is returned only here. */
export async function createWebhook(companyId: string, input: { url: string; events: string[]; description?: string | null }, actor: Actor) {
  const url = checkWebhookUrl(input.url);
  const events = checkEvents(input.events);
  if ((await prisma.webhookEndpoint.count({ where: { companyId } })) >= 20) throw new Error("A company can have at most 20 webhooks");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const row = await prisma.webhookEndpoint.create({ data: { companyId, url, events, secret, description: input.description, createdByErpUserId: actor.erpUserId } });
  await audit(companyId, actor, "CREATE", row.id, { url, events });
  return { id: row.id, url, events, isActive: row.isActive, description: row.description, createdAt: row.createdAt, secret };
}

export async function updateWebhook(companyId: string, id: string, input: { url?: string; events?: string[]; isActive?: boolean; description?: string | null }, actor: Actor) {
  const before = await prisma.webhookEndpoint.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Webhook not found");
  const data: Prisma.WebhookEndpointUpdateInput = {};
  if (input.url !== undefined) data.url = checkWebhookUrl(input.url);
  if (input.events !== undefined) data.events = checkEvents(input.events);
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.description !== undefined) data.description = input.description;
  const row = await prisma.webhookEndpoint.update({ where: { id }, data, select: publicFields });
  await audit(companyId, actor, "UPDATE", id, input, { url: before.url, events: before.events, isActive: before.isActive });
  return row;
}

export async function deleteWebhook(companyId: string, id: string, actor: Actor) {
  const before = await prisma.webhookEndpoint.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Webhook not found");
  await prisma.webhookEndpoint.delete({ where: { id } });
  await audit(companyId, actor, "DELETE", id, null, { url: before.url, events: before.events });
  return { id };
}

export async function listDeliveries(companyId: string, endpointId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, companyId } });
  if (!endpoint) throw new Error("Webhook not found");
  return prisma.webhookDelivery.findMany({ where: { endpointId }, orderBy: { createdAt: "desc" }, take: 100 });
}

/** Queues `event` for every active endpoint of the company that subscribes to it. Never throws. */
export async function emitWebhook(companyId: string, event: WebhookEvent, data: Record<string, unknown>, now = new Date()) {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { companyId, isActive: true, events: { has: event } }, select: { id: true } });
    if (!endpoints.length) return 0;
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { externalErpOrganizationId: true } });
    const payload = { event, occurredAt: now.toISOString(), organizationId: company?.externalErpOrganizationId ?? null, data };
    await prisma.webhookDelivery.createMany({
      data: endpoints.map((e) => ({ companyId, endpointId: e.id, event, payload: payload as Prisma.InputJsonValue })),
    });
    return endpoints.length;
  } catch (e) {
    console.error(`[webhooks] could not queue ${event} for ${companyId}`, e);
    return 0;
  }
}

/** Queues a test delivery to one endpoint, whatever events it subscribes to. */
export async function pingWebhook(companyId: string, id: string, now = new Date()) {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, companyId } });
  if (!endpoint) throw new Error("Webhook not found");
  const payload = { event: "ping", occurredAt: now.toISOString(), data: { message: "Test delivery from Exceledge Accounting" } };
  const row = await prisma.webhookDelivery.create({ data: { companyId, endpointId: id, event: "ping", payload } });
  return deliver(row.id, now);
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export function signPayload(secret: string, body: string, at: Date) {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Minutes to wait before the next attempt after `attempts` failures. */
export const retryDelayMinutes = (attempts: number) => Math.min(2 ** attempts, 360);

async function deliver(deliveryId: string, now: Date) {
  const row = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!row) return null;
  const body = JSON.stringify({ id: row.id, ...(row.payload as object) });
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    checkWebhookUrl(row.endpoint.url);
    const response = await fetch(row.endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Exceledge-Webhooks/1",
        "X-Exceledge-Event": row.event,
        "X-Exceledge-Delivery": row.id,
        "X-Exceledge-Signature": signPayload(row.endpoint.secret, body, now),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    responseStatus = response.status;
    if (response.status < 200 || response.status >= 300) error = `The endpoint answered ${response.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 500);
  }
  const attempts = row.attempts + 1;
  return prisma.webhookDelivery.update({
    where: { id: row.id },
    data: error
      ? {
          attempts,
          responseStatus,
          lastError: error,
          status: attempts >= MAX_DELIVERY_ATTEMPTS ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(attempts) * 60_000),
        }
      : { attempts, responseStatus, lastError: null, status: "DELIVERED", deliveredAt: now },
  });
}

/** Sends due deliveries; each is claimed by pushing its next attempt out so a slow send is not repeated. */
export async function deliverDueWebhooks(now = new Date(), limit = 50) {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now }, endpoint: { isActive: true } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true, nextAttemptAt: true },
  });
  let delivered = 0;
  for (const d of due) {
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: "PENDING", nextAttemptAt: d.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
    });
    if (!claimed.count) continue;
    const result = await deliver(d.id, now);
    if (result?.status === "DELIVERED") delivered += 1;
  }
  return { attempted: due.length, delivered };
}
