import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { emailService } from "../services/email.service";

export const productExpiryAlertJob = cron.schedule("0 8 * * *", async () => {
  console.log("Running product expiry alert job...");

  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const organizations = await prisma.organization.findMany({
    where: { isActive: true },
    include: {
      branches: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
      },
      userOrganizations: {
        where: {
          OR: [{ role: "ADMIN" }, { role: "ACCOUNTANT" }, { role: "SELLER" }],
        },
        include: { user: true },
      },
    },
  });

  let totalAlertsSent = 0;

  for (const organization of organizations) {
    // ── Per-branch expiry products ──────────────────────────────────
    const branchExpiryMap: Record<number, { branchName: string; products: any[] }> = {};

    for (const branch of organization.branches) {
      const expiringBatches = await prisma.batch.findMany({
        where: {
          organizationId: organization.id,
          branchId: branch.id,
          isActive: true,
          expiryDate: {
            not: null,
            lte: thirtyDaysFromNow,
          },
        },
        include: {
          product: { select: { name: true, sku: true } },
        },
        orderBy: { expiryDate: "asc" },
      });

      if (expiringBatches.length > 0) {
        branchExpiryMap[branch.id] = {
          branchName: branch.name,
          products: expiringBatches.map((b) => ({
            productName: b.product.name,
            sku: b.product.sku,
            batchNumber: b.batchNumber,
            quantity: b.quantity,
            expiryDate: b.expiryDate,
            daysRemaining: Math.ceil(
              (b.expiryDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            ),
          })),
        };
      }
    }

    if (Object.keys(branchExpiryMap).length > 0) {
      const allExpiringProducts = Object.values(branchExpiryMap).flatMap(b => b.products);
      for (const userOrg of organization.userOrganizations) {
        try {
          await emailService.sendExpiryAlert(
            userOrg.user.email,
            organization.name,
            allExpiringProducts
          );
          totalAlertsSent++;
        } catch (error) {
          console.error(
            `Failed to send expiry alert to ${userOrg.user.email}:`,
            error
          );
        }
      }
    }
  }

  console.log(`Sent ${totalAlertsSent} product expiry alerts`);
});

export const dailyReportJob = cron.schedule("0 22 * * *", async () => {
  console.log("Running daily report job...");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const organizations = await prisma.organization.findMany({
    where: {
      isActive: true,
      subscriptions: {
        some: {
          status: { in: ['ACTIVE', 'TRIALING'] },
          endDate: { gte: new Date() }
        }
      }
    },
    include: {
      branches: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, code: true },
      },
      userOrganizations: {
        where: {
          role: "ADMIN",
        },
        include: { user: true },
      },
    },
  });

  let totalReportsSent = 0;

  for (const organization of organizations) {
    const owner = organization.userOrganizations[0]?.user;
    if (!owner) continue;

    // ── Per-branch aggregation ──────────────────────────────────────
    const branchReports: Array<{ name: string; code: string; data: any }> = [];

    for (const branch of organization.branches) {
      const branchSales = await prisma.sale.findMany({
        where: {
          organizationId: organization.id,
          branchId: branch.id,
          createdAt: { gte: today, lt: tomorrow },
        },
      });

      branchReports.push({
        name: branch.name,
        code: branch.code,
        data: {
          totalSales: branchSales.reduce((s, r) => s + Number(r.totalAmount), 0),
          transactionCount: branchSales.length,
          cashSales: branchSales.reduce((s, r) => s + Number(r.cashAmount), 0),
          insuranceSales: branchSales.reduce((s, r) => s + Number(r.insuranceAmount), 0),
        },
      });
    }

    // ── Organization totals (derived from branch data — no second DB call) ──
    const totalSales = branchReports.reduce((s, b) => s + b.data.totalSales, 0);
    const cashSales = branchReports.reduce((s, b) => s + b.data.cashSales, 0);
    const insuranceSales = branchReports.reduce((s, b) => s + b.data.insuranceSales, 0);
    const orgTransactionCount = branchReports.reduce((s, b) => s + b.data.transactionCount, 0);

    const lowStockProducts = await prisma.product.count({
      where: {
        organizationId: organization.id,
        quantity: { lte: 10 },
      },
    });

    const expiringSoonProducts = await prisma.product.count({
      where: {
        organizationId: organization.id,
        expiryDate: { not: null, gte: new Date(), lte: thirtyDaysFromNow },
      },
    });

    const expiredProducts = await prisma.product.count({
      where: {
        organizationId: organization.id,
        expiryDate: { not: null, lt: new Date() },
      },
    });

    const customers = await prisma.customer.findMany({
      where: {
        organizationId: organization.id,
        balance: { gt: 0 },
      },
    });

    const totalDebt = customers.reduce((sum, c) => sum + Number(c.balance), 0);

    const reportData = {
      totalSales,
      transactionCount: orgTransactionCount,
      cashSales,
      insuranceSales,
      lowStockCount: lowStockProducts,
      expiringSoonCount: expiringSoonProducts,
      expiredCount: expiredProducts,
      totalDebt,
      debtorCount: customers.length,
      branches: branchReports,
    };

    try {
      await emailService.sendDailyReport(owner.email, organization.name, reportData);
      totalReportsSent++;
    } catch (error) {
      console.error(`Failed to send daily report to ${owner.email}:`, error);
    }
  }

  console.log(`Sent ${totalReportsSent} daily reports`);
});
