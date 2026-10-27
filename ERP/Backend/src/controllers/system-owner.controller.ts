import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { emailService } from "../services/email.service";

export const systemOwnerController = {
  async getDashboardStats(req: Request, res: Response) {
    try {
      const [
        totalOrganizations,
        activeOrganizations,
        totalUsers,
        activeSubscriptions,
        totalRevenue,
        pendingPayments,
      ] = await Promise.all([
        prisma.organization.count(),
        prisma.organization.count({ where: { isActive: true } }),
        prisma.user.count(),
        prisma.subscription.count({ where: { status: "ACTIVE" } }),
        prisma.payment.aggregate({
          where: { status: "COMPLETED" },
          _sum: { amount: true },
        }),
        prisma.payment.count({ where: { status: "PENDING" } }),
      ]);

      const recentOrganizations = await prisma.organization.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          userOrganizations: {
            where: { isOwner: true },
            include: { user: true },
          },
          subscriptions: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      const expiringSubscriptions = await prisma.subscription.count({
        where: {
          status: "ACTIVE",
          endDate: {
            lte: sevenDaysFromNow,
            gte: new Date(),
          },
        },
      });

      res.json({
        stats: {
          totalOrganizations,
          activeOrganizations,
          inactiveOrganizations: totalOrganizations - activeOrganizations,
          totalUsers,
          activeSubscriptions,
          expiringSubscriptions,
          totalRevenue: totalRevenue._sum.amount || 0,
          pendingPayments,
        },
        recentOrganizations: recentOrganizations.map((o) => ({
          id: o.id,
          name: o.name,
          businessType: o.businessType,
          owner: o.userOrganizations[0]?.user.name || "N/A",
          ownerEmail: o.userOrganizations[0]?.user.email || "N/A",
          isActive: o.isActive,
          createdAt: o.createdAt,
          subscription: o.subscriptions[0] || null,
        })),
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  },

  async getAllOrganizations(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10, search, status, businessType } = req.query;

      const where: any = {};

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { email: { contains: search as string, mode: "insensitive" } },
        ];
      }

      if (status === "active" || status === "inactive") {
        where.isActive = status === "active";
      }

      if (businessType) {
        where.businessType = businessType;
      }

      const [organizations, total] = await Promise.all([
        prisma.organization.findMany({
          where,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            userOrganizations: {
              where: { isOwner: true },
              include: { user: true },
            },
            subscriptions: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            _count: {
              select: {
                products: true,
                sales: true,
                customers: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.organization.count({ where }),
      ]);

      res.json({
        organizations: organizations.map((o) => ({
          id: o.id,
          name: o.name,
          businessType: o.businessType,
          address: o.address,
          phone: o.phone,
          email: o.email,
          isActive: o.isActive,
          owner: o.userOrganizations[0]?.user || null,
          subscription: o.subscriptions[0] || null,
          stats: {
            products: o._count.products,
            sales: o._count.sales,
            customers: o._count.customers,
          },
          createdAt: o.createdAt,
        })),
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching organizations:", error);
      res.status(500).json({ error: "Failed to fetch organizations" });
    }
  },

  async getOrganizationDetails(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);

      const organization = await prisma.organization.findUnique({
        where: { id },
        include: {
          userOrganizations: {
            include: { user: true },
          },
          subscriptions: {
            orderBy: { createdAt: "desc" },
            include: {
              payments: {
                orderBy: { createdAt: "desc" },
              },
            },
          },
          _count: {
            select: {
              products: true,
              sales: true,
              customers: true,
            },
          },
        },
      });

      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      res.json(organization);
    } catch (error) {
      console.error("Error fetching organization details:", error);
      res.status(500).json({ error: "Failed to fetch organization details" });
    }
  },

  async updateOrganizationStatus(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const { isActive } = req.body;

      const organization = await prisma.organization.update({
        where: { id },
        data: { isActive },
      });

      res.json({ message: "Organization status updated", organization });
    } catch (error) {
      console.error("Error updating organization status:", error);
      res.status(500).json({ error: "Failed to update organization status" });
    }
  },

  async getAllPharmacies(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10, search, status } = req.query;

      const where: any = {};

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { email: { contains: search as string, mode: "insensitive" } },
        ];
      }

      if (status === "active" || status === "inactive") {
        where.isActive = status === "active";
      }

      const [organizations, total] = await Promise.all([
        prisma.organization.findMany({
          where,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            userOrganizations: {
              where: { isOwner: true },
              include: { user: true },
            },
            subscriptions: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            _count: {
              select: {
                products: true,
                sales: true,
                customers: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.organization.count({ where }),
      ]);

      res.json({
        pharmacies: organizations.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          phone: p.phone,
          email: p.email,
          isActive: p.isActive,
          owner: p.userOrganizations[0]?.user || null,
          subscription: p.subscriptions[0] || null,
          stats: {
            products: p._count.products,
            sales: p._count.sales,
            customers: p._count.customers,
          },
          createdAt: p.createdAt,
        })),
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching pharmacies:", error);
      res.status(500).json({ error: "Failed to fetch pharmacies" });
    }
  },

  async getAllOrganizationDetails(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);

      const organization = await prisma.organization.findUnique({
        where: { id },
        include: {
          userOrganizations: {
            include: { user: true },
          },
          subscriptions: {
            orderBy: { createdAt: "desc" },
            include: {
              payments: {
                orderBy: { createdAt: "desc" },
              },
            },
          },
          _count: {
            select: {
              products: true,
              sales: true,
              customers: true,
            },
          },
        },
      });

      if (!organization) {
        return res.status(404).json({ error: "organization not found" });
      }

      res.json(organization);
    } catch (error) {
      console.error("Error fetching organization details:", error);
      res.status(500).json({ error: "Failed to fetch organization details" });
    }
  },

  async updateorganizationStatus(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const { isActive } = req.body;

      const organization = await prisma.organization.update({
        where: { id },
        data: { isActive },
      });

      res.json({ message: "organization status updated", organization });
    } catch (error) {
      console.error("Error updating organization status:", error);
      res.status(500).json({ error: "Failed to update organization status" });
    }
  },

  async getAllSubscriptions(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10, status } = req.query;

      const where: any = {};
      if (status) {
        where.status = status;
      }

      const [subscriptions, total] = await Promise.all([
        prisma.subscription.findMany({
          where,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            organization: {
              include: {
                userOrganizations: {
                  where: { isOwner: true },
                  include: { user: true },
                },
              },
            },
            payments: {
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.subscription.count({ where }),
      ]);

      res.json({
        subscriptions,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  },

  async getExpiringSubscriptions(req: Request, res: Response) {
    try {
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      const subscriptions = await prisma.subscription.findMany({
        where: {
          status: "ACTIVE",
          endDate: {
            lte: sevenDaysFromNow,
            gte: new Date(),
          },
        },
        include: {
          organization: {
            include: {
              userOrganizations: {
                where: { isOwner: true },
                include: { user: true },
              },
            },
          },
        },
        orderBy: { endDate: "asc" },
      });

      res.json(subscriptions);
    } catch (error) {
      console.error("Error fetching expiring subscriptions:", error);
      res.status(500).json({ error: "Failed to fetch expiring subscriptions" });
    }
  },

  async extendSubscription(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const { endDate, monthsToAdd } = req.body;

      const subscription = await prisma.subscription.findUnique({
        where: { id },
        include: { organization: true },
      });

      if (!subscription) {
        return res.status(404).json({ error: "Subscription not found" });
      }

      let newEndDate: Date;

      if (endDate) {
        newEndDate = new Date(endDate);
        if (isNaN(newEndDate.getTime())) {
          return res.status(400).json({ error: "Invalid endDate" });
        }
      } else if (monthsToAdd) {
        const months = Number(monthsToAdd);
        if (months < 1 || !Number.isInteger(months)) {
          return res.status(400).json({ error: "monthsToAdd must be a positive integer" });
        }
        newEndDate = new Date(subscription.endDate ?? new Date());
        newEndDate.setMonth(newEndDate.getMonth() + months);
      } else {
        return res.status(400).json({ error: "Provide either endDate or monthsToAdd" });
      }

      // Only allow future dates
      if (newEndDate <= new Date()) {
        return res.status(400).json({ error: "endDate must be in the future" });
      }

      const updated = await prisma.subscription.update({
        where: { id },
        data: {
          endDate: newEndDate,
          ...(subscription.status === "EXPIRED" || subscription.status === "CANCELED" || subscription.status === "CANCELLED"
            ? { status: "ACTIVE" }
            : {}),
        },
        include: { organization: true },
      });

      // If the org was deactivated and the subscription is now active, reactivate it
      if (!subscription.organization.isActive && (updated.status === "ACTIVE" || updated.status === "GRACE_PERIOD" || updated.status === "TRIALING")) {
        await prisma.organization.update({
          where: { id: subscription.organizationId },
          data: { isActive: true },
        });
      }

      console.log(`System owner extended subscription ${id} to ${newEndDate.toISOString()}`);

      res.json({ message: "Subscription extended successfully", subscription: updated });
    } catch (error) {
      console.error("Error extending subscription:", error);
      res.status(500).json({ error: "Failed to extend subscription" });
    }
  },

  async updatePaymentStatus(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;

      const validStatuses = ["COMPLETED", "FAILED", "REFUNDED", "CANCELED", "UNPAID"];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
      }

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: { subscription: { include: { organization: true } } },
      });

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      const data: any = { status };
      if (status === "COMPLETED") {
        data.processedAt = new Date();
      }

      const updated = await prisma.payment.update({
        where: { id },
        data,
      });

      // Best-effort RRA EBM fiscalization of the subscription receipt when the
      // payment is marked completed by the system owner.
      if (status === "COMPLETED" && payment.subscription?.organizationId) {
        try {
          const { fiscalizeSubscriptionPayment } = await import('../services/billing-ebm.service');
          const { isEbmEnabled } = await import('../services/rra-ebm.service');
          if (isEbmEnabled()) {
            await fiscalizeSubscriptionPayment({
              paymentId: id,
              organizationId: payment.subscription.organizationId,
            });
          }
        } catch (err) {
          console.error(`Failed to fiscalize subscription payment ${id}:`, err);
        }
      }

      console.log(`System owner updated payment ${id} status to ${status}`);

      res.json({ message: "Payment status updated", payment: updated });
    } catch (error) {
      console.error("Error updating payment status:", error);
      res.status(500).json({ error: "Failed to update payment status" });
    }
  },

  async getAllPayments(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10, status } = req.query;

      const where: any = {};
      if (status) {
        where.status = status;
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            subscription: {
              include: {
                organization: true,
                plan: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.payment.count({ where }),
      ]);

      res.json({
        payments,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  },

  async resendInvoice(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          subscription: {
            include: {
              organization: {
                include: {
                  userOrganizations: {
                    where: { isOwner: true },
                    include: { user: true },
                  },
                },
              },
              plan: true,
            },
          },
        },
      });

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      const organization = payment.subscription.organization;
      const ownerUser = organization.userOrganizations?.[0]?.user;
      const subscriberEmail = ownerUser?.email || organization.email;

      if (!subscriberEmail) {
        return res.status(400).json({ error: "No subscriber email found for this organization" });
      }

      const period =
        payment.subscription.billingMode === "YEARLY" ? "year" : "month";

      await emailService.sendInvoiceEmail(subscriberEmail, organization.name, {
        invoiceId: String(payment.id),
        amount: payment.amount,
        currency: payment.currency,
        period,
        date: payment.processedAt
          ? new Date(payment.processedAt).toLocaleDateString()
          : new Date(payment.createdAt).toLocaleDateString(),
        planName: payment.subscription.plan?.name,
        paymentMethod: payment.paymentMethod,
        status: payment.status,
      });

      console.log(
        `System owner resent invoice ${id} to ${subscriberEmail} for ${organization.name}`
      );

      res.json({
        message: "Invoice resent successfully",
        to: subscriberEmail,
      });
    } catch (error) {
      console.error("Error resending invoice:", error);
      res.status(500).json({ error: "Failed to resend invoice" });
    }
  },

  async getPendingPayments(req: Request, res: Response) {
    try {
      const payments = await prisma.payment.findMany({
        where: { status: "PENDING" },
        include: {
          subscription: {
            include: {
              organization: {
                include: {
                  userOrganizations: {
                    where: { isOwner: true },
                    include: { user: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      res.json(payments);
    } catch (error) {
      console.error("Error fetching pending payments:", error);
      res.status(500).json({ error: "Failed to fetch pending payments" });
    }
  },

  async getRevenueAnalytics(req: Request, res: Response) {
    try {
      const { period = "monthly" } = req.query;

      let dateFormat: string;

      switch (period) {
        case "daily":
          dateFormat = "%Y-%m-%d";
          break;
        case "monthly":
          dateFormat = "%Y-%m";
          break;
        case "yearly":
          dateFormat = "%Y";
          break;
        default:
          dateFormat = "%Y-%m";
      }

      const revenue = await prisma.$queryRaw`
        SELECT 
          TO_CHAR("paidAt", ${dateFormat}) as period,
          SUM(amount) as total,
          COUNT(*) as count
        FROM payments
        WHERE status = 'COMPLETED'
        GROUP BY period
        ORDER BY period DESC
        LIMIT 12
      `;

      const totalRevenue = await prisma.payment.aggregate({
        where: { status: "COMPLETED" },
        _sum: { amount: true },
      });

      res.json({
        revenue,
        totalRevenue: totalRevenue._sum.amount || 0,
      });
    } catch (error) {
      console.error("Error fetching revenue analytics:", error);
      res.status(500).json({ error: "Failed to fetch revenue analytics" });
    }
  },

  async getGrowthAnalytics(req: Request, res: Response) {
    try {
      const organizationGrowth = await prisma.$queryRaw`
        SELECT 
          TO_CHAR("createdAt", '%Y-%m') as month,
          COUNT(*) as count
        FROM organizations
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `;

      const userGrowth = await prisma.$queryRaw`
        SELECT 
          TO_CHAR("createdAt", '%Y-%m') as month,
          COUNT(*) as count
        FROM users
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `;

      res.json({
        organizationGrowth,
        userGrowth,
      });
    } catch (error) {
      console.error("Error fetching growth analytics:", error);
      res.status(500).json({ error: "Failed to fetch growth analytics" });
    }
  },
};
