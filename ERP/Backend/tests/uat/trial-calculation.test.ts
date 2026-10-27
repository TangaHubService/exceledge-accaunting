import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  subscription: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  subscriptionPlan: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("../../src/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("../../src/services/email.service", () => ({
  emailService: { sendSubscriptionEmail: vi.fn().mockResolvedValue(undefined) },
}));

import { SubscriptionService } from "../../src/services/subscription.service";

describe("Trial Period Calculation (#5)", () => {
  let service: SubscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionService(mockPrisma as any);
  });

  it("creates trial with exactly 7 days (UTC-based)", async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 1, name: "Test Org", userOrganizations: [] });
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 1, name: "Trial Plan", price: 0, durationDays: 7,
      features: [],
    });
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    mockPrisma.$transaction.mockImplementation(async (promises: any) => {
      return Promise.all(promises);
    });
    mockPrisma.subscription.create.mockResolvedValue({
      id: 1, organizationId: 1, planId: 1, status: "ACTIVE",
      startDate: now, endDate: sevenDaysLater,
      trialEndsAt: sevenDaysLater,
    });
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 1, organizationId: 1, planId: 1,
      status: "ACTIVE",
      startDate: now,
      endDate: sevenDaysLater,
      trialEndsAt: sevenDaysLater,
      plan: { name: "TRIAL", price: 0 },
    });

    const result = await service.createTrial(1, 1);
    expect(result.plan).toBeDefined();
    expect(result.status).toBe("ACTIVE");

    const periodMs = result.endDate.getTime() - result.startDate.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(periodMs).toBe(sevenDaysMs);
  });

  it("computeSubscriptionSummary returns hoursUntilExpiry", () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const result = (service as any).computeSubscriptionSummary({
      status: "ACTIVE",
      endDate: future,
      gracePeriodEndsAt: null,
      gracePeriodDays: null,
    });

    expect(result.hoursUntilExpiry).toBeDefined();
    expect(typeof result.hoursUntilExpiry).toBe("number");
    expect(result.hoursUntilExpiry).toBeGreaterThan(0);
    expect(result.hoursUntilExpiry).toBeLessThanOrEqual(3);
  });

  it("computeSubscriptionSummary shows expired when endDate passed", () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const result = (service as any).computeSubscriptionSummary({
      status: "ACTIVE",
      endDate: past,
      gracePeriodEndsAt: null,
      gracePeriodDays: null,
    });

    expect(result.hoursUntilExpiry).toBe(0);
  });

  it("computeSubscriptionSummary returns null for null subscription", () => {
    const result = (service as any).computeSubscriptionSummary(null);
    expect(result.hasActiveSubscription).toBe(false);
    expect(result.hoursUntilExpiry).toBeNull();
  });
});
