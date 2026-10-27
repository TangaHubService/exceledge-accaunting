"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_PASSWORD = void 0;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const batch_service_1 = require("../src/services/batch.service");
const inventory_ledger_service_1 = require("../src/services/inventory-ledger.service");
const tax_service_1 = require("../src/services/tax.service");
const rra_ebm_service_1 = require("../src/services/rra-ebm.service");
const item_code_service_1 = require("../src/services/item-code.service");
const purchase_code_checksum_1 = require("../src/services/purchase-code.checksum");
const prisma = new client_1.PrismaClient();
/** Demo login password for all seeded users (development only). */
exports.DEMO_PASSWORD = "TestDemo#123";
const DEMO_ADMIN_EMAIL = "demo.admin@exceledge.test";
const baseFeatures = [
    "Inventory Management",
    "Sales & POS",
    "Purchase order",
    "24/7 support",
];
const subscriptionPlans = [
    {
        title: "Simple Starter",
        price: 15000,
        period: "MONTHLY",
        isActive: true,
        popular: true,
        description: "More power for growing teams — daily backups, priority features, and room to scale.",
        features: [
            "1 user account",
            ...baseFeatures,
        ],
    },
    {
        title: "Essential",
        price: 40000,
        period: "MONTHLY",
        isActive: true,
        description: "Everything you need to get started with inventory, sales, and reporting.",
        features: [
            "4 user accounts",
            ...baseFeatures,
            "Tax declaration service",
            "Quarterly visit",
        ],
    },
    {
        title: "Professional",
        price: 100000,
        period: "MONTHLY",
        isActive: true,
        description: "Everything you need to get started with inventory, sales, and reporting.",
        features: [
            "10 user accounts",
            ...baseFeatures,
            "Payroll management",
            "Tax declaration service",
            "Monthly visit",
        ],
    },
    {
        title: "Advanced",
        price: 500000,
        period: "MONTHLY",
        isActive: true,
        description: "Everything you need to get started with inventory, sales, and reporting.",
        features: [
            "Unlimited user accounts",
            ...baseFeatures,
            "Payroll management",
            "Tax declaration service",
            "QuickBooks Async",
            "Accounting service",
            "Compliance advisory",
            "2 visits a month",
        ],
    },
    {
        // Auto-assigned to every newly registered organization (see
        // organization.controller.ts#createOrganization), which requires a plan
        // named exactly "Free Trial" to exist. Excluded from the public pricing
        // page by name in subscription.controller.ts#getPlans.
        title: "Free Trial",
        price: 0,
        period: "MONTHLY",
        isActive: true,
        description: "Try all features free for 7 days.",
        features: [
            "1 user account",
            ...baseFeatures,
        ],
    },
    {
        // Dev-only plan for exercising the real payment rails (Paypack/Pesapal)
        // end-to-end without charging a real plan price. Excluded from the public
        // pricing page by name in subscription.controller.ts#getPlans, but still
        // purchasable directly via its plan ID like any other active plan.
        title: "Dev Test Plan",
        price: 100,
        period: "MONTHLY",
        isActive: true,
        description: "Internal use only — for testing the payment flow.",
        features: [
            "1 user account",
            ...baseFeatures,
        ],
    },
];
function extractMaxUsers(features) {
    const userFeature = features.find((f) => /user account/i.test(f));
    if (!userFeature)
        return 0;
    if (/unlimited/i.test(userFeature))
        return 0;
    const match = userFeature.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}
async function seedSubscriptionPlans() {
    const allFeatures = new Set();
    subscriptionPlans.forEach((plan) => {
        plan.features.forEach((feature) => allFeatures.add(feature));
    });
    const featureMap = {};
    for (const featureName of allFeatures) {
        const key = featureName.toLowerCase().replace(/\s+/g, "_");
        const feature = await prisma.feature.upsert({
            where: { key },
            update: {},
            create: {
                name: featureName,
                key,
                description: featureName,
            },
        });
        featureMap[featureName] = feature;
    }
    for (const plan of subscriptionPlans) {
        const dbPlan = await prisma.subscriptionPlan.upsert({
            where: { name: plan.title },
            update: {
                description: plan.description,
                price: plan.price,
                currency: "RWF",
                billingCycle: plan.period,
                isActive: plan.isActive,
                maxUsers: extractMaxUsers(plan.features),
            },
            create: {
                name: plan.title,
                description: plan.description,
                price: plan.price,
                currency: "RWF",
                billingCycle: plan.period,
                isActive: plan.isActive,
                maxUsers: extractMaxUsers(plan.features),
            },
        });
        // Re-sync features in array order on every run (create AND update), since
        // upsert's update branch doesn't touch relations and row order otherwise
        // reflects whenever the plan was first seeded rather than the array above.
        await prisma.planFeature.deleteMany({ where: { planId: dbPlan.id } });
        for (const featureName of plan.features) {
            await prisma.planFeature.create({
                data: {
                    planId: dbPlan.id,
                    featureId: featureMap[featureName].id,
                },
            });
        }
        console.log(`Processed plan: ${plan.title}`);
    }
}
const SUPER_ADMIN_EMAIL = "admin@example.com";
/**
 * Idempotent by email: only creates the Super Admin account the first time
 * this seed runs. Reuses the existing SYSTEM_OWNER role (rather than a new
 * SUPER_ADMIN enum value) — SYSTEM_OWNER already bypasses every org-scoped
 * check in the app (see requireSystemOwner / requireOrganizationAccess /
 * requireActiveSubscription), so it needs no organization membership.
 */
