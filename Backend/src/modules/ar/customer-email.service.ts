/**
 * Emails customers their invoices, statements and payment reminders through the configured SMTP server
 * (nodemailer), with the document attached as a PDF. Every send is recorded on the customer's activity.
 */
import { prisma } from "../../lib/prisma";
import { mailConfigured, sendMail } from "../../lib/mailer";
import { money } from "../../lib/documents";
import { writeAudit } from "../audit/audit.service";
import * as print from "../print/print.service";
import { getInvoice } from "./ar.service";

type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

const fmt = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** Splits "a@x.rw, b@y.rw" and checks each address. */
export function parseRecipients(value: string | undefined | null, label = "recipient") {
  const list = (value ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a)) throw new Error(`${a} isn't a valid ${label} email address`);
  if (list.length > 10) throw new Error("Send to at most 10 addresses at a time");
  return list.join(", ");
}

async function senderFor(companyId: string) {
  const header = await print.companyHeader(companyId);
  const profile = await prisma.companyProfile.findFirst({ where: { companyId }, select: { businessEmail: true } });
  return { name: header.name, replyTo: profile?.businessEmail ?? undefined };
}

async function record(companyId: string, customerId: string, actor: Actor, what: { kind: string; documentNumber?: string; to: string; subject: string }) {
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "EMAIL",
    entityType: "Customer",
    entityId: customerId,
    afterJson: what,
    ...actor.meta,
  });
}

export function emailStatus() {
  return { configured: mailConfigured() };
}

export async function emailInvoice(
  companyId: string,
  invoiceId: string,
  input: { to?: string; cc?: string; subject?: string; message?: string; reminder?: boolean },
  actor: Actor,
) {
  const invoice = await getInvoice(companyId, invoiceId);
  if (invoice.status !== "POSTED") throw new Error(`Invoice ${invoice.invoiceNumber} is void and can't be sent`);
  const to = parseRecipients(input.to || invoice.customer.email);
  if (!to) throw new Error(`${invoice.customer.name} has no email address; enter one to send to`);
  const cc = parseRecipients(input.cc, "cc");
  const sender = await senderFor(companyId);
  const outstanding = invoice.outstanding;
  const currency = invoice.currency;
  const overdueDays = Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000);
  const reminder = Boolean(input.reminder);
  if (reminder && outstanding <= 0.005) throw new Error(`Invoice ${invoice.invoiceNumber} is paid; there's nothing to remind about`);
  const subject =
    input.subject?.trim() ||
    (reminder ? `Payment reminder: invoice ${invoice.invoiceNumber} from ${sender.name}` : `Invoice ${invoice.invoiceNumber} from ${sender.name}`);
  const intro = reminder
    ? `This is a friendly reminder that invoice ${invoice.invoiceNumber} dated ${day(invoice.invoiceDate)} was due on ${day(invoice.dueDate)}${overdueDays > 0 ? ` and is now ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue` : ""}.`
    : `Please find attached invoice ${invoice.invoiceNumber} dated ${day(invoice.invoiceDate)}.`;
  const text = [
    `Dear ${invoice.customer.contactPerson || invoice.customer.name},`,
    "",
    input.message?.trim() || intro,
    "",
    `Invoice total: ${fmt(money(invoice.gross), currency)}`,
    `Balance due: ${fmt(outstanding, currency)}`,
    `Due date: ${day(invoice.dueDate)}`,
    "",
    reminder ? "If you have already paid, please ignore this message and accept our thanks." : "Thank you for your business.",
    "",
    sender.name,
  ].join("\n");
  const pdf = await print.invoicePdf(companyId, invoiceId);
  const sent = await sendMail({ to, cc, replyTo: sender.replyTo, fromName: sender.name, subject, text, attachments: [{ filename: pdf.filename, content: pdf.pdf, contentType: "application/pdf" }] });
  await record(companyId, invoice.customerId, actor, { kind: reminder ? "REMINDER" : "INVOICE", documentNumber: invoice.invoiceNumber, to, subject });
  return { ...sent, to, subject };
}

export async function emailStatement(companyId: string, customerId: string, input: { to?: string; cc?: string; from?: string; toDate?: string; message?: string }, actor: Actor) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!customer) throw new Error("Customer does not exist");
  const to = parseRecipients(input.to || customer.email);
  if (!to) throw new Error(`${customer.name} has no email address; enter one to send to`);
  const cc = parseRecipients(input.cc, "cc");
  const sender = await senderFor(companyId);
  const pdf = await print.customerStatementPdf(companyId, customerId, input.from, input.toDate);
  const balance = money(customer.balance);
  const subject = `Statement of account from ${sender.name}`;
  const text = [
    `Dear ${customer.contactPerson || customer.name},`,
    "",
    input.message?.trim() || "Please find attached your statement of account.",
    "",
    `Balance ${balance < 0 ? "in your favour" : "due"}: ${fmt(Math.abs(balance), customer.currency)}`,
    "",
    "Please contact us if anything on the statement doesn't match your records.",
    "",
    sender.name,
  ].join("\n");
  const sent = await sendMail({ to, cc, replyTo: sender.replyTo, fromName: sender.name, subject, text, attachments: [{ filename: pdf.filename, content: pdf.pdf, contentType: "application/pdf" }] });
  await record(companyId, customer.id, actor, { kind: "STATEMENT", to, subject });
  return { ...sent, to, subject };
}

/** A plain test message, to check the SMTP settings. */
export async function sendTestEmail(companyId: string, to: string, actor: Actor) {
  const address = parseRecipients(to);
  if (!address) throw new Error("Enter an email address");
  const sender = await senderFor(companyId);
  const sent = await sendMail({
    to: address,
    fromName: sender.name,
    replyTo: sender.replyTo,
    subject: `Test email from ${sender.name}`,
    text: `This is a test email from Excel Edge Accounting.\n\nIf you can read this, invoices, statements and payment reminders can be emailed to customers.\n\n${sender.name}`,
  });
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "EMAIL_TEST", entityType: "Company", entityId: companyId, afterJson: { to: address }, ...actor.meta });
  return { ...sent, to: address };
}
