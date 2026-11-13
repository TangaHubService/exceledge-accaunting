import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

export class MailNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super("Email isn't set up on the server yet. Add EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD and EMAIL_FROM to the API environment.");
  }
}

let transporter: Transporter | null = null;
/** Messages handed to the JSON transport (tests and local dev without SMTP), newest last. */
export const sentMail: Array<{ to: string; cc?: string; subject: string; text: string; attachments: string[] }> = [];

function transport() {
  if (transporter) return transporter;
  if (env.mailTransport === "json") {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  } else {
    if (!env.smtpHost || !env.mailFrom) throw new MailNotConfiguredError();
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transporter;
}

export function mailConfigured() {
  return env.mailTransport === "json" || Boolean(env.smtpHost && env.mailFrom);
}

/** Sends one message. `fromName` puts the company's name on the configured sender address. */
export async function sendMail(input: {
  to: string;
  cc?: string;
  replyTo?: string;
  fromName?: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}) {
  const t = transport();
  const address = env.mailFrom || "no-reply@localhost";
  const bare = address.match(/<([^>]+)>/)?.[1] ?? address;
  const from = input.fromName ? { name: input.fromName.replace(/["<>]/g, ""), address: bare } : address;
  const info = await t.sendMail({
    from,
    to: input.to,
    cc: input.cc || undefined,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text,
    attachments: input.attachments,
  });
  if (env.mailTransport === "json") {
    sentMail.push({ to: input.to, cc: input.cc, subject: input.subject, text: input.text, attachments: (input.attachments ?? []).map((a) => a.filename) });
  }
  return { messageId: info.messageId as string };
}
