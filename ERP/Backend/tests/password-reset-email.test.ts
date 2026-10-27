import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: "reset-test-message-id" }),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

import { emailService } from "../src/services/email.service";

describe("password reset email", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes the six-digit OTP in both HTML and plain text", async () => {
    const code = "482913";

    await emailService.sendPasswordResetEmail(
      "user@example.com",
      "Test User",
      code,
    );

    const options = sendMailMock.mock.calls[0][0];
    expect(options.to).toBe("user@example.com");
    expect(options.html).toContain(code);
    expect(options.text).toContain(`password reset code is: ${code}`);
    expect(options.html).toContain("token=482913");
  });
});
