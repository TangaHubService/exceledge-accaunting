import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import * as documents from "../src/modules/books/documents.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 95421;
const otherOrgId = 95422;
const books = "/api/v1/books";

let admin: Record<string, string>;
let other: Record<string, string>;
const manager = authHeaders(orgId, "BRANCH_MANAGER", 811);
const manager2 = authHeaders(orgId, "BRANCH_MANAGER", 812);
const accountant = authHeaders(orgId, "ACCOUNTANT", 813);
const seller = authHeaders(orgId, "SELLER", 814);
let companyId = "";
let storageDir = "";
const originalDir = env.documentStorageDir;
const ids: Record<string, string> = {};

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n", "latin1");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

function upload(headers: Record<string, string>, entityType: string, entityId: string, file: Buffer, filename: string, contentType?: string) {
  return request(app)
    .post(`${books}/documents/upload`)
    .set(headers)
    .field("entityType", entityType)
    .field("entityId", entityId)
    .attach("file", file, contentType ? { filename, contentType } : filename);
}

function download(id: string, headers: Record<string, string>) {
  return request(app)
    .get(`${books}/documents/${id}/download`)
    .set(headers)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
}

async function storedFiles() {
  if (!existsSync(storageDir)) return [];
  const out: string[] = [];
  for (const dir of await readdir(storageDir)) for (const f of await readdir(path.join(storageDir, dir))) out.push(`${dir}/${f}`);
  return out;
}

function journal(headers: Record<string, string>, amount = 100) {
  return request(app)
    .post("/api/v1/journals")
    .set(headers)
    .send({
      journalDate: "2026-01-12",
      lines: [
        { accountId: ids.cash, debit: amount, credit: 0 },
        { accountId: ids.sales, debit: 0, credit: amount },
      ],
    });
}

