import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  // GRACE_PERIOD -> EXPIRED (including subscriptions where gracePeriodEndsAt is null or in the past)
  const expired = await prisma.subscription.updateMany({
    where: {
      status: "GRACE_PERIOD",
      OR: [
        { gracePeriodEndsAt: { lte: now } },
        { gracePeriodEndsAt: null },
      ],
    },
    data: { status: "EXPIRED" },
  });
  console.log(`Expired ${expired.count} subscription(s) from GRACE_PERIOD`);

  // Also handle ACTIVE / TRIALING subscriptions where endDate has passed but status didn't transition
  const toGrace = await prisma.subscription.updateMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      endDate: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
  console.log(`Expired ${toGrace.count} overdue ACTIVE/TRIALING subscription(s) directly`);

  // Deactivate organisations that now have no valid subscription
  const orgsWithActiveSub = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIALING", "GRACE_PERIOD"] } },
    select: { organizationId: true },
  });
  const activeOrgIds = new Set(orgsWithActiveSub.map(s => s.organizationId));

  const deactivated = await prisma.organization.updateMany({
    where: {
      isActive: true,
      id: { notIn: [...activeOrgIds] },
    },
    data: { isActive: false },
  });
  console.log(`Deactivated ${deactivated.count} organisation(s) with no valid subscription`);

  console.log("✅ Overdue subscriptions have been force-expired.");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
