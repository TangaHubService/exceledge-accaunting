import { z } from 'zod';
import { createProductSchema, updateProductSchema } from '../../src/validations/products.validation';
import { createSaleSchema, updateProformaSchema, convertProformaSchema, cancelSaleSchema } from '../../src/validations/sales.validation';
import { createCustomerSchema, updateCustomerSchema, recordDebtPaymentSchema } from '../../src/validations/customers.validation';
import { Route, Schema, inspect, typeSchema, checker } from './source';

const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const number = (example = 1): Schema => ({ type: 'number', example });
const id: Schema = { type: 'integer', minimum: 1, example: 2 };
const string = (example: string): Schema => ({ type: 'string', example });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values, example: values[0] });
const array = (items: Schema): Schema => ({ type: 'array', items });
const json: Schema = { type: 'object', additionalProperties: true, example: {} };
const validators: Record<string, z.ZodType> = {
  createProduct: createProductSchema, updateProduct: updateProductSchema,
  createSale: createSaleSchema, updateProforma: updateProformaSchema, convertProforma: convertProformaSchema,
  cancelSale: cancelSaleSchema, createCustomer: createCustomerSchema, updateCustomer: updateCustomerSchema,
  recordDebtPayment: recordDebtPaymentSchema,
};
const enums: Record<string, string[]> = {
  itemType: ['PRODUCT', 'RAW_MATERIAL', 'SERVICE'], taxCategory: ['STANDARD', 'ZERO_RATED', 'EXEMPT'],
  taxCode: ['A', 'B', 'C', 'D'], measurementUnit: ['PCS', 'KG', 'LTR', 'MTR', 'BOX', 'PAIR', 'DOZEN', 'GRAM', 'ML', 'OTHER'],
  paymentType: ['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD'],
  role: ['ADMIN', 'ACCOUNTANT', 'SELLER', 'BRANCH_MANAGER'],
};
const examples: Record<string, any> = {
  email: 'tester@example.com', password: 'ExamplePassword123!', currentPassword: 'ExamplePassword123!', newPassword: 'NewExamplePassword123!',
  name: 'Test item', phone: '+250788000000', phoneNumber: '0788000000', tin: '123456789', TIN: '123456789', VRN: '123456789',
  code: '123456', address: 'Kigali', addressLine2: 'Test address', location: 'Kigali', businessType: 'RETAIL',
  quantity: 1, quantityReceived: 1, quantityProduced: 1, unitPrice: 1000, sellingPrice: 1500, purchasePrice: 500, unitCost: 500,
  minStock: 10, balance: 0, amount: 1000, cashAmount: 1000, debtAmount: 0, insuranceAmount: 0,
  openingFloat: 0, openingMobileMoney: 0, actualCash: 0, actualMobileMoney: 0, months: 1, monthsToAdd: 1,
  notes: 'Created from API documentation', note: 'Test inventory adjustment', reason: 'Testing this API operation',
  openingNotes: 'Test shift', closingNotes: 'Test shift closing', varianceReason: 'Test closing variance',
  description: 'Example description', title: 'Test notification', message: 'Example notification', reference: 'API-TEST-001',
  referenceType: 'MANUAL', sku: 'API-TEST-001', batchNumber: 'API-BATCH-001', category: 'Test', paymentMethod: 'CASH',
  itemClsCd: 'REPLACE_WITH_VALID_RRA_CLASS', itemStandardName: 'Test item', origin: 'RW',
  pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: 1, unit: 'KG', barcode: '1234567890123', additionalInfo: 'TEST',
  currency: 'RWF', contactPerson: 'Test supplier', ebmDeviceId: 'TEST-DEVICE', ebmSerialNo: 'TEST-SERIAL', bhfId: '00',
  vsdcUrl: 'http://localhost:8080', imageUrl: 'https://example.com/image.png', platform: 'WEB', deviceHash: 'api-test-device',
  idempotencyKey: 'API-TEST-001', prcOrdCd: 'REPLACE_WITH_VALID_PURCHASE_CODE',
  page: 1, limit: 50, pageSize: 50, days: 30, preset: 'month', sortOrder: 'desc', sortBy: 'createdAt',
  search: 'Test', q: 'Test', cdCls: '10', period: 'month', requestDate: '20260901',
  startDate: '2026-09-01', endDate: '2026-09-30', date: '2026-09-15', expiryDate: '2027-09-15T00:00:00.000Z',
  expectedDate: '2026-09-30T00:00:00.000Z', expenseDate: '2026-09-15T00:00:00.000Z', paymentDate: '2026-09-15T00:00:00.000Z',
  OrderTrackingId: '00000000-0000-4000-8000-000000000001', OrderNotificationType: 'IPNCHANGE', OrderMerchantReference: 'API-TEST-001',
  sessionId: 'TEST-SESSION', provider: 'MTN', rail: 'PAYPACK', format: 'pdf', inventoryMethod: 'FIFO',
  rcptLabel: 'SALE', status: 'ACTIVE', type: 'INDIVIDUAL', taxExemptionReason: 'Test exemption',
};

