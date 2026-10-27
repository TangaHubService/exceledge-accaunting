import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/services/email.service", () => ({
  emailService: {
    sendPasswordResetEmail: vi.fn(),
    sendPasswordResetConfirmation: vi.fn(),
  },
}));

import {
  requestPasswordReset,
  verifyPasswordResetCode,
} from "../src/controllers/verification.controller";
import { prisma } from "../src/lib/prisma";
import { emailService } from "../src/services/email.service";

function makeResponse() {
  const response: any = {};
  response.status = vi.fn().mockReturnValue(response);
  response.json = vi.fn().mockReturnValue(response);
  return response;
}

describe("password reset OTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores a hashed six-digit OTP and sends the plain code by email", async () => {
    const user = { id: 42, email: "user@example.com", name: "Test User" };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.user.update as any).mockResolvedValue(user);
    (emailService.sendPasswordResetEmail as any).mockResolvedValue(undefined);

    const request = { body: { email: user.email } } as any;
    const response = makeResponse();

    await requestPasswordReset(request, response);

    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledOnce();
    const sentCode = (emailService.sendPasswordResetEmail as any).mock.calls[0][2];
    expect(sentCode).toMatch(/^\d{6}$/);

    const expectedHash = crypto.createHash("sha256").update(sentCode).digest("hex");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        passwordResetToken: expectedHash,
        passwordResetExpiry: expect.any(Date),
      },
    });
    expect(response.json).toHaveBeenCalledWith({
      message: "Password reset email sent successfully",
    });
  });

  it("accepts a valid email-bound OTP", async () => {
    const email = "user@example.com";
    const code = "482913";
    (prisma.user.findFirst as any).mockResolvedValue({ id: 42 });
    const response = makeResponse();

    await verifyPasswordResetCode({ body: { email, code } } as any, response);

    const expectedHash = crypto.createHash("sha256").update(code).digest("hex");
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email,
        passwordResetToken: expectedHash,
        passwordResetExpiry: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ message: "Verification code is valid" });
  });

  it("rejects malformed and invalid or expired OTPs", async () => {
    const malformedResponse = makeResponse();
    await verifyPasswordResetCode(
      { body: { email: "user@example.com", code: "123" } } as any,
      malformedResponse,
    );
    expect(malformedResponse.status).toHaveBeenCalledWith(400);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();

    (prisma.user.findFirst as any).mockResolvedValue(null);
    const invalidResponse = makeResponse();
    await verifyPasswordResetCode(
      { body: { email: "user@example.com", code: "123456" } } as any,
      invalidResponse,
    );
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
    expect(invalidResponse.json).toHaveBeenCalledWith({
      error: "Invalid or expired verification code",
    });
  });
});