async function seedSuperAdmin() {
    const existing = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
    if (existing) {
        console.log(`Super Admin already exists (${SUPER_ADMIN_EMAIL}), skipping.`);
        return;
    }
    // NOTE: the User model has no separate "username" column — email is the
    // sole login identifier throughout this app (see auth.controller.ts login),
    // so the spec's "Username: superadmin" is captured via the display name only.
    const hashedPassword = await bcryptjs_1.default.hash("ChangeMe123!", 10);
    await prisma.user.create({
        data: {
            email: SUPER_ADMIN_EMAIL,
            password: hashedPassword,
            name: "Super Admin",
            role: "SYSTEM_OWNER",
            isActive: true,
            isEmailVerified: true,
        },
    });
    console.log(`Created Super Admin account (${SUPER_ADMIN_EMAIL})`);
}
async function createSaleInTransaction(ctx, input) {
    const { saleNumber, customerId, userId, branchId, paymentType, cashAmount, insuranceAmount, debtAmount, items, isProforma, } = input;
    const { orgId } = ctx;
    let totalAmount = 0;
    for (const item of items) {
        totalAmount += item.quantity * item.unitPrice;
    }
    const { invoiceNumber, vsdcInvcNo } = await (0, rra_ebm_service_1.generateInvoiceNumber)(orgId, branchId);
    const taxSummary = await tax_service_1.TaxService.calculateSaleTax(orgId, items);
    return prisma.$transaction(async (tx) => {
        const saleItemsData = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const productId = item.productId;
            const quantity = item.quantity;
            const unitPrice = item.unitPrice;
            const itemTax = taxSummary.items[i];
            let batchId = null;
            let costPrice = 0;
            const selectedBatches = await (0, batch_service_1.selectBatchesForSale)({
                productId,
                organizationId: orgId,
                quantity,
                method: "FIFO",
                branchId,
            }, tx);
            if (selectedBatches.length > 0) {
                batchId = selectedBatches[0].batchId;
                costPrice = selectedBatches[0].unitCost;
                for (const batch of selectedBatches) {
                    await (0, batch_service_1.updateBatchQuantity)(batch.batchId, batch.quantity, orgId, tx);
                }
            }
            const profit = (unitPrice - costPrice) * quantity;
            const row = {
                quantity,
                unitPrice,
                totalPrice: quantity * unitPrice,
                costPrice,
                profit,
                taxRate: itemTax.taxRate,
                taxAmount: itemTax.taxAmount,
                taxCode: itemTax.taxCode,
                product: { connect: { id: productId } },
            };
            if (batchId !== null) {
                row.batch = { connect: { id: batchId } };
            }
            saleItemsData.push(row);
        }
        const newSale = await tx.sale.create({
            data: {
                saleNumber,
                invoiceNumber,
                vsdcInvcNo,
                customerId,
                userId,
                organizationId: orgId,
                branchId,
                paymentType,
                cashAmount,
                insuranceAmount,
                debtAmount,
                totalAmount,
                vatAmount: taxSummary.vatAmount,
                taxableAmount: taxSummary.taxableAmount,
                status: "COMPLETED",
                isProforma: isProforma ?? false,
                saleItems: { create: saleItemsData },
            },
            include: { saleItems: true },
        });
        for (const item of items) {
            const saleItem = newSale.saleItems.find((si) => si.productId === item.productId);
            await (0, inventory_ledger_service_1.removeStock)({
                organizationId: orgId,
                productId: item.productId,
                userId,
                quantity: item.quantity,
                movementType: "SALE",
                branchId,
                reference: saleNumber,
                referenceType: "SALE",
                note: `Sale #${saleNumber}`,
                batchId: saleItem?.batchId ?? null,
                tx,
            });
        }
        const remainingDebt = totalAmount - cashAmount - insuranceAmount;
        if (remainingDebt > 0) {
            await tx.customer.update({
                where: { id: customerId },
                data: { balance: { increment: remainingDebt } },
            });
        }
        return newSale;
    }, { maxWait: 30000, timeout: 60000 });
}
async function seedDemoDataset() {
    const existing = await prisma.user.findUnique({
        where: { email: DEMO_ADMIN_EMAIL },
    });
    if (existing) {
        console.log("Demo dataset already seeded (skip). Delete demo users to re-seed.");
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(exports.DEMO_PASSWORD, 10);
    const plan = await prisma.subscriptionPlan.findFirst({
        where: { name: "Professional" },
    });
    if (!plan) {
        throw new Error('Subscription plan "Professional" not found. Run plan seed first.');
    }
    const org = await prisma.organization.create({
        data: {
            name: "Exceledge Demo Pharmacy",
            businessType: "PHARMACY",
            currency: "RWF",
            // RRA VSDC test TIN (matches Backend/.env test creds: tin 999945560)
            TIN: "999945560",
            address: "KG 123 St, Kigali",
            phone: "+250788000000",
            email: "demo.shop@exceledge.test",
            isActive: true,
        },
    });
    await prisma.taxConfiguration.create({
        data: {
            organizationId: org.id,
            vatRate: new client_1.Prisma.Decimal("18.00"),
            effectiveDate: new Date("2020-01-01"),
        },
    });
    const subscription = await prisma.subscription.create({
        data: {
            organizationId: org.id,
            planId: plan.id,
            status: "ACTIVE",
            startDate: new Date(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            paymentMethod: "TRIAL",
            autoRenew: true,
        },
    });
    await prisma.payment.create({
        data: {
            subscriptionId: subscription.id,
            amount: 0,
            currency: "RWF",
            paymentMethod: "TRIAL",
            status: "COMPLETED",
            processedAt: new Date(),
        },
    });
    const mainBranch = await prisma.branch.create({
        data: {
            organizationId: org.id,
            name: "Main Store",
            code: "MAIN",
            location: "Kigali City Center",
            status: "ACTIVE",
            isDefault: true,
            // RRA VSDC test device (matching working demo org): bhfId "00", serial "excelwartest"
            bhfId: "00",
            ebmSerialNo: "excelwartest",
        },
    });
    const eastBranch = await prisma.branch.create({
        data: {
            organizationId: org.id,
            name: "East Branch",
            code: "KGL-E",
            location: "Remera",
            status: "ACTIVE",
        },
    });
    await prisma.warehouse.create({
        data: {
            organizationId: org.id,
            name: "Central Warehouse",
            code: "WH-01",
            isDefault: true,
            isActive: true,
        },
    });
    const adminUser = await prisma.user.create({
        data: {
            email: DEMO_ADMIN_EMAIL,
            password: passwordHash,
            name: "Demo Admin",
            phone: "+250788000001",
            role: client_1.UserRole.ADMIN,
            isActive: true,
            isEmailVerified: true,
        },
    });
    const managerUser = await prisma.user.create({
        data: {
            email: "demo.manager@exceledge.test",
            password: passwordHash,
            name: "Demo Branch Manager",
            phone: "+250788000002",
            role: client_1.UserRole.BRANCH_MANAGER,
            isActive: true,
            isEmailVerified: true,
        },
    });
    const sellerUser = await prisma.user.create({
        data: {
            email: "demo.seller@exceledge.test",
            password: passwordHash,
            name: "Demo Seller",
            phone: "+250788000003",
            role: client_1.UserRole.SELLER,
            isActive: true,
            isEmailVerified: true,
        },
    });
    const accountantUser = await prisma.user.create({
        data: {
            email: "demo.accountant@exceledge.test",
            password: passwordHash,
            name: "Demo Accountant",
            phone: "+250788000004",
            role: client_1.UserRole.ACCOUNTANT,
            isActive: true,
            isEmailVerified: true,
        },
    });
    const eastSellerUser = await prisma.user.create({
        data: {
            email: "demo.eastseller@exceledge.test",
            password: passwordHash,
            name: "Demo East Seller",
            phone: "+250788000005",
            role: client_1.UserRole.SELLER,
            isActive: true,
            isEmailVerified: true,
        },
    });
    await prisma.userOrganization.createMany({
        data: [
            {
                userId: adminUser.id,
                organizationId: org.id,
                role: client_1.UserRole.ADMIN,
                isOwner: true,
            },
            {
                userId: managerUser.id,
                organizationId: org.id,
                role: client_1.UserRole.BRANCH_MANAGER,
                isOwner: false,
            },
            {
                userId: sellerUser.id,
                organizationId: org.id,
                role: client_1.UserRole.SELLER,
                isOwner: false,
            },
            {
                userId: eastSellerUser.id,
                organizationId: org.id,
                role: client_1.UserRole.SELLER,
                isOwner: false,
            },
            {
                userId: accountantUser.id,
                organizationId: org.id,
                role: client_1.UserRole.ACCOUNTANT,
                isOwner: false,
            },
        ],
    });
    await prisma.userBranch.createMany({
        data: [
            { userId: adminUser.id, branchId: mainBranch.id, isPrimary: true },
            { userId: adminUser.id, branchId: eastBranch.id, isPrimary: false },
            { userId: managerUser.id, branchId: eastBranch.id, isPrimary: true },
            { userId: sellerUser.id, branchId: mainBranch.id, isPrimary: true },
            { userId: eastSellerUser.id, branchId: eastBranch.id, isPrimary: true },
            { userId: accountantUser.id, branchId: mainBranch.id, isPrimary: true },
            { userId: accountantUser.id, branchId: eastBranch.id, isPrimary: false },
        ],
    });
    const supplierA = await prisma.supplier.create({
        data: {
            organizationId: org.id,
            name: "Kigali Medical Supplies Ltd",
            email: "orders@kms.test",
            phone: "+250788111111",
            address: "Nyarugenge",
            contactPerson: "Jean Supplier",
        },
    });
    const supplierB = await prisma.supplier.create({
        data: {
            organizationId: org.id,
            name: "East Africa Wholesale",
            email: "sales@eaw.test",
            phone: "+250788222222",
            contactPerson: "Mary Wholesale",
        },
    });
    // VSDC §4.3 item types + §4.17 origin (orgnNatCd) must vary in demo data:
    // 1=RAW_MATERIAL, 2=PRODUCT (finished), 3=SERVICE — each from different countries.
    const products = await prisma.$transaction(async (tx) => {
        const defs = [
            // ── Finished products (itemTyCd=2) ──
            {
                name: "Paracetamol 500mg Tablets",
                sku: "PARA-500",
                category: "Pain relief",
                description: "Blister 20 tablets — finished product (RW)",
                unitPrice: "150.00",
                minStock: 20,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000001",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.PRODUCT,
                origin: "RW",
                supplierId: supplierA.id,
                initialQty: 100,
            },
            {
                name: "Amoxicillin 250mg",
                sku: "AMOX-250",
                category: "Antibiotics",
                description: "Finished product imported from Kenya",
                unitPrice: "800.00",
                minStock: 10,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000002",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.PRODUCT,
                origin: "KE",
                supplierId: supplierA.id,
                initialQty: 100,
            },
            {
                name: "Vitamin C 1000mg",
                sku: "VIT-C-1K",
                category: "Vitamins",
                description: "Finished product from Uganda",
                unitPrice: "3500.00",
                minStock: 5,
                taxCategory: client_1.TaxCategory.ZERO_RATED,
                taxCode: client_1.RraTaxCode.B,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000003",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.PRODUCT,
                origin: "UG",
                supplierId: supplierB.id,
                initialQty: 100,
            },
            {
                name: "Hand Sanitizer 500ml",
                sku: "SAN-500",
                category: "Hygiene",
                description: "Finished product from China",
                unitPrice: "2500.00",
                minStock: 15,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000004",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.PRODUCT,
                origin: "CN",
                supplierId: supplierB.id,
                initialQty: 100,
            },
            {
                name: "Cotton Roll 500g",
                sku: "COT-500",
                category: "Supplies",
                description: "Finished product from Tanzania",
                unitPrice: "4200.00",
                minStock: 8,
                taxCategory: client_1.TaxCategory.EXEMPT,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000005",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.PRODUCT,
                origin: "TZ",
                supplierId: supplierA.id,
                initialQty: 100,
            },
            {
                name: "Digital Thermometer",
                sku: "THERM-D1",
                category: "Devices",
                description: "Finished product from India",
                unitPrice: "12000.00",
                minStock: 3,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.B,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000006",
                itemClsCd: "3026530200",
                itemType: client_1.ItemType.PRODUCT,
                origin: "IN",
                supplierId: supplierA.id,
                initialQty: 100,
            },
            // ── Raw materials (itemTyCd=1) ──
            {
                name: "API Paracetamol Powder",
                sku: "RM-PARA-API",
                category: "Raw materials",
                description: "Active pharmaceutical ingredient from India",
                unitPrice: "45000.00",
                minStock: 5,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.KG,
                barcode: "8901000000011",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.RAW_MATERIAL,
                origin: "IN",
                supplierId: supplierA.id,
                initialQty: 50,
            },
            {
                name: "Empty Blister Packs",
                sku: "RM-BLISTER",
                category: "Raw materials",
                description: "Packaging component from China",
                unitPrice: "200.00",
                minStock: 100,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000012",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.RAW_MATERIAL,
                origin: "CN",
                supplierId: supplierB.id,
                initialQty: 500,
            },
            {
                name: "Ethanol 96%",
                sku: "RM-ETH-96",
                category: "Raw materials",
                description: "Solvent / sanitizer base from Kenya",
                unitPrice: "8000.00",
                minStock: 10,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.LTR,
                barcode: "8901000000013",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.RAW_MATERIAL,
                origin: "KE",
                supplierId: supplierB.id,
                initialQty: 80,
            },
            {
                name: "Glycerin USP",
                sku: "RM-GLYCERIN",
                category: "Raw materials",
                description: "Excipient from Uganda",
                unitPrice: "5500.00",
                minStock: 8,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.LTR,
                barcode: "8901000000014",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.RAW_MATERIAL,
                origin: "UG",
                supplierId: supplierA.id,
                initialQty: 40,
            },
            // ── Services (itemTyCd=3) — no stock ──
            {
                name: "Pharmacy Consultation",
                sku: "SVC-CONSULT",
                category: "Services",
                description: "In-store pharmacist consultation (Rwanda)",
                unitPrice: "5000.00",
                minStock: 0,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000021",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.SERVICE,
                origin: "RW",
                supplierId: null,
                initialQty: 0,
            },
            {
                name: "Home Delivery Fee",
                sku: "SVC-DELIVER",
                category: "Services",
                description: "Last-mile delivery service (Burundi origin code for demo)",
                unitPrice: "2000.00",
                minStock: 0,
                taxCategory: client_1.TaxCategory.STANDARD,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000022",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.SERVICE,
                origin: "BI",
                supplierId: null,
                initialQty: 0,
            },
            {
                name: "Prescription Review",
                sku: "SVC-RX-REV",
                category: "Services",
                description: "Prescription validation service (DRC)",
                unitPrice: "3000.00",
                minStock: 0,
                taxCategory: client_1.TaxCategory.EXEMPT,
                taxCode: client_1.RraTaxCode.A,
                measurementUnit: client_1.MeasurementUnit.PCS,
                barcode: "8901000000023",
                itemClsCd: "5059690800",
                itemType: client_1.ItemType.SERVICE,
                origin: "CD",
                supplierId: null,
                initialQty: 0,
            },
        ];
        const created = [];
        for (const def of defs) {
            const pkgUnitCd = "NT";
            const qtyUnitCd = (0, item_code_service_1.deriveQtyUnitCd)(def.measurementUnit);
            const itemCd = await (0, item_code_service_1.allocateItemCd)(org.id, def.itemType, pkgUnitCd, qtyUnitCd, def.origin, tx);
            const product = await tx.product.create({
                data: {
                    organizationId: org.id,
                    supplierId: def.supplierId,
                    name: def.name,
                    sku: def.sku,
                    category: def.category,
                    description: def.description,
                    quantity: def.initialQty,
                    unitPrice: new client_1.Prisma.Decimal(def.unitPrice),
                    minStock: def.minStock,
                    taxCategory: def.taxCategory,
                    taxCode: def.taxCode,
                    measurementUnit: def.measurementUnit,
                    barcode: def.barcode,
                    itemType: def.itemType,
                    origin: def.origin,
                    pkgUnitCd,
                    qtyUnitCd,
                    itemClsCd: def.itemClsCd || item_code_service_1.DEFAULT_ITEM_CLASSIFICATION_CD,
                    itemCd,
                    ebmSyncStatus: "PENDING",
                },
            });
            created.push(product);
        }
        return created;
    });
    const finished = products.filter((p) => p.itemType === client_1.ItemType.PRODUCT);
    const rawMaterials = products.filter((p) => p.itemType === client_1.ItemType.RAW_MATERIAL);
    const services = products.filter((p) => p.itemType === client_1.ItemType.SERVICE);
    const [p1, p2, p3, p4, p5, p6] = finished;
    const [rm1, rm2] = rawMaterials;
    console.log(`Seeded ${products.length} items: ${finished.length} finished / ${rawMaterials.length} raw / ${services.length} service (mixed origins)`);
    // Stock batches only for finished + raw materials (services have no inventory).
    const stockable = [...finished, ...rawMaterials];
    for (const p of stockable) {
        const isVitC = p.sku === "VIT-C-1K";
        await (0, batch_service_1.createBatch)({
            productId: p.id,
            organizationId: org.id,
            branchId: mainBranch.id,
            userId: adminUser.id,
            batchNumber: isVitC ? "B-VIT-C-MAIN-1" : `B-${p.sku}-MAIN-1`,
            quantity: isVitC ? 80 : 200,
            unitCost: isVitC ? 1200 : Number(p.unitPrice) * 0.55,
            expiryDate: new Date(Date.now() + (isVitC ? 180 : 365) * 24 * 60 * 60 * 1000),
        });
    }
    for (const p of stockable) {
        await (0, batch_service_1.createBatch)({
            productId: p.id,
            organizationId: org.id,
            branchId: eastBranch.id,
            userId: adminUser.id,
            batchNumber: `B-${p.sku}-EAST-1`,
            quantity: p.itemType === client_1.ItemType.RAW_MATERIAL ? 30 : 50,
            unitCost: Number(p.unitPrice) * 0.5,
            expiryDate: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000),
        });
    }
    // BOM: 1× Paracetamol finished uses API powder + blister packs (RRA composition).
    if (p1 && rm1 && rm2) {
        await prisma.bomComponent.createMany({
            data: [
                {
                    organizationId: org.id,
                    parentProductId: p1.id,
                    componentProductId: rm1.id,
                    quantity: new client_1.Prisma.Decimal("0.010"),
                    unit: "KG",
                },
                {
                    organizationId: org.id,
                    parentProductId: p1.id,
                    componentProductId: rm2.id,
                    quantity: new client_1.Prisma.Decimal("1"),
                    unit: "PCS",
                },
            ],
        });
        console.log(`Seeded BOM for ${p1.name}: ${rm1.name} + ${rm2.name}`);
    }
    const walkIn = await prisma.customer.create({
        data: {
            organizationId: org.id,
            name: "Walk-in Customer",
            phone: "+250788333001",
            customerType: client_1.CustomerType.INDIVIDUAL,
            balance: new client_1.Prisma.Decimal("0"),
        },
    });
    const creditCustomer = await prisma.customer.create({
        data: {
            organizationId: org.id,
            name: "Credit Wholesale Ltd",
            phone: "+250788333002",
            email: "accounts@creditwholesale.test",
            customerType: client_1.CustomerType.CORPORATE,
            // Valid RRA VSDC test TIN (1-prefix; v3.0.2 sandbox rejects 7-prefix with
            // 910). The RRA purchase code below is required for this B2B buyer.
            TIN: "100000000",
            prcOrdCd: "010301",
            balance: new client_1.Prisma.Decimal("0"),
        },
    });
    const insuranceCustomer = await prisma.customer.create({
        data: {
            organizationId: org.id,
            name: "RSSB Insurance",
            phone: "+250788333003",
            customerType: client_1.CustomerType.INSURANCE,
            // VSDC BhfInsuranceSaveReq sample (§3.3.3.3)
            isrccCd: "ISRCC01",
            isrcRt: new client_1.Prisma.Decimal("20"),
            TIN: "100000001",
            balance: new client_1.Prisma.Decimal("0"),
        },
    });
    // Org-level RRA purchase-code pools (buyer-scoped checksum). Seed enough for
    // walk-in B2C (placeholder TIN) + the B2B corporate buyer + insurer.
    const walkInBuyerTin = (0, rra_ebm_service_1.walkInCustTin)(walkIn.id);
    const sellerTin = org.TIN.trim();
    const purchasePools = [
        { buyerTin: "100000000", count: 30 },
        { buyerTin: walkInBuyerTin, count: 40 },
        { buyerTin: "100000001", count: 10 },
    ];
    // Codes are unique per org (not per buyer), so share the exclusion set
    // across pools to avoid P2002 collisions.
    const usedCodes = new Set();
    for (const pool of purchasePools) {
        const codes = (0, purchase_code_checksum_1.generateValidPurchaseCodes)(pool.buyerTin, sellerTin, pool.count, usedCodes);
        for (const code of codes) {
            await prisma.organizationPurchaseCode.create({
                data: { organizationId: org.id, code, buyerTin: pool.buyerTin },
            });
            usedCodes.add(code);
        }
        console.log(`Seeded ${codes.length} purchase codes for buyer TIN ${pool.buyerTin}`);
    }
    const ctx = {
        orgId: org.id,
        mainBranchId: mainBranch.id,
        eastBranchId: eastBranch.id,
        adminId: adminUser.id,
        sellerId: sellerUser.id,
    };
    const cashSale = await createSaleInTransaction(ctx, {
        saleNumber: `SEED-SALE-CASH-${Date.now()}`,
        customerId: walkIn.id,
        userId: sellerUser.id,
        branchId: mainBranch.id,
        paymentType: client_1.SalePaymentType.CASH,
        cashAmount: 150 * 4 + 800 * 2,
        insuranceAmount: 0,
        debtAmount: 0,
        items: [
            { productId: p1.id, quantity: 4, unitPrice: 150 },
            { productId: p2.id, quantity: 2, unitPrice: 800 },
        ],
    });
    const debtSale = await createSaleInTransaction(ctx, {
        saleNumber: `SEED-SALE-DEBT-${Date.now()}`,
        customerId: creditCustomer.id,
        userId: sellerUser.id,
        branchId: mainBranch.id,
        paymentType: client_1.SalePaymentType.MIXED,
        cashAmount: 5000,
        insuranceAmount: 0,
        debtAmount: 19000,
        items: [{ productId: p4.id, quantity: 10, unitPrice: 2400 }],
    });
    await prisma.debtPayment.create({
        data: {
            saleId: debtSale.id,
            customerId: creditCustomer.id,
            organizationId: org.id,
            recordedById: accountantUser.id,
            amount: new client_1.Prisma.Decimal("5000.00"),
            paymentMethod: "MOBILE_MONEY",
            reference: "SEED-DEBT-PAY-1",
            notes: "Partial payment on seeded credit sale",
        },
    });
    await prisma.customer.update({
        where: { id: creditCustomer.id },
        data: { balance: { decrement: new client_1.Prisma.Decimal("5000.00") } },
    });
    const insuranceTotal = 3500 * 3;
    await createSaleInTransaction(ctx, {
        saleNumber: `SEED-SALE-INS-${Date.now()}`,
        customerId: insuranceCustomer.id,
        userId: sellerUser.id,
        branchId: mainBranch.id,
        paymentType: client_1.SalePaymentType.INSURANCE,
        cashAmount: 0,
        insuranceAmount: insuranceTotal,
        debtAmount: 0,
        items: [{ productId: p3.id, quantity: 3, unitPrice: 3500 }],
    });
    await createSaleInTransaction(ctx, {
        saleNumber: `SEED-SALE-PRO-${Date.now()}`,
        customerId: walkIn.id,
        userId: sellerUser.id,
        branchId: mainBranch.id,
        paymentType: client_1.SalePaymentType.CASH,
        cashAmount: 12000,
        insuranceAmount: 0,
        debtAmount: 0,
        items: [{ productId: p6.id, quantity: 1, unitPrice: 12000 }],
        isProforma: true,
    });
    await prisma.ebmTransaction.create({
        data: {
            organizationId: org.id,
            saleId: cashSale.id,
            invoiceNumber: cashSale.invoiceNumber,
            operation: "SALE",
            submissionStatus: client_1.EbmSubmissionStatus.SUCCESS,
            submittedAt: new Date(),
            ebmInvoiceNumber: "EBM-SEED-001",
            responseData: { note: "Seeded EBM success row for reporting" },
        },
    });
    const pendingPo = await prisma.purchaseOrder.create({
        data: {
            orderNumber: `PO-SEED-PENDING-${Date.now()}`,
            branchId: mainBranch.id,
            supplierId: supplierA.id,
            organizationId: org.id,
            userId: adminUser.id,
            totalAmount: new client_1.Prisma.Decimal("45000.00"),
            status: "PENDING",
            notes: "Awaiting supplier confirmation",
            items: {
                create: [
                    {
                        productId: p2.id,
                        productName: p2.name,
                        quantity: 50,
                        unitPrice: new client_1.Prisma.Decimal("800.00"),
                        totalPrice: new client_1.Prisma.Decimal("40000.00"),
                    },
                    {
                        productName: "Custom order item (no product link)",
                        quantity: 10,
                        unitPrice: new client_1.Prisma.Decimal("500.00"),
                        totalPrice: new client_1.Prisma.Decimal("5000.00"),
                    },
                ],
            },
        },
    });
    const completedPo = await prisma.purchaseOrder.create({
        data: {
            orderNumber: `PO-SEED-RECV-${Date.now()}`,
            branchId: mainBranch.id,
            supplierId: supplierB.id,
            organizationId: org.id,
            userId: adminUser.id,
            totalAmount: new client_1.Prisma.Decimal("24000.00"),
            status: "COMPLETED",
            receivedAt: new Date(),
            notes: "Received into main branch stock",
            items: {
                create: [
                    {
                        productId: p1.id,
                        productName: p1.name,
                        quantity: 100,
                        unitPrice: new client_1.Prisma.Decimal("120.00"),
                        totalPrice: new client_1.Prisma.Decimal("12000.00"),
                    },
                    {
                        productId: p5.id,
                        productName: p5.name,
                        quantity: 20,
                        unitPrice: new client_1.Prisma.Decimal("600.00"),
                        totalPrice: new client_1.Prisma.Decimal("12000.00"),
                    },
                ],
            },
        },
        include: { items: true },
    });
    for (const item of completedPo.items) {
        if (item.productId) {
            await (0, inventory_ledger_service_1.addStock)({
                organizationId: org.id,
                productId: item.productId,
                userId: adminUser.id,
                quantity: item.quantity,
                movementType: "PURCHASE",
                branchId: mainBranch.id,
                unitCost: Number(item.unitPrice),
                reference: completedPo.orderNumber,
                referenceType: "PURCHASE_ORDER",
                note: `PO received (seed): ${completedPo.orderNumber}`,
            });
        }
    }
    await prisma.supplierPayment.create({
        data: {
            purchaseOrderId: completedPo.id,
            organizationId: org.id,
            amount: new client_1.Prisma.Decimal("24000.00"),
            paymentMethod: "BANK_TRANSFER",
            paymentDate: new Date(),
            reference: "SEED-PO-PAY-1",
            recordedById: accountantUser.id,
            notes: "Full payment for completed seed PO",
        },
    });
    await prisma.expense.create({
        data: {
            organizationId: org.id,
            userId: accountantUser.id,
            branchId: mainBranch.id,
            category: "RENT",
            amount: new client_1.Prisma.Decimal("350000.00"),
            paymentMethod: "BANK_TRANSFER",
            description: "Monthly rent — main store",
            expenseDate: new Date(),
            reference: "RENT-SEED-1",
        },
    });
    await prisma.expense.create({
        data: {
            organizationId: org.id,
            userId: managerUser.id,
            branchId: eastBranch.id,
            category: "UTILITIES",
            amount: new client_1.Prisma.Decimal("45000.00"),
            paymentMethod: "MOBILE_MONEY",
            description: "Electricity — east branch",
            expenseDate: new Date(),
        },
    });
    await prisma.cashBalance.create({
        data: {
            organizationId: org.id,
            branchId: mainBranch.id,
            balance: new client_1.Prisma.Decimal("125000.50"),
            balanceDate: new Date(),
            recordedById: sellerUser.id,
            notes: "Opening cash count (seed)",
        },
    });
    await prisma.stockTransfer.create({
        data: {
            organizationId: org.id,
            fromBranchId: mainBranch.id,
            toBranchId: eastBranch.id,
            status: client_1.StockTransferStatus.PENDING,
            requestedById: managerUser.id,
            notes: "Awaiting approval — seed transfer",
            items: {
                create: [{ productId: p1.id, quantity: 25 }],
            },
        },
    });
    const transferCompleted = await prisma.stockTransfer.create({
        data: {
            organizationId: org.id,
            fromBranchId: eastBranch.id,
            toBranchId: mainBranch.id,
            status: client_1.StockTransferStatus.COMPLETED,
            requestedById: adminUser.id,
            approvedById: adminUser.id,
            completedAt: new Date(),
            notes: "Completed seed transfer (ledger adjusted below)",
            items: {
                create: [{ productId: p2.id, quantity: 5 }],
            },
        },
    });
    await (0, inventory_ledger_service_1.removeStock)({
        organizationId: org.id,
        productId: p2.id,
        userId: adminUser.id,
        quantity: 5,
        movementType: "TRANSFER_OUT",
        branchId: eastBranch.id,
        reference: `ST-${transferCompleted.id}`,
        referenceType: "STOCK_TRANSFER",
        note: "Seed stock transfer out",
    });
    await (0, inventory_ledger_service_1.addStock)({
        organizationId: org.id,
        productId: p2.id,
        userId: adminUser.id,
        quantity: 5,
        movementType: "TRANSFER_IN",
        branchId: mainBranch.id,
        reference: `ST-${transferCompleted.id}`,
        referenceType: "STOCK_TRANSFER",
        note: "Seed stock transfer in",
    });
    await prisma.stockMovement.create({
        data: {
            organizationId: org.id,
            productId: p1.id,
            userId: adminUser.id,
            branchId: mainBranch.id,
            type: client_1.StockMovementType.ADJUSTMENT,
            quantity: 2,
            previousStock: 100,
            newStock: 102,
            note: "Seed adjustment (legacy movement row)",
        },
    });
    await prisma.notification.create({
        data: {
            organizationId: org.id,
            title: "Low stock reminder",
            message: "Review min stock levels for demo products.",
            type: "ALERT",
            isRead: false,
        },
    });
    await prisma.activityLog.create({
        data: {
            organizationId: org.id,
            userId: adminUser.id,
            branchId: mainBranch.id,
            type: client_1.ActivityType.USER_LOGIN,
            description: "Demo admin login (seeded activity)",
            module: client_1.LogModule.SYSTEM,
            status: client_1.LogStatus.SUCCESS,
            entityType: "User",
            entityId: String(adminUser.id),
        },
    });
    const inviteToken = crypto_1.default.randomBytes(24).toString("hex");
    await prisma.organizationInvitation.create({
        data: {
            organizationId: org.id,
            email: "pending.invite@exceledge.test",
            role: client_1.UserRole.SELLER,
            token: inviteToken,
            defaultPassword: "InviteTemp#1",
            status: client_1.InvitationStatus.PENDING,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            invitedBy: adminUser.id,
        },
    });
    console.log("");
    console.log("--- Demo dataset (development) ---");
    console.log(`Organization: ${org.name} (id=${org.id})`);
    console.log(`Branches: ${mainBranch.code} (id=${mainBranch.id}), ${eastBranch.code} (id=${eastBranch.id})`);
    console.log(`Password for all demo users: ${exports.DEMO_PASSWORD}`);
    console.log(`  ${DEMO_ADMIN_EMAIL} (ADMIN)`);
    console.log(`  demo.manager@exceledge.test (BRANCH_MANAGER)`);
    console.log(`  demo.seller@exceledge.test (SELLER)`);
    console.log(`  demo.eastseller@exceledge.test (SELLER, East Branch)`);
    console.log(`  demo.accountant@exceledge.test (ACCOUNTANT)`);
    console.log(`Sample sales: cash, mixed/debt + partial debt payment, insurance, proforma`);
    console.log(`Purchase orders: pending #${pendingPo.id}, completed #${completedPo.id} + supplier payment`);
    console.log(`Stock: batches on MAIN + EAST; completed stock transfer id=${transferCompleted.id}`);
    console.log("-----------------------------------");
    console.log("");
}
async function main() {
    console.log("Starting database seeding...");
    await seedSuperAdmin();
    await seedSubscriptionPlans();
    await seedDemoDataset();
    console.log("✅ Database seeding completed successfully");
}
main()
    .catch((e) => {
    console.error("❌ Error during database seeding:", e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