export function fieldSchema(name: string, supplied: Schema = {}, route?: Route, query = false): Schema {
  // Request/query values from Express are often typed as any or ParsedQs.
  // Use known wire types; retain explicit controller/validator types otherwise.
  let schema: Schema;
  if (/Ids$/.test(name)) schema = array(id);
  else if (/Id$/.test(name) || name === 'id' || name === 'recipientId' || name === 'sellerId') schema = id;
  else if (/^(is|has|show|use|allow)[A-Z]/.test(name) || ['vatRegistered', 'trainingMode', 'unread', 'reject', 'autoRenew', 'includeInactive', 'removeImage'].includes(name)) schema = { type: 'boolean', example: false };
  else if (['data', 'metadata', 'preferences', 'featureFlags', 'sidebarConfig', 'ebmConfig', 'invoiceHeader', 'customer', 'denominationCounts'].includes(name)) schema = json;
  else if (enums[name]) schema = enumeration(...enums[name]);
  else if (['page', 'limit', 'pageSize', 'days', 'months', 'monthsToAdd', 'packagingQty'].includes(name)) schema = { ...id, example: examples[name] };
  else if (/amount|price|cost|quantity|float|balance|stock|discount|taxRate|actualCash|actualMobileMoney|openingMobileMoney|l[1-5]SalePrice/i.test(name)) schema = number(typeof examples[name] === 'number' ? examples[name] : 0);
  else if (['items', 'payments', 'bomComponents', 'receivedItems', 'organizations'].includes(name)) schema = array(json);
  else if (name === 'email') schema = { type: 'string', format: 'email', example: examples.email };
  else if (/Date$/.test(name) && !['startDate', 'endDate', 'requestDate'].includes(name)) schema = { type: 'string', format: 'date-time', example: examples[name] || '2026-09-15T00:00:00.000Z' };
  else schema = string(examples[name] ?? 'Test');
  if (supplied.type && !['body', 'query'].includes(name) && !(query && supplied.type === 'object')) schema = { ...schema, ...supplied };
  if (supplied.anyOf && !query) schema = supplied;
  if (supplied.default !== undefined) schema.default = supplied.default;
  if (schema.enum && !schema.enum.includes(schema.example)) schema.example = schema.enum[0];
  if (schema.example === undefined && examples[name] !== undefined && !schema.anyOf) schema.example = examples[name];
  if (route && ['status', 'type', 'paymentMethod', 'provider', 'rail', 'movementType', 'billingMode', 'businessType', 'platform', 'preset', 'format'].includes(name)) {
    const source = route.file.text;
    // Inline controller checks are authoritative for endpoint-specific enum fields.
    const checks = [...source.matchAll(/\[((?:\s*['"][^'"]+['"]\s*,?)+)\]\.includes\((\w+)\)/g)];
    const check = checks.find(match => match[2] === name);
    if (check) schema = enumeration(...[...check[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
  }
  return schema;
}

const bomItem = object({ componentProductId: id, quantity: { type: 'number', minimum: 0, exclusiveMinimum: true, multipleOf: 0.001, example: 0.5 }, unit: string('KG') }, ['componentProductId', 'quantity', 'unit']);
const saleItem = object({ productId: id, quantity: number(1), unitPrice: number(1000), discount: number(0), itemType: enumeration('PRODUCT', 'RAW_MATERIAL', 'SERVICE'), serviceName: string('Consultation'), serviceDescription: string('Test service') }, ['quantity', 'unitPrice']);
const purchaseItem = object({ productId: id, productName: string('Test item'), quantity: number(10), unitPrice: number(500), taxCode: enumeration('A', 'B', 'C', 'D'), taxRate: number(0) }, ['productName', 'quantity', 'unitPrice']);
const invoiceItem = object({ id, productId: id, productName: string('Test item'), quantity: number(10), unitPrice: number(500), sellingPrice: number(1000), batchNumber: string('API-BATCH-001'), expiryDate: string('2027-09-15T00:00:00.000Z'), sku: string('API-TEST-001'), itemClsCd: string('REPLACE_WITH_VALID_RRA_CLASS'), qtyUnitCd: string('U'), pkgUnitCd: string('CT'), origin: string('RW') }, ['id', 'productName', 'quantity', 'unitPrice']);
const overrides: Record<string, Schema> = {
  login: object({ email: fieldSchema('email'), password: string('ExamplePassword123!') }, ['email', 'password']),
  signup: object({ email: fieldSchema('email'), password: string('ExamplePassword123!'), name: string('Test user'), phone: fieldSchema('phone') }, ['email', 'password', 'name']),
  refresh: object({ refreshToken: string('REPLACE_WITH_REFRESH_TOKEN') }, ['refreshToken']),
  changePassword: object({ currentPassword: fieldSchema('currentPassword'), newPassword: fieldSchema('newPassword') }, ['currentPassword', 'newPassword']),
  updateOrgSettings: object({ sidebarConfig: json, featureFlags: json, preferences: json, ebmConfig: json }),
  updateCustomer: object({ ...((z.toJSONSchema(updateCustomerSchema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as Schema).properties?.body?.properties || {}), type: enumeration('INDIVIDUAL', 'CORPORATE'), balance: number(0) }),
  updateUser: object({ name: string('Test user'), email: fieldSchema('email'), phone: fieldSchema('phone'), role: enumeration('ADMIN', 'ACCOUNTANT', 'SELLER', 'BRANCH_MANAGER'), isActive: { type: 'boolean' }, organizations: array(object({ organizationId: id, role: enumeration('ADMIN', 'ACCOUNTANT', 'SELLER', 'BRANCH_MANAGER') }, ['organizationId', 'role'])) }),
  updateExpense: object({ category: string('OPERATING'), amount: number(1000), paymentMethod: string('CASH'), description: string('Test expense'), reference: string('API-TEST-001'), expenseDate: fieldSchema('expenseDate'), notes: fieldSchema('notes') }),
  createPurchaseOrder: object({ supplierId: id, items: { ...array(purchaseItem), minItems: 1 }, notes: fieldSchema('notes'), expectedDate: fieldSchema('expectedDate') }, ['supplierId', 'items']),
  updatePurchaseOrder: object({ items: array(purchaseItem), notes: fieldSchema('notes'), expectedDate: fieldSchema('expectedDate') }, ['items']),
  updatePurchaseOrderStatus: object({ status: enumeration('APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'PARTIALLY_RECEIVED'), branchId: id, receivedItems: array(object({ productId: id, quantity: number(10), unitCost: number(500), batchNumber: fieldSchema('batchNumber'), expiryDate: fieldSchema('expiryDate') }, ['productId', 'quantity'])) }, ['status']),
  createStockTransfer: object({ fromBranchId: id, toBranchId: { ...id, example: 3 }, notes: fieldSchema('notes'), items: { ...array(object({ productId: id, quantity: number(1) }, ['productId', 'quantity'])), minItems: 1 } }, ['fromBranchId', 'toBranchId', 'items']),
  addBomComponent: bomItem,
  updateBomComponentController: object({ quantity: number(0.5), unit: string('KG') }),
  createProductionRun: object({ branchId: id, productId: id, quantity: number(2), note: fieldSchema('note'), batchNumber: fieldSchema('batchNumber'), expiryDate: fieldSchema('expiryDate') }, ['branchId', 'productId', 'quantity']),
  createHeldSaleController: object({ items: array(saleItem), customer: object({ id, name: string('Test customer') }), shiftId: id }, ['items']),
  refundSale: object({ reason: fieldSchema('reason'), items: array(object({ productId: id, quantity: number(1) }, ['productId', 'quantity'])) }, ['reason', 'items']),
  updateInvoiceItems: object({ items: array(invoiceItem), invoiceHeader: object({ supplierName: string('Test supplier'), invoiceNumber: string('API-INVOICE-001'), invoiceDate: fieldSchema('expenseDate'), currency: string('RWF'), totalAmount: number(5000) }) }, ['items']),
  matchProducts: object({ items: array(object({ productName: string('Test item'), sku: fieldSchema('sku'), barcode: fieldSchema('barcode') }, ['productName'])) }, ['items']),
  handlePaypackWebhook: { type: 'object', additionalProperties: true, description: 'Raw Paypack event JSON. Supply the original provider event and its valid HMAC signature; signature verification uses the exact request bytes.' },
};

export const notes: Record<string, string> = {
  createProduct: 'PRODUCT and RAW_MATERIAL require a valid itemClsCd from RRA item classes. Replace the example classification with a real code. SERVICE does not require a classification. bomComponents is allowed only for PRODUCT, has at most 50 unique raw materials, and quantities support 3 decimal places. Product creation initializes branch stock; EBM synchronization runs asynchronously.',
  createProducts: 'The JSON body is an array of product objects, not an object with a products property.',
  createSale: 'A stock sale needs an open shift for this branch and enough inventory. Use isProforma=true to create a quote without stock consumption or collection. Send numeric IDs, quantities and amounts. Prices are tax inclusive; payment amounts must cover the computed total. Cash and split-payment examples are included.',
  convertProforma: 'Converts an unconverted proforma and consumes inventory. Needs an open shift; payments must cover the total. The quote cannot be converted twice.',
  createProductionRun: 'Consumes every raw material in the finished product recipe and adds finished goods in one transaction. Create the recipe and stock its raw materials in the selected branch first.',
  checkProductionRequirementsController: 'Both quantity and branchId query parameters are required. Returns component requirements and available stock before production.',
  updateBomComponentController: 'Provide quantity, unit, or both. componentId in this route is the raw material product ID, not the BomComponent row ID.',
  getBomComponent: 'componentId is the raw material product ID, not the BomComponent row ID.',
  removeBomComponent: 'componentId is the raw material product ID, not the BomComponent row ID.',
  uploadAndScanInvoice: 'Multipart upload: invoice is a PDF/JPEG/PNG (maximum 20 MB). extractedData is a JSON string containing products and invoice header fields. Scanning is performed by the client; without extractedData the uploaded invoice enters REVIEW for manual editing.',
  getEbmReceipt: 'May return 202 while asynchronous EBM processing is pending.',
  getInvoicePdf: 'Returns the invoice PDF. May return 425 while EBM processing is pending.',
  getInvoice: 'Invoice responses depend on the router module: sales invoice downloads and supplier invoice records use different formats.',
  getSupplierOrders: 'This route currently has no authentication middleware. It returns supplier portal order data using the URL organization and supplier IDs.',
  getSupplierOrder: 'This route currently has no authentication middleware. It returns supplier portal order data using the URL organization and supplier IDs.',
  getProductById: 'Current implementation reads organizationId from path parameters, but this registered route only supplies id. Use the organization product list to retrieve products until the detail route is corrected.',
  initiatePesapalPayment: 'This legacy handler reads organizationId and planId from the body and reads req.body.user.userId, despite these IDs appearing in the URL. Its successful path currently sends no HTTP response. Prefer the Paypack subscription initiation endpoint for an interactive test.',
  updatePurchaseOrderStatus: 'COMPLETED/PARTIALLY_RECEIVED receive stock and require branchId. receivedItems supplies per-product received quantities, costs and batches.',
};

export function requestSchema(route: Route): Schema | undefined {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) return undefined;
  const inspected = inspect(route);
  let result: Schema | undefined;
  const validator = validators[route.handler];
  if (validator) {
    const exported = z.toJSONSchema(validator, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as Schema;
    result = exported.properties.body;
    delete result.$schema;
    // Controllers also read fields outside the shared validation object.
    for (const [name, supplied] of inspected.body) if (!result.properties[name]) result.properties[name] = fieldSchema(name, supplied, route);
  } else if (inspected.body.size) result = object(Object.fromEntries([...inspected.body].map(([name, supplied]) => [name, fieldSchema(name, supplied, route)])), [...inspected.required]);
  if (overrides[route.handler]) result = structuredClone(overrides[route.handler]);
  if (route.handler === 'createProducts') result = array(requestSchema({ ...route, handler: 'createProduct' })!);
  if (route.upload) result = object({ ...(result?.properties || {}), [route.upload]: { type: 'string', format: 'binary', description: 'Choose the file to upload.' } }, [route.upload]);
  if (result?.properties?.items && !overrides[route.handler]) result.properties.items = array(saleItem);
  if (result?.properties?.bomComponents) result.properties.bomComponents = { ...result.properties.bomComponents, items: bomItem };
  if (route.handler === 'createCustomer' && result?.properties) {
    result.properties.type = enumeration('INDIVIDUAL', 'CORPORATE');
    result.properties.balance = number(0);
  }
  if (route.handler === 'uploadAndScanInvoice' && result?.properties) result.properties.extractedData = { type: 'string', description: 'JSON-encoded scan result, supplied as a multipart text field.', example: JSON.stringify({ supplierName: 'Test supplier', invoiceNumber: 'API-INVOICE-001', products: [{ productName: 'Test item', quantity: 10, unitPrice: 500 }] }) };
  if (route.handler === 'createCashMovementController' && result?.properties) result.properties.type = enumeration('PAY_IN', 'PAY_OUT');
  return result;
}

export function exampleFor(schema: Schema, name = '', depth = 0): any {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum.find((value: any) => value !== null) ?? schema.enum[0];
  if (schema.anyOf || schema.oneOf) return exampleFor((schema.anyOf || schema.oneOf).find((value: Schema) => value.type && !value.nullable) || (schema.anyOf || schema.oneOf)[0], name, depth);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((value: Schema) => exampleFor(value, name, depth)));
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(Object.entries<Schema>(schema.properties || {}).filter(([, value]) => value.format !== 'binary').map(([key, value]) => [key, exampleFor(value, key, depth + 1)]));
  if (schema.type === 'array') return depth > 5 ? [] : [exampleFor(schema.items || {}, name.replace(/s$/, ''), depth + 1)];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return typeof examples[name] === 'number' ? examples[name] : /Id$|^id$/.test(name) ? 2 : schema.minimum ?? 1;
  if (schema.type === 'string') {
    if (schema.format === 'date-time') return '2026-09-15T10:00:00.000Z';
    if (schema.format === 'date') return '2026-09-15';
    if (schema.format === 'email') return 'tester@example.com';
    if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
    if (schema.pattern?.includes('0-9') && !schema.pattern.includes('a-z')) return schema.description?.includes('Decimal') ? '1000' : '123456789';
    if (/token|password|secret/i.test(name)) return 'EXAMPLE_ONLY_REPLACE_LOCALLY';
    return examples[name] !== undefined ? String(examples[name]) : 'Example';
  }
  return schema.nullable ? null : {};
}

export function requestExamples(route: Route, schema: Schema) {
  const generic = exampleFor(schema);
  const product = { name: 'API test finished product', itemType: 'PRODUCT', unitPrice: 1000, purchasePrice: 500, quantity: 10, minStock: 0, taxCategory: 'EXEMPT', taxCode: 'A', measurementUnit: 'PCS', itemClsCd: 'REPLACE_WITH_VALID_RRA_CLASS', origin: 'RW', pkgUnitCd: 'CT', qtyUnitCd: 'U' };
  const cashSale = { customerId: 2, branchId: 2, shiftId: 2, items: [{ productId: 2, quantity: 1, unitPrice: 1000, itemType: 'PRODUCT' }], paymentType: 'CASH', cashAmount: 1000, debtAmount: 0, insuranceAmount: 0, isProforma: false };
  if (route.handler === 'createProduct') return {
    product: { summary: 'Finished product with initial stock', value: product },
    rawMaterial: { summary: 'Raw material with initial stock', value: { ...product, name: 'API test raw material', itemType: 'RAW_MATERIAL', measurementUnit: 'KG', unitPrice: 500, purchasePrice: 300, quantity: 100 } },
    productWithRecipe: { summary: 'Finished product with recipe', value: { ...product, quantity: 0, bomComponents: [{ componentProductId: 2, quantity: 0.5, unit: 'KG' }] } },
    service: { summary: 'Service without stock', value: { name: 'Consultation', itemType: 'SERVICE', unitPrice: 1000, quantity: 0, taxCategory: 'EXEMPT', taxCode: 'A' } },
  };
  if (route.handler === 'createProducts') return { bulk: { summary: 'Array of products', value: [product] } };
  if (route.handler === 'updateProduct') return { update: { value: { name: 'Updated test item', unitPrice: 1200 } } };
  if (route.handler === 'createSale') return {
    cash: { summary: 'Cash sale', value: cashSale },
    debt: { summary: 'Sale on credit', value: { ...cashSale, paymentType: 'DEBT', cashAmount: 0, debtAmount: 1000 } },
    split: { summary: 'Cash and card payment', value: { ...cashSale, payments: [{ paymentMethod: 'CASH', amount: 500 }, { paymentMethod: 'CARD', amount: 500, reference: 'TEST-CARD' }] } },
    proforma: { summary: 'Proforma quote', value: { ...cashSale, isProforma: true, cashAmount: 0, debtAmount: 1000, paymentType: 'DEBT' } },
    service: { summary: 'Service sale', value: { ...cashSale, items: [{ itemType: 'SERVICE', serviceName: 'Consultation', quantity: 1, unitPrice: 1000 }] } },
  };
  if (route.handler === 'convertProforma') return { cash: { value: { paymentType: 'CASH', cashAmount: 1000, debtAmount: 0, insuranceAmount: 0, shiftId: 2 } } };
  if (route.handler === 'createCustomer') return { customer: { value: { name: 'API test customer', phone: '+250788000000', email: 'customer@example.com', type: 'INDIVIDUAL', balance: 0 } }, corporate: { value: { name: 'API test company', type: 'CORPORATE', TIN: '123456789', phone: '+250788000000', prcOrdCd: 'REPLACE_WITH_VALID_PURCHASE_CODE' } } };
  if (route.handler === 'updateCustomer') return { update: { value: { name: 'Updated test customer', phone: '+250788000000' } } };
  if (route.handler === 'openShiftController') return { open: { value: { openingFloat: 0, openingMobileMoney: 0, openingNotes: 'API test shift' } } };
  if (route.handler === 'createExpense') return { expense: { value: { category: 'OPERATING', amount: 1000, paymentMethod: 'CASH', description: 'API test expense', expenseDate: '2026-09-15T10:00:00.000Z' } } };
  return { example: { summary: 'Illustrative request; replace IDs with your test records', value: generic } };
}

export function productResponseSchema(): Schema {
  const source = checker.getProgram?.(); // Prisma return types are available through the controller's typed variable.
  void source;
  return {};
}
