import { describe, expect, it, vi, beforeEach } from "vitest";

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: "test-message-id" }),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

import { emailService } from "../src/services/email.service";

describe("Purchase Order emails set Reply-To to the PO creator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sendPurchaseOrderToSupplier sets replyTo to the creator's email when provided", async () => {
    await emailService.sendPurchaseOrderToSupplier(
      "supplier@acme.com",
      "Acme Supplies",
      "My Org",
      "PO-1",
      [],
      100,
      undefined,
      undefined,
      "creator@example.com",
    );

    const options = sendMailMock.mock.calls[0][0];
    expect(options.to).toBe("supplier@acme.com");
    expect(options.replyTo).toBe("creator@example.com");
  });

  it("sendPurchaseOrderToSupplier omits replyTo when no creator email is given", async () => {
    await emailService.sendPurchaseOrderToSupplier(
      "supplier@acme.com",
      "Acme Supplies",
      "My Org",
      "PO-1",
      [],
      100,
    );

    const options = sendMailMock.mock.calls[0][0];
    expect(options.replyTo).toBeUndefined();
  });

  it("sendPurchaseOrderCreatedNotification sets replyTo to the creator's email", async () => {
    await emailService.sendPurchaseOrderCreatedNotification(
      "org@example.com",
      "My Org",
      "PO-1",
      "Acme Supplies",
      100,
      "Jane Creator",
      new Date(),
      "creator@example.com",
    );

    const options = sendMailMock.mock.calls[0][0];
    expect(options.to).toBe("org@example.com");
    expect(options.replyTo).toBe("creator@example.com");
  });

  it("sendPurchaseOrderUpdatedNotification sets replyTo to the original PO creator's email, not the updater", async () => {
    await emailService.sendPurchaseOrderUpdatedNotification(
      "org@example.com",
      "My Org",
      "PO-1",
      "Acme Supplies",
      "Jane Updater",
      new Date(),
      "APPROVED",
      "Status changed from PENDING to APPROVED",
      "original-creator@example.com",
    );

    const options = sendMailMock.mock.calls[0][0];
    expect(options.to).toBe("org@example.com");
    expect(options.replyTo).toBe("original-creator@example.com");
    expect(options.html).toContain("Jane Updater");
  });
});
