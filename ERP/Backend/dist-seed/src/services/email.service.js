"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
const date_fns_1 = require("date-fns");
class EmailService {
    constructor() {
        this.emailLog = [];
        this.transporter = nodemailer_1.default.createTransport({
            host: config_1.config.email.host,
            port: config_1.config.email.port,
            secure: config_1.config.email.port === 465,
            auth: {
                user: config_1.config.email.user,
                pass: config_1.config.email.password,
            },
        });
    }
    async sendMail(options) {
        try {
            const info = await this.transporter.sendMail(options);
            const recipientStr = typeof options.to === 'string' ? options.to : Array.isArray(options.to) ? options.to.join(', ') : '';
            const logEntry = {
                to: recipientStr,
                subject: options.subject || '',
                status: 'sent',
                messageId: info.messageId,
                timestamp: new Date(),
            };
            this.emailLog.push(logEntry);
            console.log(`[EmailService] Email sent to ${recipientStr} | subject="${options.subject}" | messageId=${info.messageId}`);
            return info;
        }
        catch (error) {
            const recipientStr = typeof options.to === 'string' ? options.to : Array.isArray(options.to) ? options.to.join(', ') : '';
            const logEntry = {
                to: recipientStr,
                subject: options.subject || '',
                status: 'failed',
                error: error.message,
                timestamp: new Date(),
            };
            this.emailLog.push(logEntry);
            console.error(`[EmailService] Failed to send email to ${recipientStr} | subject="${options.subject}":`, error);
            throw error;
        }
    }
    getEmailLog() {
        return this.emailLog;
    }
    clearEmailLog() {
        this.emailLog = [];
    }
    async sendInvitationEmail(email, organizationName, role, token, defaultPassword) {
        const inviteLink = `${config_1.config.primaryFrontendUrl}/accept-invite?token=${token}`;
        const passwordSection = defaultPassword
            ? `<p>Use this password to login: <strong>${defaultPassword}</strong> you will be requested to change it.</p>`
            : `<p>Please use your existing account credentials to login.</p>`;
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `Invitation to join ${organizationName}`,
            html: `
        <h2>You've been invited to join ${organizationName}</h2>
        <p>You have been invited to join as a <strong>${role}</strong>.</p>
        ${passwordSection}
        <p>Click the link below to accept the invitation:</p>
        <a href="${inviteLink}" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Accept Invitation</a>
        <p>This invitation will expire in 7 days.</p>
      `,
        });
    }
    async sendExpiryAlert(email, organizationName, products) {
        const productList = products
            .map((item) => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.name}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.batchNumber}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.quantity}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${new Date(item.expiryDate).toLocaleDateString()}</td>
        <td style="padding: 8px; border: 1px solid #ddd; color: ${item.daysRemaining < 0
            ? "red"
            : item.daysRemaining <= 7
                ? "orange"
                : "yellow"};">
          ${item.daysRemaining < 0 ? "EXPIRED" : `${item.daysRemaining} days`}
        </td>
      </tr>
    `)
            .join("");
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `⚠️ Product Expiry Alert - ${organizationName}`,
            html: `
        <h2>Product Expiry Alert for ${organizationName}</h2>
        <p>The following products are expired or expiring soon:</p>
        <table style="border-collapse: collapse; width: 100%; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f3f4f6;">
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Product</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Batch Number</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Quantity</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Expiry Date</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${productList}
          </tbody>
        </table>
        <p style="margin-top: 20px; color: #dc2626;">
          <strong>Action Required:</strong> Please review and remove expired items from inventory.
        </p>
      `,
        });
    }
    async sendDailyReport(email, organizationName, reportData) {
        const today = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `📊 Daily Summary Report - ${organizationName} - ${today}`,
            html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
          <div style="background-color: #1e40af; padding: 25px; border-radius: 8px 8px 0 0; text-align: center; color: white;">
            <h2 style="margin: 0; font-size: 24px;">Daily Performance Report</h2>
            <p style="margin: 5px 0 0; opacity: 0.9;">${organizationName}</p>
          </div>
          
          <div style="padding: 30px; background-color: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="margin-top: 0; color: #6b7280;">Here is your business summary for <strong>${today}</strong>.</p>
            
            <div style="margin-bottom: 30px;">
                <h3 style="color: #111827; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px; margin-bottom: 15px;">💰 Financial Summary</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #4b5563;">Total Sales</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #059669;">${reportData.totalSales.toLocaleString()} RWF</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #4b5563;">Cash Transactions</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold;">${reportData.cashSales.toLocaleString()} RWF</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #4b5563;">Insurance/Credit Sales</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold;">${reportData.insuranceSales.toLocaleString()} RWF</td>
                    </tr>
                    <tr style="border-top: 1px solid #f3f4f6;">
                        <td style="padding: 8px 0; color: #4b5563;">Number of Sales</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold;">${reportData.transactionCount}</td>
                    </tr>
                </table>
            </div>

            <div style="margin-bottom: 30px;">
                <h3 style="color: #111827; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px; margin-bottom: 15px;">📦 Inventory Status</h3>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <div style="flex: 1; background-color: #fff7ed; padding: 12px; border-radius: 6px; border: 1px solid #ffedd5; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #9a3412;">${reportData.lowStockCount}</div>
                        <div style="font-size: 12px; color: #7c2d12;">Low Stock</div>
                    </div>
                    <div style="flex: 1; background-color: #fef2f2; padding: 12px; border-radius: 6px; border: 1px solid #fee2e2; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #b91c1c;">${reportData.expiredCount}</div>
                        <div style="font-size: 12px; color: #991b1b;">Expired Items</div>
                    </div>
                </div>
                <p style="font-size: 13px; color: #6b7280; margin: 0;">Expiring in next 30 days: <strong>${reportData.expiringSoonCount}</strong> items</p>
            </div>

            <div style="margin-bottom: 30px;">
                <h3 style="color: #111827; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px; margin-bottom: 15px;">🤝 Customer Balances</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #4b5563;">Total Outstanding Debt</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #dc2626;">${reportData.totalDebt.toLocaleString()} RWF</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #4b5563;">Active Debtors</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold;">${reportData.debtorCount}</td>
                    </tr>
                </table>
            </div>

            <div style="text-align: center; margin-top: 40px; border-top: 1px solid #f3f4f6; padding-top: 20px;">
                <a href="${config_1.config.primaryFrontendUrl}/dashboard" style="background-color: #1e40af; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Full Dashboard</a>
                <p style="font-size: 12px; color: #9ca3af; margin-top: 20px;">
                    This is an automated report generated by ${config_1.config.appName}.<br>
                    To manage your email preferences, visit your account settings.
                </p>
            </div>
          </div>
        </div>
      `,
        });
    }
    async sendSubscriptionReminder(email, organizationName, daysLeft) {
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `⚠️ Subscription Expiring Soon - ${organizationName}`,
            html: `
        <h2>Subscription Expiring Soon</h2>
        <p>Your subscription for <strong>${organizationName}</strong> will expire in <strong>${daysLeft} days</strong>.</p>
        <p>Please renew your subscription to continue using the pharmacy management system.</p>
        <a href="${config_1.config.primaryFrontendUrl}/subscription" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Renew Subscription</a>
      `,
        });
    }
    async sendSubscriptionStatusUpdate(email, organizationName, subject, message) {
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `${subject} - ${organizationName}`,
            html: `
        <h2>${subject}</h2>
        <p>${message}</p>
        <a href="${config_1.config.primaryFrontendUrl}/subscription" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Renew Subscription</a>
      `,
        });
    }
    async sendPaymentConfirmation(email, organizationName, amount, period) {
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `Payment Confirmation - ${organizationName}`,
            html: `
        <h2>Payment Successful</h2>
        <p>Thank you for your payment!</p>
        <ul>
          <li><strong>Pharmacy:</strong> ${organizationName}</li>
          <li><strong>Amount:</strong> $${amount.toFixed(2)}</li>
          <li><strong>Subscription Period:</strong> ${period}</li>
          <li><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
        </ul>
        <p>Your subscription has been activated and will remain active for the selected period.</p>
      `,
        });
    }
    async sendInvoiceEmail(email, organizationName, invoice) {
        const currencySymbol = invoice.currency === "RWF" ? "RWF" : invoice.currency || "USD";
        const statusLabel = invoice.status
            ? invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()
            : "Paid";
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `Invoice #${invoice.invoiceId} - ${organizationName}`,
            html: `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f4f6f8; padding: 40px;">
          <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            <div style="background-color: #1e3a8a; padding: 24px 32px; color: #ffffff;">
              <h1 style="margin: 0; font-size: 22px;">INVOICE</h1>
              <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Exceledge ERP</p>
            </div>
            <div style="padding: 32px;">
              <p style="margin: 0 0 20px; font-size: 14px; color: #555;">
                Hello,<br/>
                Please find your invoice for <strong>${organizationName}</strong> below.
              </p>
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 10px 0; color: #888;">Invoice ID</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold;">#${invoice.invoiceId}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #888;">Invoice Date</td>
                  <td style="padding: 10px 0; text-align: right;">${invoice.date}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #888;">Organization</td>
                  <td style="padding: 10px 0; text-align: right;">${organizationName}</td>
                </tr>
                ${invoice.planName ? `<tr><td style="padding: 10px 0; color: #888;">Plan</td><td style="padding: 10px 0; text-align: right;">${invoice.planName}</td></tr>` : ""}
                <tr>
                  <td style="padding: 10px 0; color: #888;">Billing Period</td>
                  <td style="padding: 10px 0; text-align: right;">${invoice.period}</td>
                </tr>
                ${invoice.paymentMethod ? `<tr><td style="padding: 10px 0; color: #888;">Payment Method</td><td style="padding: 10px 0; text-align: right;">${invoice.paymentMethod}</td></tr>` : ""}
                <tr>
                  <td style="padding: 10px 0; color: #888;">Status</td>
                  <td style="padding: 10px 0; text-align: right;">
                    <span style="background-color: ${invoice.status === "PENDING" ? "#f59e0b" : invoice.status === "FAILED" ? "#ef4444" : "#10b981"}; color: #ffffff; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold;">${statusLabel}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 0; border-top: 2px solid #e5e7eb; color: #1e3a8a; font-weight: bold; font-size: 15px;">TOTAL</td>
                  <td style="padding: 14px 0; border-top: 2px solid #e5e7eb; text-align: right; font-weight: bold; font-size: 18px; color: #1e3a8a;">${currencySymbol} ${invoice.amount.toLocaleString()}</td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 13px; color: #777;">
                Thank you for choosing Exceledge ERP!<br/>
                For any inquiries, contact us at <a href="mailto:info@exceledgecpa.com" style="color: #1e3a8a;">info@exceledgecpa.com</a>.
              </p>
            </div>
          </div>
        </div>
      `,
        });
    }
    async sendInvitationAcceptedOrDeclinedEmail(email, organizationName, status, invitedEmail) {
        const isAccepted = status.toLowerCase() === "accepted";
        const htmlTemplate = `
  <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 40px;">
    <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
      <div style="background-color: ${isAccepted ? "#16a34a" : "#dc2626"}; color: white; text-align: center; padding: 20px;">
        <h2 style="margin: 0;">Invitation ${status}</h2>
      </div>
      <div style="padding: 30px; color: #333;">
        <p style="font-size: 16px; line-height: 1.5;">
          Hello,
        </p>
        <p style="font-size: 16px; line-height: 1.5;">
          <strong>${invitedEmail}</strong> has <strong>${status.toLowerCase()}</strong> the invitation to join <strong>${organizationName}</strong>.
        </p>
        ${isAccepted
            ? `<p style="font-size: 15px; line-height: 1.5; color: #16a34a;">
                🎉 We’re excited to welcome them onboard!
              </p>`
            : `<p style="font-size: 15px; line-height: 1.5; color: #dc2626;">
                The invitation was declined. You may choose to invite another member.
              </p>`}
        <div style="margin-top: 30px; text-align: center;">
          <a href="#" style="display: inline-block; padding: 10px 20px; background-color: ${isAccepted ? "#16a34a" : "#dc2626"}; color: #ffffff; text-decoration: none; border-radius: 5px;">
            View Details
          </a>
        </div>
      </div>
      <div style="background-color: #f9fafb; text-align: center; padding: 15px; font-size: 12px; color: #777;">
        <p style="margin: 0;">&copy; ${new Date().getFullYear()} ${organizationName}. All rights reserved.</p>
      </div>
    </div>
  </div>
  `;
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `Invitation ${status} - ${organizationName}`,
            html: htmlTemplate,
        });
    }
    async sendPurchaseOrderToSupplier(supplierEmail, supplierName, organizationName, orderNumber, items, totalAmount, notes, expectedDate, creatorEmail, updateType) {
        const isUpdate = updateType === 'updated';
        const subject = isUpdate
            ? `Purchase Order ${orderNumber} Updated by ${organizationName}`
            : `New Purchase Order ${orderNumber} from ${organizationName}`;
        const itemsList = items
            .map((item) => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.productName}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${Number(item.unitPrice).toLocaleString()} Frw</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${Number(item.totalPrice).toLocaleString()} Frw</td>
      </tr>
    `)
            .join("");
        const viewUrl = `${config_1.config.primaryFrontendUrl}/supplier-portal/orders?order=${orderNumber}`;
        await this.sendMail({
            from: config_1.config.email.from,
            to: supplierEmail,
            ...(creatorEmail ? { replyTo: creatorEmail } : {}),
            subject,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #333;">
          <div style="background-color: #1e40af; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h2 style="color: white; margin: 0;">${isUpdate ? 'Purchase Order Updated' : 'New Purchase Order'}</h2>
          </div>
          <div style="padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-top: none;">
            <p>Dear <strong>${supplierName}</strong>,</p>
            <p>${isUpdate
                ? `The purchase order <strong>${orderNumber}</strong> from <strong>${organizationName}</strong> has been updated.`
                : `You have received a new purchase order from <strong>${organizationName}</strong>.`}</p>

            <h3 style="color: #1e40af; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">Order Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
              <tr><td style="padding: 6px 0; color: #666; width: 140px;"><strong>Order Number:</strong></td><td>${orderNumber}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;"><strong>Organization:</strong></td><td>${organizationName}</td></tr>
              <tr><td style="padding: 6px 0; color: #666;"><strong>Order Date:</strong></td><td>${new Date().toLocaleDateString()}</td></tr>
              ${expectedDate ? `<tr><td style="padding: 6px 0; color: #666;"><strong>Delivery Date:</strong></td><td>${new Date(expectedDate).toLocaleDateString()}</td></tr>` : ''}
              <tr><td style="padding: 6px 0; color: #666;"><strong>Total Amount:</strong></td><td style="font-weight: bold; font-size: 16px;">${Number(totalAmount).toLocaleString()} Frw</td></tr>
              ${isUpdate ? '<tr><td style="padding: 6px 0; color: #666;"><strong>Status:</strong></td><td style="color: #f59e0b; font-weight: bold;">UPDATED</td></tr>' : ''}
            </table>

            <h3 style="color: #1e40af; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">Items</h3>
            <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
              <thead>
                <tr style="background-color: #f3f4f6;">
                  <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Product</th>
                  <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Quantity</th>
                  <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Unit Price</th>
                  <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsList}
              </tbody>
              <tfoot>
                <tr style="background-color: #f9fafb; font-weight: bold;">
                  <td colspan="3" style="padding: 10px; border: 1px solid #ddd; text-align: right;">Total Amount:</td>
                  <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">${Number(totalAmount).toLocaleString()} Frw</td>
                </tr>
              </tfoot>
            </table>

            ${notes ? `<p style="margin-top: 16px;"><strong>Notes:</strong> ${notes}</p>` : ''}

            <div style="text-align: center; margin-top: 28px;">
              <a href="${viewUrl}" style="background-color: #1e40af; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px;">
                View Purchase Order
              </a>
            </div>

            <p style="margin-top: 20px; font-size: 13px; color: #6b7280; text-align: center; border-top: 1px solid #f3f4f6; padding-top: 16px;">
              ${isUpdate ? 'Please review the updated details.' : 'Please confirm receipt of this order and provide an estimated delivery date.'}<br>
              Thank you for your business with <strong>${organizationName}</strong>!
            </p>
          </div>
        </div>
      `,
        });
    }
    async sendPurchaseOrderStatusUpdate(email, organizationName, orderNumber, status, supplierName) {
        const statusMessages = {
            PENDING: "is pending confirmation",
            APPROVED: "has been approved by the supplier",
            ORDERED: "has been confirmed and is being processed",
            SHIPPED: "has been shipped",
            DELIVERED: "has been delivered",
            CANCELLED: "has been cancelled",
        };
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `Purchase Order ${orderNumber} Status Update`,
            html: `
        <h2>Purchase Order Status Update</h2>
        <p>Your purchase order <strong>${orderNumber}</strong> ${statusMessages[status] || "status has been updated"}.</p>
        
        <ul>
          <li><strong>Order Number:</strong> ${orderNumber}</li>
          <li><strong>Supplier:</strong> ${supplierName}</li>
          <li><strong>New Status:</strong> <span style="color: ${status === "DELIVERED" ? "#10b981" : status === "CANCELLED" ? "#ef4444" : "#3b82f6"}; font-weight: bold;">${status}</span></li>
          <li><strong>Updated:</strong> ${new Date().toLocaleDateString()}</li>
        </ul>

        <p>You can view the full order details in your dashboard.</p>
        <a href="${config_1.config.primaryFrontendUrl}/dashboard/orders" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Purchase Orders</a>
      `,
        });
    }
    async sendPurchaseOrderCreatedNotification(organizationEmail, organizationName, orderNumber, supplierName, totalAmount, createdByName, createdAt, createdByEmail) {
        const viewUrl = `${config_1.config.primaryFrontendUrl}/dashboard/orders`;
        await this.sendMail({
            from: config_1.config.email.from,
            to: organizationEmail,
            ...(createdByEmail ? { replyTo: createdByEmail } : {}),
            subject: `Purchase Order Created - ${orderNumber}`,
            html: `
        <h2>Purchase Order Created</h2>
        <p>A new purchase order has been created for <strong>${organizationName}</strong>.</p>

        <ul>
          <li><strong>Organization:</strong> ${organizationName}</li>
          <li><strong>Purchase Order Number:</strong> ${orderNumber}</li>
          <li><strong>Supplier:</strong> ${supplierName}</li>
          <li><strong>Total Amount:</strong> ${totalAmount.toFixed(2)} Frw</li>
          <li><strong>Created By:</strong> ${createdByName}</li>
          <li><strong>Date:</strong> ${createdAt.toLocaleString()}</li>
        </ul>

        <a href="${viewUrl}" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Purchase Order</a>
      `,
        });
    }
    async sendPurchaseOrderUpdatedNotification(organizationEmail, organizationName, orderNumber, supplierName, updatedByName, updatedAt, status, changesSummary, creatorEmail) {
        const viewUrl = `${config_1.config.primaryFrontendUrl}/dashboard/orders`;
        await this.sendMail({
            from: config_1.config.email.from,
            to: organizationEmail,
            ...(creatorEmail ? { replyTo: creatorEmail } : {}),
            subject: `Purchase Order Updated - ${orderNumber}`,
            html: `
        <h2>Purchase Order Updated</h2>
        <p>Purchase order <strong>${orderNumber}</strong> for <strong>${organizationName}</strong> has been updated.</p>

        <ul>
          <li><strong>Organization:</strong> ${organizationName}</li>
          <li><strong>Purchase Order Number:</strong> ${orderNumber}</li>
          <li><strong>Supplier:</strong> ${supplierName}</li>
          <li><strong>Updated By:</strong> ${updatedByName}</li>
          <li><strong>Update Time:</strong> ${updatedAt.toLocaleString()}</li>
          <li><strong>Current Status:</strong> <span style="color: ${status === "COMPLETED" ? "#10b981" : status === "CANCELLED" || status === "REJECTED" ? "#ef4444" : "#3b82f6"}; font-weight: bold;">${status}</span></li>
        </ul>

        <p><strong>Summary of changes:</strong> ${changesSummary}</p>

        <a href="${viewUrl}" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Purchase Order</a>
      `,
        });
    }
    async sendVerificationEmail(email, name, verificationCode) {
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: 'Verify Your Email Address',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
          <div style="background-color: #f8fafc; padding: 2rem; border-radius: 0.5rem; border: 1px solid #e2e8f0;">
            <div style="text-align: center; margin-bottom: 1.5rem;">
              <h1 style="color: #1e40af; margin: 0 0 1rem 0; font-size: 1.5rem; font-weight: 600;">
                Welcome to ${config_1.config.appName}!
              </h1>
              <div style="height: 4px; width: 60px; background-color: #3b82f6; margin: 0 auto 1.5rem;"></div>
            </div>
            
            <p>Hello ${name},</p>
            <p>Thank you for signing up. Please use the following verification code to verify your email address:</p>
            
            <div style="text-align: center; margin: 2rem 0;">
              <div style="background-color: #f1f5f9; 
                          border: 1px solid #e2e8f0;
                          border-left: 4px solid #3b82f6; 
                          padding: 1rem 1.5rem; 
                          margin: 1rem auto; 
                          font-size: 1.5rem; 
                          font-weight: 600; 
                          color: #1e40af;
                          display: inline-block;
                          letter-spacing: 0.5em;
                          text-indent: 0.5em;
                          border-radius: 0.25rem;
                          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
                ${verificationCode}
              </div>
              
              <p style="color: #6b7280; font-size: 0.875rem; margin: 1.5rem 0 0.5rem;">
                Please enter this code in the verification form to complete your registration.
              </p>
              
              <p style="color: #ef4444; font-size: 0.75rem; margin: 1rem 0 0; font-style: italic;">
                This code will expire in 24 hours
              </p>
            </div>
            
            <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0; font-size: 0.8125rem; color: #6b7280;">
              <p style="margin: 0.25rem 0;">If you didn't request this email, you can safely ignore it.</p>
              <p style="margin: 0.25rem 0; font-weight: 600; color: #1e40af; margin-top: 1rem;">The ${config_1.config.appName} Team</p>
            </div>
          </div>
        </div>
      `,
        });
    }
    async sendPasswordResetEmail(email, name, token) {
        const resetLink = `${config_1.config.primaryFrontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
        const expiryTime = (0, date_fns_1.format)(new Date(Date.now() + 60 * 60 * 1000), 'MMMM d, yyyy h:mm a');
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: 'Reset Your Password',
            // Always include a plain-text alternative. Some mobile email clients and
            // privacy modes suppress styled HTML, but the OTP must remain visible.
            text: [
                `Hello ${name},`,
                '',
                `Your ${config_1.config.appName} password reset code is: ${token}`,
                '',
                'The code expires in one hour.',
                `You can also reset your password here: ${resetLink}`,
                '',
                "If you didn't request this reset, you can ignore this email.",
            ].join('\n'),
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hello ${name},</p>
          <p>We received a request to reset your password.</p>

          <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
            Enter this 6-digit code in the Excel Edge POS mobile app:
          </p>
          <div style="background-color: #f1f5f9;
                      border: 1px solid #e2e8f0;
                      border-left: 4px solid #3b82f6;
                      padding: 16px 22px;
                      margin: 12px auto 24px;
                      width: fit-content;
                      font-size: 28px;
                      font-weight: 700;
                      color: #1e40af;
                      letter-spacing: 0.35em;
                      text-indent: 0.35em;
                      border-radius: 6px;">
            ${token}
          </div>

          <p>Or use the secure browser link:</p>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="${resetLink}" 
               style="background-color: #3b82f6; 
                      color: white; 
                      padding: 12px 24px; 
                      text-decoration: none; 
                      border-radius: 6px; 
                      font-weight: 500;
                      display: inline-block;
                      margin-bottom: 20px;">
              Reset My Password
            </a>
            <p style="color: #6b7280; font-size: 14px; margin: 10px 0 0 0;">
              Or copy and paste this link into your browser:
            </p>
            <div style="background-color: #f8f9fa; 
                        padding: 12px 20px; 
                        margin: 10px auto; 
                        font-size: 18px; 
                        color: #1f2937;
                        display: inline-block;
                        letter-spacing: 2px;">
              ${resetLink}
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              This code will expire on ${expiryTime}.
            </p>
          </div>
          <p>If you didn't request a password reset, please ignore this email or contact support if you have any concerns.</p>
          <p>Best regards,<br>The ${config_1.config.appName} Team</p>
        </div>
      `,
        });
    }
    async sendPasswordResetConfirmation(email, name) {
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: 'Password Successfully Reset',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Successfully Reset</h2>
          <p>Hello ${name},</p>
          <p>Your password has been successfully reset. If you did not make this change, please contact our support team immediately.</p>
          <p>Best regards,<br>The ${config_1.config.appName} Team</p>
        </div>
      `,
        });
    }
    async sendTrialExpiryEmail(email, title, message, organizationName, expiryDate) {
        const formattedExpiryDate = (0, date_fns_1.format)(expiryDate, 'MMMM d, yyyy');
        await this.sendMail({
            from: config_1.config.email.from,
            to: email,
            subject: `🔔 ${title} - ${organizationName}`,
            html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
          <div style="background-color: #1e40af; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; color: white;">
            <h2 style="margin: 0; font-size: 24px;">${title}</h2>
            <p style="margin: 10px 0 0; opacity: 0.9;">${organizationName}</p>
          </div>
          
          <div style="padding: 40px; background-color: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; text-align: center;">
            <div style="margin-bottom: 25px;">
              <div style="display: inline-block; background-color: #fef2f2; border: 1px solid #fee2e2; padding: 15px 25px; border-radius: 12px; margin-bottom: 20px;">
                <p style="margin: 0; color: #b91c1c; font-weight: bold; font-size: 16px;">
                  Trial expires on: ${formattedExpiryDate}
                </p>
              </div>
            </div>

            <p style="font-size: 16px; color: #4b5563; margin-bottom: 30px;">
              ${message}
            </p>

            <div style="background-color: #f8fafc; padding: 25px; border-radius: 8px; margin-bottom: 35px; text-align: left;">
              <h4 style="margin: 0 0 15px; color: #1e40af;">Why upgrade to a paid plan?</h4>
              <ul style="margin: 0; padding-left: 20px; color: #4b5563; font-size: 14px;">
                <li style="margin-bottom: 8px;">Unlimited sales and inventory records</li>
                <li style="margin-bottom: 8px;">Multi-branch management and reporting</li>
                <li style="margin-bottom: 8px;">Advanced customer debt tracking</li>
                <li style="margin-bottom: 8px;">Priority technical support</li>
              </ul>
            </div>

            <div style="margin-top: 20px;">
              <a href="${config_1.config.primaryFrontendUrl}/dashboard/settings/subscription" 
                 style="background-color: #1e40af; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
                Upgrade Your Subscription
              </a>
            </div>

            <p style="font-size: 13px; color: #9ca3af; margin-top: 40px; border-top: 1px solid #f3f4f6; padding-top: 25px;">
              Keep managing your pharmacy efficiently with ${config_1.config.appName}.<br>
              Need more time? Contact our sales team for a trial extension.
            </p>
          </div>
        </div>
      `,
        });
    }
}
exports.emailService = new EmailService();