describe("Wave C document storage: upload, download, delete", () => {
  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "c9-docs-"));
    env.documentStorageDir = storageDir;
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    admin = await activateCompany(app, orgId, { name: "WaveC Files Co", tin: "954210001" });
    other = await activateCompany(app, otherOrgId, { name: "WaveC Files Other", tin: "954220002" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    ids.cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "1100" } })).id;
    ids.sales = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "4100" } })).id;

    const supplier = await request(app).post("/api/v1/ap/suppliers").set(admin).send({ name: "Paper Vendor" });
    const bill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: supplier.body.data.id, billDate: "2026-01-10", net: 1000 });
    expect(bill.status).toBe(201);
    ids.bill = bill.body.data.id;
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "File Buyer", customerType: "CREDIT", creditLimit: 1_000_000 });
    const invoice = await request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: customer.body.data.id, invoiceDate: "2026-01-11", net: 500 });
    expect(invoice.status).toBe(201);
    ids.invoice = invoice.body.data.id;
    const foreignSupplier = await request(app).post("/api/v1/ap/suppliers").set(other).send({ name: "Foreign Vendor" });
    const foreignBill = await request(app).post("/api/v1/ap/bills").set(other).send({ supplierId: foreignSupplier.body.data.id, billDate: "2026-01-10", net: 10 });
    ids.foreignBill = foreignBill.body.data.id;
  });

  afterAll(async () => {
    env.documentStorageDir = originalDir;
    await rm(storageDir, { recursive: true, force: true });
  });

  it("uploads a file to a bill and downloads the same bytes with safe headers", async () => {
    const res = await upload(admin, "ApBill", ids.bill, PDF, "Supplier invoice.pdf", "application/pdf");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      entityType: "ApBill",
      entityId: ids.bill,
      fileName: "Supplier invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF.length,
      sha256: createHash("sha256").update(PDF).digest("hex"),
      createdByErpUserId: 441,
    });
    ids.billDoc = res.body.data.id;
    expect(res.body.data.storageKey).toMatch(/^[a-z0-9]+\/[0-9a-f-]{36}$/);
    expect(existsSync(path.join(storageDir, res.body.data.storageKey))).toBe(true);
    expect(await prisma.auditEvent.count({ where: { companyId, action: "UPLOAD_DOCUMENT", entityType: "ApBill", entityId: ids.bill } })).toBe(1);

    const file = await download(ids.billDoc, admin);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(file.headers["content-disposition"]).toBe(`attachment; filename="Supplier invoice.pdf"; filename*=UTF-8''Supplier%20invoice.pdf`);
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect((file.body as Buffer).equals(PDF)).toBe(true);

    const listed = await request(app).get(`${books}/documents`).query({ entityType: "ApBill", entityId: ids.bill }).set(admin);
    expect(listed.body.data.map((d: { id: string }) => d.id)).toEqual([ids.billDoc]);

    const png = await upload(admin, "ArInvoice", ids.invoice, PNG, "photo.PNG", "application/octet-stream");
    expect(png.status).toBe(201);
    expect(png.body.data.mimeType).toBe("image/png");
  });

  it("rejects files over the size limit without storing anything", async () => {
    const before = (await storedFiles()).length;
    const count = await prisma.accountingDocument.count({ where: { companyId } });
    env.documentMaxBytes = 1024;
    try {
      const res = await upload(admin, "ApBill", ids.bill, Buffer.concat([PDF, Buffer.alloc(2048, 32)]), "big.pdf", "application/pdf");
      expect(res.status).toBe(413);
      expect(res.body.error).toMatch(/at most/);
    } finally {
      env.documentMaxBytes = 10 * 1024 * 1024;
    }
    expect((await storedFiles()).length).toBe(before);
    expect(await prisma.accountingDocument.count({ where: { companyId } })).toBe(count);
  });

  it("rejects disallowed extensions, mismatched types and fake content", async () => {
    const count = await prisma.accountingDocument.count({ where: { companyId } });
    const cases: Array<[Buffer, string, string | undefined, RegExp]> = [
      [Buffer.from("MZ\x90\x00"), "setup.exe", "application/octet-stream", /Only pdf, png/],
      [Buffer.from("<script>alert(1)</script>"), "page.html", "text/html", /Only pdf, png/],
      [Buffer.from("no extension"), "README", "text/plain", /Only pdf, png/],
      [PDF, "invoice.pdf", "text/html", /can't be sent as text\/html/],
      [Buffer.from("<html>not a pdf</html>"), "invoice.pdf", "application/pdf", /not a valid \.pdf/],
      [PDF, "image.png", "image/png", /not a valid \.png/],
    ];
    for (const [file, name, type, error] of cases) {
      const res = await upload(admin, "ApBill", ids.bill, file, name, type);
      expect(res.status, name).toBe(415);
      expect(res.body.error).toMatch(error);
    }
    const empty = await upload(admin, "ApBill", ids.bill, Buffer.alloc(0), "empty.txt", "text/plain");
    expect(empty.status).toBe(400);
    const unknownType = await upload(admin, "Budget", ids.bill, PDF, "x.pdf");
    expect(unknownType.status).toBe(400);
    expect(unknownType.body.error).toMatch(/can be attached to Journal, ApBill/);
    expect(await prisma.accountingDocument.count({ where: { companyId } })).toBe(count);
  });

  it("keeps companies apart: no download, delete or attach across companies", async () => {
    const download404 = await download(ids.billDoc, other);
    expect(download404.status).toBe(404);
    expect((await request(app).delete(`${books}/documents/${ids.billDoc}`).set(other)).status).toBe(404);
    const foreign = await upload(admin, "ApBill", ids.foreignBill, PDF, "x.pdf");
    expect(foreign.status).toBe(404);
    const intoMine = await upload(other, "ApBill", ids.bill, PDF, "x.pdf");
    expect(intoMine.status).toBe(404);
    expect(await prisma.accountingDocument.count({ where: { entityId: ids.foreignBill } })).toBe(0);
    const listed = await request(app).get(`${books}/documents`).query({ entityType: "ApBill", entityId: ids.bill }).set(other);
    expect(listed.body.data).toEqual([]);
  });

  it("checks the module capability of the attached record", async () => {
    expect((await upload(seller, "ApBill", ids.bill, PDF, "x.pdf")).status).toBe(403);
    expect((await download(ids.billDoc, seller)).status).toBe(403);
    expect((await request(app).get(`${books}/documents`).query({ entityType: "ApBill", entityId: ids.bill }).set(seller)).status).toBe(403);
    const noManage = await upload(manager, "ApBill", ids.bill, PDF, "x.pdf");
    expect(noManage.status).toBe(403);
    expect(noManage.body.error).toMatch(/ap:manage/);
    expect((await download(ids.billDoc, manager)).status).toBe(200);
    expect((await request(app).delete(`${books}/documents/${ids.billDoc}`).set(manager)).status).toBe(403);
    expect((await request(app).post(`${books}/documents/upload`).set(admin).send({ entityType: "ApBill", entityId: ids.bill })).status).toBe(400);
    expect((await request(app).get(`${books}/documents/${ids.billDoc}/download`)).status).toBe(401);
  });

  it("ignores path segments in uploaded filenames", async () => {
    for (const name of ["../../../../etc/passwd.txt", "..\\..\\windows\\win.ini.txt", 'quo"te<>.txt']) {
      const res = await upload(admin, "ArInvoice", ids.invoice, Buffer.from("plain text"), name, "text/plain");
      expect(res.status, name).toBe(201);
      expect(res.body.data.fileName).not.toMatch(/[\\/"<>]|\.\./);
      const full = path.resolve(storageDir, res.body.data.storageKey);
      expect(full.startsWith(storageDir + path.sep)).toBe(true);
      expect(existsSync(full)).toBe(true);
      const file = await download(res.body.data.id, admin);
      expect(file.status).toBe(200);
      expect(file.headers["content-disposition"]).toMatch(/^attachment; filename="[^"\\/]+"; filename\*=UTF-8''[^"\s]+$/);
    }
    const names = (await prisma.accountingDocument.findMany({ where: { companyId, entityId: ids.invoice, mimeType: "text/plain" }, orderBy: { createdAt: "asc" } })).map((d) => d.fileName);
    expect(names).toEqual(["passwd.txt", "win.ini.txt", "quote.txt"]);
    expect(existsSync(path.resolve(storageDir, "../etc"))).toBe(false);
  });

  it("lets the uploader or a manager delete, but not once the record is past draft or in a locked period", async () => {
    const draft = await journal(manager);
    expect(draft.status).toBe(201);
    const journalId = draft.body.data.id;
    const mine = await upload(manager, "Journal", journalId, PDF, "receipt.pdf");
    expect(mine.status).toBe(201);
    expect((await request(app).delete(`${books}/documents/${mine.body.data.id}`).set(manager2)).status).toBe(403);
    const removed = await request(app).delete(`${books}/documents/${mine.body.data.id}`).set(manager);
    expect(removed.status).toBe(200);
    expect(existsSync(path.join(storageDir, mine.body.data.storageKey))).toBe(false);
    expect(await prisma.auditEvent.count({ where: { companyId, action: "DELETE_DOCUMENT", entityId: journalId } })).toBe(1);
    expect((await request(app).delete(`${books}/documents/${mine.body.data.id}`).set(manager)).status).toBe(404);

    const byOther = await upload(manager2, "Journal", journalId, PDF, "receipt2.pdf");
    expect((await request(app).delete(`${books}/documents/${byOther.body.data.id}`).set(accountant)).status).toBe(200);

    const kept = await upload(manager, "Journal", journalId, PDF, "receipt3.pdf");
    expect((await request(app).post(`/api/v1/journals/${journalId}/submit`).set(manager)).status).toBe(200);
    const afterSubmit = await request(app).delete(`${books}/documents/${kept.body.data.id}`).set(admin);
    expect(afterSubmit.status).toBe(409);
    expect(afterSubmit.body.error).toMatch(/the journal is approved/);
    expect(existsSync(path.join(storageDir, kept.body.data.storageKey))).toBe(true);
    expect((await upload(manager, "Journal", journalId, PNG, "later.png")).status).toBe(201);

    const billDoc = await upload(admin, "ApBill", ids.bill, PDF, "bill-copy.pdf");
    await prisma.financialYear.updateMany({ where: { companyId }, data: { transactionLockDate: new Date("2026-01-31T00:00:00Z") } });
    try {
      const locked = await request(app).delete(`${books}/documents/${billDoc.body.data.id}`).set(admin);
      expect(locked.status).toBe(409);
      expect(locked.body.error).toMatch(/on or before 2026-01-31 are locked/);
    } finally {
      await prisma.financialYear.updateMany({ where: { companyId }, data: { transactionLockDate: null } });
    }
    expect((await request(app).delete(`${books}/documents/${billDoc.body.data.id}`).set(admin)).status).toBe(200);
  });

  it("satisfies the supporting-document rule with an uploaded file", async () => {
    await request(app).put("/api/v1/setup/approvals").set(admin).send({ supportingDocumentRequired: true });
    try {
      const draft = await journal(admin, 250);
      const bare = await request(app).post(`/api/v1/journals/${draft.body.data.id}/submit`).set(admin);
      expect(bare.status).toBe(400);
      expect(bare.body.error).toMatch(/Attach a supporting document/);
      expect((await upload(admin, "Journal", draft.body.data.id, PDF, "evidence.pdf")).status).toBe(201);
      const submitted = await request(app).post(`/api/v1/journals/${draft.body.data.id}/submit`).set(admin);
      expect(submitted.status).toBe(200);
      expect((await prisma.journal.findUniqueOrThrow({ where: { id: draft.body.data.id } })).status).toBe("APPROVED");
    } finally {
      await request(app).put("/api/v1/setup/approvals").set(admin).send({ supportingDocumentRequired: false });
    }
  });

  it("hides documents of unviewable records from the unfiltered list", async () => {
    const all = await request(app).get(`${books}/documents`).set(admin);
    expect(all.body.data.some((d: { entityType: string }) => d.entityType === "ApBill")).toBe(true);
    await prisma.accountingDocument.create({ data: { companyId, entityType: "Budget", entityId: "b1", fileName: "budget-notes.txt" } });
    const noModules = { erpUserId: 999, erpRole: "SELLER" };
    for (const [entityType, entityId] of [[undefined, undefined], ["ApBill", undefined], [undefined, ids.bill], ["Budget", undefined]]) {
      const rows = await documents.listDocuments(companyId, entityType, entityId, noModules);
      expect(rows.map((d) => d.entityType).filter((t) => t !== "Budget")).toEqual([]);
    }
    expect((await documents.listDocuments(companyId, "Budget", undefined, noModules)).map((d) => d.fileName)).toEqual(["budget-notes.txt"]);
  });

  it("checks reference-only documents like uploads and stores legacy Invoice as ArInvoice", async () => {
    const ref = await request(app).post(`${books}/documents`).set(admin).send({ entityType: "Invoice", entityId: ids.invoice, fileName: "INV-1 original.pdf", note: "Filed in cabinet B" });
    expect(ref.status).toBe(201);
    expect(ref.body.data.entityType).toBe("ArInvoice");
    expect((await request(app).post(`${books}/documents`).set(admin).send({ entityType: "ApBill", entityId: ids.foreignBill, fileName: "x" })).status).toBe(404);
    expect((await request(app).post(`${books}/documents`).set(admin).send({ entityType: "Journal", entityId: "missing", fileName: "x" })).status).toBe(404);
    expect(await prisma.accountingDocument.count({ where: { entityId: { in: [ids.foreignBill, "missing"] } } })).toBe(0);

    const legacy = await prisma.accountingDocument.create({ data: { companyId, entityType: "Invoice", entityId: ids.invoice, fileName: "old-ref.pdf" } });
    for (const entityType of ["ArInvoice", "Invoice"]) {
      const listed = await request(app).get(`${books}/documents`).query({ entityType, entityId: ids.invoice }).set(admin);
      expect(listed.body.data.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining([legacy.id, ref.body.data.id]));
    }
    await expect(documents.listDocuments(companyId, "Invoice", ids.invoice, { erpUserId: 999, erpRole: "SELLER" })).rejects.toMatchObject({ status: 403 });
    await expect(documents.deleteDocument(companyId, legacy.id, { erpUserId: 999, erpRole: "SELLER" })).rejects.toMatchObject({ status: 403 });
    expect((await request(app).delete(`${books}/documents/${legacy.id}`).set(manager)).status).toBe(403);
    expect((await request(app).delete(`${books}/documents/${legacy.id}`).set(admin)).status).toBe(200);
  });

  it("refuses the file before buffering it when the fields are missing or the caller may not attach", async () => {
    const before = (await storedFiles()).length;
    const fileFirst = await request(app).post(`${books}/documents/upload`).set(admin).attach("file", PDF, "x.pdf").field("entityType", "ApBill").field("entityId", ids.bill);
    expect(fileFirst.status).toBe(400);
    const tooManyFields = request(app).post(`${books}/documents/upload`).set(admin);
    for (let i = 0; i < 12; i++) tooManyFields.field(`f${i}`, "x");
    expect((await tooManyFields).status).toBe(400);
    const bigField = await request(app).post(`${books}/documents/upload`).set(admin).field("entityType", "ApBill").field("entityId", ids.bill).field("note", "x".repeat(5000));
    expect(bigField.status).toBe(400);
    expect((await storedFiles()).length).toBe(before);
  });

  it("serves files whose long Unicode names were cut mid-character", async () => {
    const res = await upload(admin, "ArInvoice", ids.invoice, Buffer.from("text"), `${"😀".repeat(100)}b.txt`, "text/plain");
    expect(res.status).toBe(201);
    expect(res.body.data.fileName).toBe(`${"😀".repeat(87)}b.txt`);
    const file = await download(res.body.data.id, admin);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toMatch(/^attachment; filename="_+b\.txt"; filename\*=UTF-8''(%F0%9F%98%80){87}b\.txt$/);
  });
});
