"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rraOpenApiSpec = void 0;
/**
 * OpenAPI 3.0 specification for Excledge RRA / EBM / VSDC endpoints.
 * Served at GET /api/docs (Swagger UI) and GET /api/docs/openapi.json
 *
 * Scope: only endpoints that connect to RRA fiscalization, master data,
 * stock sync, purchases/imports, fiscal sales lifecycle, and CIS reports.
 */
exports.rraOpenApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Excledge RRA / EBM API',
        version: '1.0.0',
        description: `
# Excledge RRA Electronic Billing Machine API

Authenticated HTTP API that wraps Rwanda Revenue Authority (RRA) VSDC/EBM flows
for fiscal sales, master data, stock, B2B purchases, imports, and CIS reports.

## Authentication

All endpoints (except \`GET /api/version\`) require:

\`\`\`
Authorization: Bearer <JWT>
\`\`\`

Obtain a token via \`POST /api/auth/login\`. An active organization subscription is required.

## Response envelope

Most JSON endpoints return:

\`\`\`json
{ "success": true, "data": { ... }, "message": "optional" }
\`\`\`

Errors:

\`\`\`json
{ "success": false, "error": "message", "code": "OPTIONAL_CODE" }
\`\`\`

## VSDC mapping

Each operation notes the underlying VSDC path / RRA checklist section where applicable.
See also \`docs/ebm-vsdc/INTEGRATION.md\` and \`docs/ebm-vsdc/CERTIFICATION-CHECKLIST.md\`.
`.trim(),
        contact: { name: 'Excledge', url: 'https://erp.exceledgecpa.com' },
    },
    servers: [
        { url: 'http://localhost:4500', description: 'Local development' },
        { url: 'https://erp.exceledgecpa.com', description: 'Production' },
    ],
    tags: [
        { name: 'Auth', description: 'JWT login (required before calling RRA endpoints)' },
        { name: 'EBM Device & Outbox', description: 'Device init, outbox status, Z-report' },
        { name: 'RRA Master Data', description: 'Codes §59, item classes §61, notices §65, customer TIN §62, items §64' },
        { name: 'RRA Stock & Trade', description: 'Stock In/Out, B2B purchases §70/§71, imports §66–§68' },
        { name: 'RRA Lookups', description: 'Refund reasons (class 32) and payment mappings (class 07)' },
        { name: 'RRA Entity Push', description: 'Push branches, customers, users, BOM composition to VSDC' },
        { name: 'Fiscal Sales', description: 'Create / convert / refund / void sales and poll EBM receipt data' },
        { name: 'Fiscal Reports', description: 'X/Z daily, PLU, electronic journal, purchases report' },
        { name: 'Org EBM Config', description: 'Organization EBM settings and fiscal identity' },
        { name: 'Sync Triggers', description: 'Domain APIs that enqueue RRA item/stock/customer sync' },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
        },
        schemas: {
            SuccessEnvelope: {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: {},
                    message: { type: 'string' },
                },
            },
            ErrorEnvelope: {
                type: 'object',
                required: ['success', 'error'],
                properties: {
                    success: { type: 'boolean', enum: [false] },
                    error: { type: 'string' },
                    code: { type: 'string' },
                    details: {},
                },
            },
            OrganizationId: {
                type: 'integer',
                minimum: 1,
                example: 1,
                description: 'Organization ID',
            },
            BranchIdBody: {
                type: 'object',
                properties: {
                    branchId: { type: 'integer', minimum: 1, example: 1 },
                },
            },
            SaleItem: {
                type: 'object',
                required: ['quantity', 'unitPrice'],
                properties: {
                    productId: { type: 'integer', minimum: 1 },
                    quantity: { type: 'number', exclusiveMinimum: 0, example: 1 },
                    unitPrice: { type: 'number', minimum: 0, example: 1000 },
                    discount: { type: 'number', minimum: 0, example: 0 },
                    itemType: { type: 'string', enum: ['PRODUCT', 'RAW_MATERIAL', 'SERVICE'] },
                    serviceName: { type: 'string' },
                    serviceDescription: { type: 'string' },
                },
            },
            SalePayment: {
                type: 'object',
                required: ['paymentMethod', 'amount'],
                properties: {
                    paymentMethod: {
                        type: 'string',
                        enum: ['CASH', 'BANK', 'CARD', 'PAYPACK', 'MTN_MOMO', 'AIRTEL_MONEY', 'WALLET', 'GIFT_CARD', 'STORE_CREDIT'],
                    },
                    amount: { type: 'number', exclusiveMinimum: 0 },
                    reference: { type: 'string' },
                    metadata: { type: 'object', additionalProperties: true },
                },
            },
            CreateSaleRequest: {
                type: 'object',
                required: ['customerId', 'items'],
                properties: {
                    customerId: { type: 'integer', minimum: 1, example: 2 },
                    items: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/SaleItem' } },
                    paymentType: {
                        type: 'string',
                        enum: ['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD'],
                    },
                    cashAmount: { type: 'number', minimum: 0, example: 1000 },
                    debtAmount: { type: 'number', minimum: 0, example: 0 },
                    insuranceAmount: { type: 'number', minimum: 0, example: 0 },
                    notes: { type: 'string' },
                    shiftId: { type: 'integer', minimum: 1 },
                    branchId: { type: 'integer', minimum: 1 },
                    payments: { type: 'array', items: { $ref: '#/components/schemas/SalePayment' } },
                    isProforma: {
                        type: 'boolean',
                        description: 'If true, creates a quote without stock consumption or EBM fiscalization',
                        example: false,
                    },
                },
            },
            FiscalizationStatus: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['success', 'pending', 'failed'] },
                    sdcRcptNo: { type: 'string', nullable: true },
                    isCertified: { type: 'boolean' },
                },
            },
            EbmReceipt: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['success', 'pending'] },
                    message: { type: 'string' },
                    ebm: {
                        type: 'object',
                        properties: {
                            sdcId: { type: 'string' },
                            mrcNo: { type: 'string' },
                            sdcRcptNo: { type: 'string' },
                            internalData: { type: 'string' },
                            receiptSignature: { type: 'string' },
                            qrPayload: { type: 'string' },
                            sdcDateTime: { type: 'string' },
                            rcptLabel: { type: 'string' },
                            ebmInvoiceNumber: { type: 'string' },
                        },
                    },
                },
            },
            EbmStatus: {
                type: 'object',
                properties: {
                    enabled: { type: 'boolean' },
                    online: { type: 'boolean' },
                    lastContact: { type: 'string', format: 'date-time', nullable: true },
                    offlineLimitMs: { type: 'integer' },
                },
            },
            ProductCreateRequest: {
                type: 'object',
                required: ['name', 'unitPrice'],
                properties: {
                    name: { type: 'string', example: 'Paracetamol 500mg' },
                    sku: { type: 'string' },
                    quantity: { type: 'number', example: 10 },
                    unitPrice: { type: 'number', example: 1000 },
                    purchasePrice: { type: 'number', example: 500 },
                    category: { type: 'string' },
                    taxCategory: { type: 'string', enum: ['STANDARD', 'ZERO_RATED', 'EXEMPT'] },
                    taxCode: { type: 'string', enum: ['A', 'B', 'C', 'D'], example: 'A' },
                    measurementUnit: { type: 'string', example: 'PCS' },
                    itemType: { type: 'string', enum: ['PRODUCT', 'RAW_MATERIAL', 'SERVICE'], example: 'PRODUCT' },
                    itemClsCd: {
                        type: 'string',
                        description: 'Required for PRODUCT and RAW_MATERIAL — RRA item class code from /rra/item-classes',
                        example: 'REPLACE_WITH_VALID_RRA_CLASS',
                    },
                    pkgUnitCd: { type: 'string', example: 'CT' },
                    qtyUnitCd: { type: 'string', example: 'U' },
                    packagingQty: { type: 'number', example: 1 },
                    itemStandardName: { type: 'string' },
                    origin: { type: 'string', description: 'RRA country code', example: 'RW' },
                    additionalInfo: { type: 'string' },
                    bomComponents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['componentProductId', 'quantity', 'unit'],
                            properties: {
                                componentProductId: { type: 'integer' },
                                quantity: { type: 'number', example: 0.5 },
                                unit: { type: 'string', example: 'KG' },
                            },
                        },
                    },
                },
            },
            CustomerCreateRequest: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string', example: 'API test customer' },
                    phone: { type: 'string', example: '+250788000000' },
                    email: { type: 'string', format: 'email' },
                    address: { type: 'string' },
                    custPrvncNm: { type: 'string' },
                    custDstrtNm: { type: 'string' },
                    custSctrNm: { type: 'string' },
                    custLocDesc: { type: 'string' },
                    type: { type: 'string', enum: ['INDIVIDUAL', 'CORPORATE'] },
                    TIN: { type: 'string', pattern: '^\\d{9}$', description: '9-digit TIN; triggers RRA customer sync when set' },
                    prcOrdCd: { type: 'string', description: 'B2B purchase order code' },
                    balance: { type: 'number', example: 0 },
                },
            },
            EbmConfig: {
                type: 'object',
                properties: {
                    tin: { type: 'string', example: '999945560' },
                    bhfId: { type: 'string', example: '00' },
                    dvcSrlNo: { type: 'string', example: 'excelwartest' },
                    ebmDeviceId: { type: 'string' },
                },
            },
        },
        parameters: {
            organizationId: {
                name: 'organizationId',
                in: 'path',
                required: true,
                schema: { $ref: '#/components/schemas/OrganizationId' },
            },
            branchIdQuery: {
                name: 'branchId',
                in: 'query',
                required: false,
                schema: { type: 'integer', minimum: 1 },
            },
        },
        responses: {
            Unauthorized: {
                description: 'Missing or invalid JWT',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
            },
            BadRequest: {
                description: 'Validation or business-rule error',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
            },
            Forbidden: {
                description: 'Insufficient role or inactive subscription',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
            },
        },
    },
    security: [{ bearerAuth: [] }],
    paths: {
        '/api/auth/login': {
            post: {
                tags: ['Auth'],
                summary: 'Login and obtain JWT',
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['email', 'password'],
                                properties: {
                                    email: { type: 'string', format: 'email', example: 'enockiradukunda4@gmail.com' },
                                    password: { type: 'string', format: 'password', example: 'Kigali@123' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'JWT issued',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        token: { type: 'string' },
                                        accessToken: { type: 'string' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                organizationId: { type: 'integer' },
                                                activeOrganizationId: { type: 'integer' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/version': {
            get: {
                tags: ['EBM Device & Outbox'],
                summary: 'CIS software version label (printed on receipts)',
                description: 'RRA CIS/VSDC §21 — public branding endpoint.',
                security: [],
                responses: {
                    '200': {
                        description: 'Version payload',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        version: { type: 'string' },
                                        label: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        // ── EBM Device & Outbox ──────────────────────────────────────────────
        '/api/organizations/{organizationId}/ebm-status': {
            get: {
                tags: ['EBM Device & Outbox'],
                summary: 'EBM enablement and VSDC online status',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: {
                    '200': {
                        description: 'Status',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        { type: 'object', properties: { data: { $ref: '#/components/schemas/EbmStatus' } } },
                                    ],
                                },
                            },
                        },
                    },
                    '401': { $ref: '#/components/responses/Unauthorized' },
                },
            },
        },
        '/api/organizations/{organizationId}/ebm-outbox': {
            get: {
                tags: ['EBM Device & Outbox'],
                summary: 'List EBM outbox entries',
                description: 'Local transactional outbox for `/trnsSales/saveSales` (max 200).',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'query', schema: { type: 'integer' } },
                ],
                responses: {
                    '200': { description: 'Outbox rows', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                },
            },
        },
        '/api/organizations/{organizationId}/ebm-outbox/{id}/check-status': {
            post: {
                tags: ['EBM Device & Outbox'],
                summary: 'Reconcile a single outbox entry',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['idempotencyKey'],
                                properties: { idempotencyKey: { type: 'string', example: 'CHECK-001' } },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Resolved or still pending' } },
            },
        },
        '/api/organizations/{organizationId}/ebm/initialize': {
            post: {
                tags: ['EBM Device & Outbox'],
                summary: 'Initialize VSDC device',
                description: 'Calls VSDC `POST /initializer/selectInitInfo` (checklist §58).',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Device / taxpayer / counter seed data' } },
            },
        },
        '/api/organizations/{organizationId}/z-report': {
            post: {
                tags: ['EBM Device & Outbox'],
                summary: 'Submit daily Z-report',
                description: 'VSDC `POST /reports/saveZReports` (+ verify).',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Z-report submit result' } },
            },
            get: {
                tags: ['EBM Device & Outbox'],
                summary: 'Check Z-report status',
                description: 'VSDC `POST /reports/checkZReport`.',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                    {
                        name: 'date',
                        in: 'query',
                        schema: { type: 'string', example: '20260915', description: 'yyyyMMdd or yyyyMMddHHmmss' },
                    },
                ],
                responses: { '200': { description: 'Z-report check response' } },
            },
        },
        // ── Master data ──────────────────────────────────────────────────────
        '/api/organizations/{organizationId}/rra/status': {
            get: {
                tags: ['RRA Master Data'],
                summary: 'Master-data sync cursors and counts',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: { '200': { description: 'Cursors + counts for codes, item classes, notices' } },
            },
        },
        '/api/organizations/{organizationId}/rra/sync-all': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Sync codes, item classes, and notices',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Per-resource sync outcomes' } },
            },
        },
        '/api/organizations/{organizationId}/rra/codes': {
            get: {
                tags: ['RRA Master Data'],
                summary: 'List cached RRA codes (§59)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'cdCls', in: 'query', schema: { type: 'string', example: '07' }, description: 'Code class filter' },
                ],
                responses: { '200': { description: 'Codes grouped by class' } },
            },
        },
        '/api/organizations/{organizationId}/rra/codes/sync': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Pull codes from VSDC `/code/selectCodes` (§59)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/item-classes': {
            get: {
                tags: ['RRA Master Data'],
                summary: 'Search cached item classes (§61)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'q', in: 'query', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
                ],
                responses: { '200': { description: 'Matching item classes' } },
            },
        },
        '/api/organizations/{organizationId}/rra/item-classes/sync': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Pull item classes from VSDC (§61)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/notices': {
            get: {
                tags: ['RRA Master Data'],
                summary: 'List cached RRA notices (§65)',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: { '200': { description: 'Notices + unread count' } },
            },
        },
        '/api/organizations/{organizationId}/rra/notices/sync': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Pull notices from VSDC (§65)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/notices/{noticeNo}/read': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Mark a notice as read',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'noticeNo', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                responses: { '200': { description: 'Updated count' } },
            },
        },
        '/api/organizations/{organizationId}/rra/customers/{tin}': {
            get: {
                tags: ['RRA Master Data'],
                summary: 'Verify customer TIN via VSDC (§62)',
                description: 'Calls `/customers/selectCustomer`.',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'tin', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{9}$', example: '999945560' } },
                    { name: 'customerId', in: 'query', schema: { type: 'integer' } },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                responses: { '200': { description: 'Taxpayer verification result' } },
            },
        },
        '/api/organizations/{organizationId}/rra/items/reconcile': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Reconcile local items vs VSDC `/items/selectItems` (§64)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Diff: rraOnly / localOnly / mismatched' } },
            },
        },
        '/api/organizations/{organizationId}/rra/items/{productId}/sync': {
            post: {
                tags: ['RRA Master Data'],
                summary: 'Push one product to VSDC `/items/saveItems`',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'productId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    itemClsCd: { type: 'string' },
                                    taxCode: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Sync result for product' } },
            },
        },
        // ── Stock & trade ────────────────────────────────────────────────────
        '/api/organizations/{organizationId}/rra/stock': {
            get: {
                tags: ['RRA Stock & Trade'],
                summary: 'Stock sync queue status (§23 / §72 / §73)',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: { '200': { description: 'Counts by PENDING/SYNCED/FAILED + recent failures' } },
            },
        },
        '/api/organizations/{organizationId}/rra/stock/sync': {
            post: {
                tags: ['RRA Stock & Trade'],
                summary: 'Process pending stock sync batch',
                description: 'Pushes `/stock/saveStockItems` + `/stockMaster/saveStockMaster`.',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: { '200': { description: 'Batch process result' } },
            },
        },
        '/api/organizations/{organizationId}/rra/purchases': {
            get: {
                tags: ['RRA Stock & Trade'],
                summary: 'List cached B2B purchases (§70)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'status', in: 'query', schema: { type: 'string' } },
                ],
                responses: { '200': { description: 'Purchases + pending count' } },
            },
        },
        '/api/organizations/{organizationId}/rra/purchases/sync': {
            post: {
                tags: ['RRA Stock & Trade'],
                summary: 'Pull B2B purchases from VSDC (§70)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/purchases/{id}/confirm': {
            post: {
                tags: ['RRA Stock & Trade'],
                summary: 'Confirm or reject a B2B purchase (§71)',
                description: 'Calls `/trnsPurchase/savePurchases`.',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'RraPurchase id' },
                    { name: 'reject', in: 'query', schema: { type: 'boolean' } },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    reject: { type: 'boolean' },
                                    prcOrdCd: { type: 'string' },
                                    branchId: { type: 'integer' },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Confirm/reject result' } },
            },
        },
        '/api/organizations/{organizationId}/rra/imports': {
            get: {
                tags: ['RRA Stock & Trade'],
                summary: 'List cached import declarations (§66)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'status', in: 'query', schema: { type: 'string' } },
                ],
                responses: { '200': { description: 'Imports + pending + lastRequestDate' } },
            },
        },
        '/api/organizations/{organizationId}/rra/imports/sync': {
            post: {
                tags: ['RRA Stock & Trade'],
                summary: 'Pull import items from VSDC (§66)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                    { name: 'requestDate', in: 'query', schema: { type: 'string', example: '20260915' } },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    branchId: { type: 'integer' },
                                    requestDate: { type: 'string', example: '20260915' },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/imports/{id}/{action}': {
            post: {
                tags: ['RRA Stock & Trade'],
                summary: 'Approve or reject an import (§67 / §68)',
                description: '`action` is `approve` or `reject` (other values treated as approve).',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
                    { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['approve', 'reject'] } },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    itemClsCd: { type: 'string' },
                                    itemCd: { type: 'string' },
                                    linkProductId: { type: 'integer' },
                                    remark: { type: 'string' },
                                    branchId: { type: 'integer' },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Import action result' } },
            },
        },
        // ── Lookups ──────────────────────────────────────────────────────────
        '/api/organizations/{organizationId}/rra/refund-reasons': {
            get: {
                tags: ['RRA Lookups'],
                summary: 'Refund reason codes (class 32)',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: {
                    '200': {
                        description: 'Reasons list; default code is `06`',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                reasons: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            code: { type: 'string' },
                                                            name: { type: 'string' },
                                                            description: { type: 'string' },
                                                        },
                                                    },
                                                },
                                                default: { type: 'string', example: '06' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/organizations/{organizationId}/rra/payment-mappings': {
            get: {
                tags: ['RRA Lookups'],
                summary: 'ERP payment method → RRA code mappings (class 07)',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                responses: { '200': { description: 'Payment mappings' } },
            },
        },
        // ── Entity push ──────────────────────────────────────────────────────
        '/api/organizations/{organizationId}/rra/branches/sync': {
            post: {
                tags: ['RRA Entity Push'],
                summary: 'Sync branches from VSDC (§3.3.2)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Branch sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/stock-moves/sync': {
            post: {
                tags: ['RRA Entity Push'],
                summary: 'Pull stock moves from VSDC (§3.3.8.1)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Stock-move sync outcome' } },
            },
        },
        '/api/organizations/{organizationId}/rra/customers/{customerId}/sync': {
            post: {
                tags: ['RRA Entity Push'],
                summary: 'Push customer to VSDC (§3.3.3)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'customerId', in: 'path', required: true, schema: { type: 'integer' } },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Customer push result' } },
            },
        },
        '/api/organizations/{organizationId}/rra/users/{userId}/sync': {
            post: {
                tags: ['RRA Entity Push'],
                summary: 'Push user to VSDC (§3.3.3)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'userId', in: 'path', required: true, schema: { type: 'integer' } },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'User push result' } },
            },
        },
        '/api/organizations/{organizationId}/rra/items/{productId}/composition/{componentId}/sync': {
            post: {
                tags: ['RRA Entity Push'],
                summary: 'Push BOM composition to VSDC (§3.3.4.2)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'productId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Finished product id' },
                    { name: 'componentId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Component product id' },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/BranchIdBody' } } },
                },
                responses: { '200': { description: 'Composition push result' } },
            },
        },
        // ── Fiscal sales ─────────────────────────────────────────────────────
        '/api/sales/{organizationId}': {
            post: {
                tags: ['Fiscal Sales'],
                summary: 'Create sale (fiscalizes via EBM outbox)',
                description: 'Blocked by `vsdcOnlineGuard` if VSDC has been unreachable beyond the offline limit. ' +
                    'Queues `/trnsSales/saveSales` (NS/TS). Proforma (`isProforma=true`) skips fiscalization. ' +
                    'Roles: ADMIN, SELLER, ACCOUNTANT, BRANCH_MANAGER.',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSaleRequest' } } },
                },
                responses: {
                    '201': {
                        description: 'Sale created with fiscalization status',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'integer' },
                                                fiscalization: { $ref: '#/components/schemas/FiscalizationStatus' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    '400': { $ref: '#/components/responses/BadRequest' },
                    '401': { $ref: '#/components/responses/Unauthorized' },
                    '403': { $ref: '#/components/responses/Forbidden' },
                },
            },
        },
        '/api/sales/{organizationId}/{saleId}/convert': {
            post: {
                tags: ['Fiscal Sales'],
                summary: 'Convert proforma → fiscal NS sale',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    customerId: { type: 'integer' },
                                    items: { type: 'array', items: { $ref: '#/components/schemas/SaleItem' } },
                                    paymentType: { type: 'string', enum: ['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD'] },
                                    cashAmount: { type: 'number' },
                                    debtAmount: { type: 'number' },
                                    insuranceAmount: { type: 'number' },
                                    shiftId: { type: 'integer' },
                                    payments: { type: 'array', items: { $ref: '#/components/schemas/SalePayment' } },
                                },
                            },
                        },
                    },
                },
                responses: { '201': { description: 'Converted fiscal sale' } },
            },
        },
        '/api/sales/{id}/refund/{organizationId}': {
            post: {
                tags: ['Fiscal Sales'],
                summary: 'Refund a sale (full refund; EBM salesSttsCd=05)',
                description: 'Uses `rfdRsnCd` from code class 32 (default `06`). Partial refunds are rejected.',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Original sale id' },
                    { $ref: '#/components/parameters/organizationId' },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    reason: { type: 'string', maxLength: 500 },
                                    rfdRsnCd: { type: 'string', pattern: '^\\d{2}$', example: '06' },
                                    items: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                saleItemId: { type: 'integer' },
                                                quantity: { type: 'number' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Refund sale + fiscalization status' } },
            },
        },
        '/api/sales/{organizationId}/{saleId}/cancel': {
            post: {
                tags: ['Fiscal Sales'],
                summary: 'Cancel / void a sale (EBM salesSttsCd=04)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['reason'],
                                properties: { reason: { type: 'string', minLength: 5, example: 'Customer cancelled order' } },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Sale cancelled' } },
            },
        },
        '/api/sales/{organizationId}/{saleId}/ebm-receipt': {
            get: {
                tags: ['Fiscal Sales'],
                summary: 'Poll EBM/SDC fiscal receipt fields (E3)',
                description: 'Returns 202 while outbox processing is still pending.',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                responses: {
                    '200': {
                        description: 'Fiscal data ready',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/EbmReceipt' } } },
                    },
                    '202': {
                        description: 'Still pending',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/EbmReceipt' } } },
                    },
                },
            },
        },
        '/api/sales/{organizationId}/invoices/{saleId}/pdf': {
            get: {
                tags: ['Fiscal Sales'],
                summary: 'Download fiscal invoice/receipt PDF',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                    {
                        name: 'format',
                        in: 'query',
                        schema: { type: 'string', enum: ['A4', 'A5', '80mm'], default: 'A4' },
                    },
                ],
                responses: {
                    '200': { description: 'PDF bytes', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
                },
            },
        },
        '/api/sales/{organizationId}/invoices/{saleId}': {
            get: {
                tags: ['Fiscal Sales'],
                summary: 'Composed invoice payload (HTML + metadata)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                    {
                        name: 'allowPending',
                        in: 'query',
                        schema: { type: 'string', enum: ['1'] },
                        description: 'Return invoice before VSDC success',
                    },
                ],
                responses: {
                    '200': { description: 'Invoice payload' },
                    '425': { description: 'Pending fiscalization (unless allowPending=1)' },
                },
            },
        },
        '/api/sales/{organizationId}/{saleId}/reprint': {
            post: {
                tags: ['Fiscal Sales'],
                summary: 'Reprint receipt (CIS copy watermark / reprintCount)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                responses: { '200': { description: 'Reprint payload with isCopy=true' } },
            },
        },
        // ── Fiscal reports ───────────────────────────────────────────────────
        '/api/reports/daily/{organizationId}': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'X/Z daily fiscal report (§6)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'type', in: 'query', required: true, schema: { type: 'string', enum: ['X', 'Z'] } },
                    { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                responses: { '200': { description: 'Daily report data' } },
            },
        },
        '/api/reports/daily/{organizationId}/pdf': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'X/Z daily report PDF (80mm)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'type', in: 'query', required: true, schema: { type: 'string', enum: ['X', 'Z'] } },
                    { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
                    { $ref: '#/components/parameters/branchIdQuery' },
                ],
                responses: {
                    '200': { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
                },
            },
        },
        '/api/reports/plu/{organizationId}': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'PLU (Price Look-Up) report (§21)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['quantity', 'revenue', 'itemCd'] } },
                    { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
                    { name: 'page', in: 'query', schema: { type: 'integer' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
                ],
                responses: { '200': { description: 'PLU summary + items' } },
            },
        },
        '/api/reports/plu/{organizationId}/pdf': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'PLU report PDF',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
                ],
                responses: {
                    '200': { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
                },
            },
        },
        '/api/reports/electronic-journal/{organizationId}': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'CIS electronic journal list (§5 / §44)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'page', in: 'query', schema: { type: 'integer' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
                ],
                responses: { '200': { description: 'Journal entries + pagination' } },
            },
        },
        '/api/reports/electronic-journal/{organizationId}/{saleId}': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'Single electronic journal entry',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'saleId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                responses: { '200': { description: 'Journal + slip checks' } },
            },
        },
        '/api/reports/purchases/{organizationId}': {
            get: {
                tags: ['Fiscal Reports'],
                summary: 'Detailed purchases report (checklist §25)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
                ],
                responses: { '200': { description: 'Purchases summary + optional importation block' } },
            },
        },
        // ── Org EBM config ───────────────────────────────────────────────────
        '/api/organizations/{id}/settings': {
            get: {
                tags: ['Org EBM Config'],
                summary: 'Get organization settings (includes ebmConfig)',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { '200': { description: 'Settings including featureFlags.ebmIntegrationEnabled and ebmConfig' } },
            },
            patch: {
                tags: ['Org EBM Config'],
                summary: 'Update organization settings (ADMIN)',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    featureFlags: { type: 'object', additionalProperties: true },
                                    preferences: { type: 'object', additionalProperties: true },
                                    sidebarConfig: { type: 'object', additionalProperties: true },
                                    ebmConfig: { $ref: '#/components/schemas/EbmConfig' },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Updated settings' } },
            },
        },
        '/api/organizations/{id}': {
            put: {
                tags: ['Org EBM Config'],
                summary: 'Update organization fiscal identity (ADMIN)',
                description: 'Fields: TIN, VRN, vatRegistered, ebmDeviceId, ebmSerialNo, trainingMode (§16 TS/TR vs NS/NR).',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    TIN: { type: 'string' },
                                    VRN: { type: 'string' },
                                    vatRegistered: { type: 'boolean' },
                                    isTaxExempt: { type: 'boolean' },
                                    taxExemptionReason: { type: 'string' },
                                    ebmDeviceId: { type: 'string' },
                                    ebmSerialNo: { type: 'string' },
                                    trainingMode: { type: 'boolean' },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Updated organization' } },
            },
        },
        // ── Sync triggers ────────────────────────────────────────────────────
        '/api/inventory/{organizationId}': {
            post: {
                tags: ['Sync Triggers'],
                summary: 'Create product (async `/items/saveItems` sync)',
                description: 'PRODUCT/RAW_MATERIAL require valid `itemClsCd`. Roles: ADMIN, ACCOUNTANT, SELLER, BRANCH_MANAGER.',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductCreateRequest' } } },
                },
                responses: { '201': { description: 'Product created; EBM sync runs asynchronously' } },
            },
        },
        '/api/inventory/{organizationId}/product/{id}': {
            put: {
                tags: ['Sync Triggers'],
                summary: 'Update product (re-queues RRA item sync when fiscal fields change)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductCreateRequest' } } },
                },
                responses: { '200': { description: 'Updated product' } },
            },
        },
        '/api/inventory/{organizationId}/products/{productId}/bom': {
            post: {
                tags: ['Sync Triggers'],
                summary: 'Add BOM component (async composition sync)',
                parameters: [
                    { $ref: '#/components/parameters/organizationId' },
                    { name: 'productId', in: 'path', required: true, schema: { type: 'integer' } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['componentProductId', 'quantity', 'unit'],
                                properties: {
                                    componentProductId: { type: 'integer' },
                                    quantity: { type: 'number', example: 0.5 },
                                    unit: { type: 'string', example: 'KG' },
                                },
                            },
                        },
                    },
                },
                responses: { '201': { description: 'BOM component added' } },
            },
        },
        '/api/inventory/{organizationId}/production/runs': {
            post: {
                tags: ['Sync Triggers'],
                summary: 'Create production run (ledger → pending stock sync)',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['branchId', 'productId', 'quantity'],
                                properties: {
                                    branchId: { type: 'integer' },
                                    productId: { type: 'integer' },
                                    quantity: { type: 'number', example: 2 },
                                    note: { type: 'string' },
                                    batchNumber: { type: 'string' },
                                    expiryDate: { type: 'string', format: 'date-time' },
                                },
                            },
                        },
                    },
                },
                responses: { '201': { description: 'Production run created' } },
            },
        },
        '/api/customers/{organizationId}': {
            post: {
                tags: ['Sync Triggers'],
                summary: 'Create customer (TIN present → async RRA customer sync)',
                parameters: [{ $ref: '#/components/parameters/organizationId' }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerCreateRequest' } } },
                },
                responses: { '201': { description: 'Customer created' } },
            },
        },
    },
};
