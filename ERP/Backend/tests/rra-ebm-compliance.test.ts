import { describe, it, expect } from 'vitest';
import { TaxService } from '../src/services/tax.service';
import { parseVsdcResponse, parseVsdcStatusCode } from '../src/services/vsdc-api.service';
import { parseGatewayResponse, gatewayErrorMessage, buildRraSendReceiptPayload, isValidRraTin, isValidVsdcPhone, resolveVsdcBuyerIdentity, toVsdcCustTinMobile, resolveCustTinForVsdc, walkInCustTin, PurchaseCodeMissingError, type SaleWithRelations } from '../src/services/rra-ebm.service';
import type { VsdcEnvelope } from '../src/services/vsdc-api.service';
import { validateRefundReasonCode, getRefundReasonCodes, DEFAULT_RFD_RSN_CD, resolvePkgUnitCd, resolveQtyUnitCd } from '../src/services/rra-code.service';
import { deriveQtyUnitCd } from '../src/services/item-code.service';
import { validateVsdcEnvelope } from '../src/services/vsdc-api.service';
import { taxGroups, documentIndicator, isFormalNoticeIndicator } from '../src/services/invoice-pdf.service';
import type { RenderInvoicePayload, RenderInvoiceLineItem } from '../src/services/invoice-render.service';
import { RraTaxCode, TaxCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

// ============================================================================
// Module 1: Global Setup & Security — Tax Code Mapping & Rate Enforcement
// ============================================================================
describe('RRA TAX CODE MAPPING (TAX_A / B / C / D)', () => {
  describe('getTaxCode — maps TaxCategory to RraTaxCode', () => {
    it('maps STANDARD → B (18% Taxable)', () => {
      expect(TaxService.getTaxCode('STANDARD' as TaxCategory)).toBe(RraTaxCode.B);
    });

    it('maps ZERO_RATED → C (0% Export)', () => {
      expect(TaxService.getTaxCode('ZERO_RATED' as TaxCategory)).toBe(RraTaxCode.C);
    });

    it('maps EXEMPT → A (0% Exempted)', () => {
      expect(TaxService.getTaxCode('EXEMPT' as TaxCategory)).toBe(RraTaxCode.A);
    });

    it('maps NON_TAXABLE → D (0% Non-Taxable)', () => {
      expect(TaxService.getTaxCode('NON_TAXABLE' as TaxCategory)).toBe(RraTaxCode.D);
    });
  });

  describe('getExpectedTaxRate — enforces RRA spec rates', () => {
    it('TAX_A expects 0%', () => {
      expect(TaxService.getExpectedTaxRate(RraTaxCode.A)).toBe(0);
    });

    it('TAX_B expects 18%', () => {
      expect(TaxService.getExpectedTaxRate(RraTaxCode.B)).toBe(18);
    });

    it('TAX_C expects 0%', () => {
      expect(TaxService.getExpectedTaxRate(RraTaxCode.C)).toBe(0);
    });

    it('TAX_D expects 0%', () => {
      expect(TaxService.getExpectedTaxRate(RraTaxCode.D)).toBe(0);
    });
  });

  describe('validateTaxRate — rejects invalid rates', () => {
    it('accepts TAX_B with rate 18', () => {
      const result = TaxService.validateTaxRate(RraTaxCode.B, 18);
      expect(result.valid).toBe(true);
      expect(result.expectedRate).toBe(18);
    });

    it('rejects TAX_B with rate 15', () => {
      const result = TaxService.validateTaxRate(RraTaxCode.B, 15);
      expect(result.valid).toBe(false);
    });

    it('rejects TAX_B with rate 5', () => {
      const result = TaxService.validateTaxRate(RraTaxCode.B, 5);
      expect(result.valid).toBe(false);
    });

    it('accepts TAX_A with rate 0', () => {
      expect(TaxService.validateTaxRate(RraTaxCode.A, 0).valid).toBe(true);
    });

    it('rejects TAX_A with rate 18', () => {
      expect(TaxService.validateTaxRate(RraTaxCode.A, 18).valid).toBe(false);
    });

    it('accepts TAX_C with rate 0', () => {
      expect(TaxService.validateTaxRate(RraTaxCode.C, 0).valid).toBe(true);
    });

    it('accepts TAX_D with rate 0', () => {
      expect(TaxService.validateTaxRate(RraTaxCode.D, 0).valid).toBe(true);
    });
  });

  describe('ALLOWED_TAX_CODES — only A, B, C, D are allowed', () => {
    it('includes A', () => expect(TaxService.ALLOWED_TAX_CODES.has(RraTaxCode.A)).toBe(true));
    it('includes B', () => expect(TaxService.ALLOWED_TAX_CODES.has(RraTaxCode.B)).toBe(true));
    it('includes C', () => expect(TaxService.ALLOWED_TAX_CODES.has(RraTaxCode.C)).toBe(true));
    it('includes D', () => expect(TaxService.ALLOWED_TAX_CODES.has(RraTaxCode.D)).toBe(true));
    it('excludes E (internal use only)', () => expect(TaxService.ALLOWED_TAX_CODES.has(RraTaxCode.E)).toBe(false));
  });

  describe('resolveProductTaxCode — VAT-registration and tax-exemption precedence', () => {
    it('VAT-registered, not exempt: uses the product category code', () => {
      expect(TaxService.resolveProductTaxCode(null, 'STANDARD', true, false)).toBe(RraTaxCode.B);
      expect(TaxService.resolveProductTaxCode(null, 'EXEMPT', true, false)).toBe(RraTaxCode.A);
      expect(TaxService.resolveProductTaxCode(null, 'ZERO_RATED', true, false)).toBe(RraTaxCode.C);
    });

    it('not VAT-registered: forces code D regardless of product category', () => {
      expect(TaxService.resolveProductTaxCode(null, 'STANDARD', false, false)).toBe(RraTaxCode.D);
      expect(TaxService.resolveProductTaxCode(RraTaxCode.B, 'STANDARD', false, false)).toBe(RraTaxCode.D);
    });

    it('tax-exempt entity: forces code A regardless of VAT-registration or product category', () => {
      expect(TaxService.resolveProductTaxCode(RraTaxCode.B, 'STANDARD', true, true)).toBe(RraTaxCode.A);
      expect(TaxService.resolveProductTaxCode(RraTaxCode.B, 'STANDARD', false, true)).toBe(RraTaxCode.A);
    });

    it('a non-VAT-registered account is never silently treated as VAT registered', () => {
      // Even an explicit product-level standard tax code must not survive when the org isn't VAT registered.
      expect(TaxService.resolveProductTaxCode(RraTaxCode.B, 'STANDARD', false)).not.toBe(RraTaxCode.B);
    });
  });
});

// ============================================================================
// Module 2: INVOICE — Response Parsing (RRA VSDC API v1.0.5 §3.3.6.1)
// ============================================================================
describe('INVOICE — parseVsdcResponse (/trnsSales/saveSales response)', () => {
  it('parses a successful sales-transaction response', () => {
    const vsdcResponse = {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: '20211027162114',
      data: {
        rcptNo: 27,
        intrlData: 'GZGGIZLYTJSSD7YLYLGIIG6FCY',
        rcptSign: 'TQZMKL57AGBMSTPO',
        totRcptNo: 32,
        vsdcRcptPbctDate: '20211027162114',
        sdcId: 'SDC010000005',
        mrcNo: 'WIS01006230',
      },
    };

    const result = parseVsdcResponse(vsdcResponse);

    expect(result.rcptNo).toBe('27');
    expect(result.intrlData).toBe('GZGGIZLYTJSSD7YLYLGIIG6FCY');
    expect(result.vsdcSignature).toBe('TQZMKL57AGBMSTPO');
    expect(result.totRcptNo).toBe('32');
    expect(result.sdcId).toBe('SDC010000005');
    expect(result.sdcDateTime).toBe('2021-10-27T16:21:14+02:00');
    expect(result.mrcNo).toBe('WIS01006230');
  });

  it('returns empty fallback when response is null', () => {
    const result = parseVsdcResponse(null);
    expect(result.rcptNo).toBe('');
    expect(result.intrlData).toBe('');
    expect(result.vsdcSignature).toBe('');
    expect(result.totRcptNo).toBe('');
    expect(result.sdcId).toBe('');
    expect(result.sdcDateTime).toBe('');
    expect(result.mrcNo).toBe('');
  });

  it('returns empty fallback when response is not an object', () => {
    const result = parseVsdcResponse('invalid');
    expect(result.rcptNo).toBe('');
  });
});

describe('parseVsdcStatusCode (§4.14 API Response Code)', () => {
  it('resultCd "000" is success, not an error', () => {
    const status = parseVsdcStatusCode({ resultCd: '000', resultMsg: 'It is succeeded' });
    expect(status.isError).toBe(false);
    expect(status.code).toBe('000');
  });

  it('normalizes numeric resultCd 0 / 1 to 000 / 001', () => {
    expect(parseVsdcStatusCode({ resultCd: 0 }).code).toBe('000');
    expect(parseVsdcStatusCode({ resultCd: 0 }).isError).toBe(false);
    expect(parseVsdcStatusCode({ resultCd: 1 }).code).toBe('001');
    expect(parseVsdcStatusCode({ resultCd: 1 }).message).toBe('There is no search result');
  });

  it('any other resultCd is an error, using resultMsg verbatim', () => {
    const status = parseVsdcStatusCode({ resultCd: '910', resultMsg: 'Request parameter error' });
    expect(status.isError).toBe(true);
    expect(status.message).toBe('Request parameter error');
  });

  it('falls back to the §4.14 table when resultMsg is absent', () => {
    const status = parseVsdcStatusCode({ resultCd: '881' });
    expect(status.isError).toBe(true);
    expect(status.message).toBe('Purchase is mandatory');
  });
});

// ============================================================================
// Module 3: REFUND — Gateway Error Parsing
// ============================================================================
describe('REFUND — error response parsing', () => {
  it('parseGatewayResponse extracts qrPayload from RRA nested structure', () => {
    const raw = {
      RESPONSE: {
        MESSAGE: {
          num: 'SAP12320t001',
          ysdcregsig: 'HLTC-GCDF-PJEI-U7F4',
        },
        STATUS: 'SUCCESS',
        QR_CODE: '?DATA=TEST123',
      },
    };

    const result = parseGatewayResponse(raw);
    expect(result.receiptQrPayload).toBe('?DATA=TEST123');
  });

  it('parseGatewayResponse returns empty object for non-object', () => {
    expect(parseGatewayResponse(null)).toEqual({});
  });
});

// ============================================================================
// Module 4: Error Message Extraction
// ============================================================================
describe('gatewayErrorMessage', () => {
  it('extracts message from HTTP JSON body', () => {
    const http = { json: { message: 'Total amount is different' }, status: 400 };
    expect(gatewayErrorMessage(http, 'fallback')).toBe('Total amount is different');
  });

  it('falls back when message is empty', () => {
    const http = { json: { message: '' }, status: 400 };
    expect(gatewayErrorMessage(http, 'fallback')).toBe('fallback');
  });

  it('falls back when json is null', () => {
    const http = { json: null, status: 400 };
    expect(gatewayErrorMessage(http, 'fallback')).toBe('fallback');
  });
});

// ============================================================================
// Module 5: INVENTORY / ITEMS — Edge Cases
// ============================================================================
describe('INVENTORY — response parsing edge cases', () => {
  it('parses RRA inventory error response (empty reference)', () => {
    const errorResponse = {
      errors: ['Please provide inventory document Id'],
      timestamp: '2023-11-03 10:24:24',
      status: 400,
    };

    const result = parseGatewayResponse(errorResponse);
    expect(result).toBeDefined();
  });
});

// ============================================================================
// Module 6: Calculation Precision — Item Tax Calculation
// ============================================================================
describe('TAX CALCULATION — decimal precision and resilience', () => {
  describe('calculateItemTax', () => {
    const standardRate = new Decimal(18);

    it('calculates inclusive TAX_B correctly (unitPrice includes VAT)', () => {
      const result = TaxService.calculateItemTax(
        118, 1, 'STANDARD' as TaxCategory, standardRate,
      );
      expect(Number(result.totalAmount)).toBe(118);
      expect(Number(result.taxableAmount)).toBeCloseTo(100, 2);
      expect(Number(result.taxAmount)).toBeCloseTo(18, 2);
      expect(result.taxCode).toBe(RraTaxCode.B);
    });

    it('TAX_A (EXEMPT) has zero VAT', () => {
      const result = TaxService.calculateItemTax(
        100, 1, 'EXEMPT' as TaxCategory, standardRate,
      );
      expect(Number(result.taxAmount)).toBe(0);
      expect(Number(result.taxableAmount)).toBe(100);
      expect(result.taxCode).toBe(RraTaxCode.A);
    });

    it('TAX_C (ZERO_RATED / Export) has zero VAT', () => {
      const result = TaxService.calculateItemTax(
        200, 5, 'ZERO_RATED' as TaxCategory, standardRate,
      );
      expect(Number(result.taxAmount)).toBe(0);
      expect(Number(result.totalAmount)).toBe(1000);
      expect(result.taxCode).toBe(RraTaxCode.C);
    });

    it('TAX_D (NON_TAXABLE) has zero VAT', () => {
      const result = TaxService.calculateItemTax(
        50, 3, 'NON_TAXABLE' as TaxCategory, standardRate,
      );
      expect(Number(result.taxAmount)).toBe(0);
      expect(Number(result.totalAmount)).toBe(150);
      expect(result.taxCode).toBe(RraTaxCode.D);
    });

    it('handles fractional quantities without floating-point error', () => {
      const result = TaxService.calculateItemTax(
        100.50, 2.5, 'STANDARD' as TaxCategory, standardRate,
      );
      expect(Number(result.totalAmount)).toBeCloseTo(251.25, 2);
      expect(Number(result.taxAmount)).toBeCloseTo(38.33, 2);
    });

    it('handles large quantities without overflow', () => {
      const result = TaxService.calculateItemTax(
        999999.99, 9999, 'STANDARD' as TaxCategory, standardRate,
      );
      expect(Number(result.totalAmount)).toBeCloseTo(999999.99 * 9999, 2);
    });
  });

  describe('calculateSaleTax — aggregates across items', () => {
    it.skip('sums multiple items with mixed tax codes (requires DB)', async () => {
      const summary = await TaxService.calculateSaleTax(1, [
        { productId: 1, quantity: 1, unitPrice: 118 },
        { productId: 2, quantity: 2, unitPrice: 50 },
        { productId: 3, quantity: 1, unitPrice: 200 },
      ]);

      expect(Number(summary.vatAmount)).toBeCloseTo(18, 2);
      expect(summary.items).toHaveLength(3);
      expect(summary.items[0].taxCode).toBe(RraTaxCode.B);
      expect(summary.items[1].taxCode).toBe(RraTaxCode.A);
      expect(summary.items[2].taxCode).toBe(RraTaxCode.C);
    });
  });
});

// ============================================================================
// Module 7: RECEIPT RENDERING — shared helpers used by all three renderers
// (invoice-pdf.service, invoice-render.service, invoice-receipt-pdf.service)
// ============================================================================

function makeItem(overrides: Partial<RenderInvoiceLineItem> = {}): RenderInvoiceLineItem {
  return {
    line: 1,
    code: 'ITEM-1',
    description: 'Test item',
    quantity: 1,
    unit: 'PCS',
    unitPrice: 100,
    discountPct: 0,
    discountAmt: 0,
    taxCode: 'A',
    vatPct: 0,
    taxAmount: 0,
    subtotal: 100,
    net: 100,
    total: 100,
    ...overrides,
  };
}

function makePayload(overrides: {
  items?: RenderInvoiceLineItem[]
  invoice?: Partial<RenderInvoicePayload['invoice']>
  certification?: Partial<RenderInvoicePayload['certification']>
} = {}): RenderInvoicePayload {
  return {
    company: { name: 'Test Co', ebmLinked: true },
    customer: { name: 'Walk-in' },
    invoice: {
      invoiceNumber: 'INV-1',
      receiptNumber: 'INV-1',
      invoiceDate: new Date().toISOString(),
      time: '10:00:00',
      paymentMethod: 'CASH',
      cashier: 'Cashier',
      status: 'COMPLETED',
      isProforma: false,
      isCopy: false,
      currency: 'RWF',
      ...overrides.invoice,
    },
    items: overrides.items ?? [makeItem()],
    totals: { subtotal: 100, discount: 0, taxable: 100, vat: 0, tax: 0, shipping: 0, paid: 100, balance: 0, grandTotal: 100 },
    charges: { vatAmount: 0, taxableAmount: 100, discountAmount: 0, cashAmount: 100, insuranceAmount: 0, debtAmount: 0, totalAmount: 100, shipping: 0 },
    payment: {},
    sdcInformation: {},
    certification: { isCertified: true, ...overrides.certification },
    verification: {},
    branding: {},
  };
}

describe('taxGroups — A/B/C/D totals only for bands used on line items', () => {
  it('unused B is omitted when the invoice has only A items', () => {
    const groups = taxGroups(makePayload({ items: [makeItem({ taxCode: 'A', vatPct: 0 })] }));
    expect(groups.find((g) => g.code === 'B')).toBeUndefined();
    expect(groups.find((g) => g.code === 'A')).toBeDefined();
  });

  it('tax codes A/C/D only appear when a line item actually used them', () => {
    const groups = taxGroups(makePayload({ items: [makeItem({ taxCode: 'B', vatPct: 18, taxAmount: 18 })] }));
    expect(groups.find((g) => g.code === 'B')).toBeDefined();
    expect(groups.find((g) => g.code === 'A')).toBeUndefined();
    expect(groups.find((g) => g.code === 'C')).toBeUndefined();
    expect(groups.find((g) => g.code === 'D')).toBeUndefined();
  });

  it('a used code accumulates totals from its line items only', () => {
    const groups = taxGroups(makePayload({
      items: [
        makeItem({ taxCode: 'A', vatPct: 0, total: 50, taxAmount: 0 }),
        makeItem({ taxCode: 'A', vatPct: 0, total: 30, taxAmount: 0 }),
      ],
    }));
    const aGroup = groups.find((g) => g.code === 'A');
    expect(aGroup!.total).toBe(80);
    expect(groups.map((g) => g.code)).toEqual(['A']);
  });
});

// ============================================================================
// REFUND fiscalisation — RRA checklist §9/§56 (a refund mirrors the original
// with the correct tax code and every amount negated)
// ============================================================================

function makeRefundSale(): SaleWithRelations {
  return {
    id: 2,
    saleNumber: 'REFUND-SALE-1-123',
    invoiceNumber: 'INV-1000-B1-2026-000002',
    vsdcInvcNo: 2,
    prcOrdCd: 'ABC123',
    rcptLabel: 'NR',
    createdAt: new Date('2026-08-30T09:00:00.000Z'),
    status: 'REFUNDED',
    paymentType: 'CASH',
    cashAmount: new Decimal(-1180),
    debtAmount: new Decimal(0),
    insuranceAmount: new Decimal(0),
    totalAmount: new Decimal(-1180),
    taxableAmount: new Decimal(-1000),
    vatAmount: new Decimal(-180),
    branchId: 1,
    branch: { id: 1, name: 'Main', code: 'M', bhfId: '00', ebmDeviceId: 'SDC1', ebmSerialNo: 'MRC1' },
    customer: { id: 5, name: 'Client', phone: '0788000000', TIN: '100000000', customerType: 'INDIVIDUAL', email: null },
    user: { id: 1, name: 'Cashier' },
    saleItems: [
      {
        productId: 10,
        quantity: -1,
        unitPrice: new Decimal(1180),
        totalPrice: new Decimal(-1180),
        taxRate: new Decimal(18),
        taxAmount: new Decimal(-180),
        taxCode: 'B',
        dcRate: new Decimal(0),
        dcAmt: new Decimal(0),
        product: { name: 'Widget', itemCd: 'RW2CTU0000001', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null },
      },
    ],
  };
}

describe('buildRraSendReceiptPayload — refund tax mirroring (§9/§56)', () => {
  it('submits the original tax code B and a positive extracted VAT on a refund', () => {
    const payload = buildRraSendReceiptPayload(
      makeRefundSale(),
      { TIN: '100000000', name: 'Seller', address: 'Kigali' },
      '01',
      { orgInvcNo: 1, rfdDt: new Date('2026-08-30T09:00:00.000Z'), rfdRsnCd: '06' },
    ) as any;

    expect(payload.rcptTyCd).toBe('R');
    expect(payload.salesSttsCd).toBe('05');
    expect(payload.itemList[0].taxTyCd).toBe('B');
    expect(payload.itemList[0].taxAmt).toBe(180);
    expect(payload.taxAmtB).toBe(180);
    expect(payload.taxblAmtB).toBe(1180);
    expect(payload.totTaxAmt).toBe(180);
  });
});

describe('validateVsdcEnvelope — RRA checklist §22 (device connectivity/TIN preconditions)', () => {
  const base = { bhfId: '00', sdcId: 'SDC1', mrcNo: 'MRC1', dvcSrlNo: 'MRC1', env: 'sandbox' };
  it('passes a well-formed 9-digit TIN with a configured serial', () => {
    expect(validateVsdcEnvelope({ ...base, tin: '100000000' })).toBeNull();
  });
  it('rejects a missing or malformed TIN', () => {
    expect(validateVsdcEnvelope({ ...base, tin: '' })).toMatch(/TIN/);
    expect(validateVsdcEnvelope({ ...base, tin: '12345' })).toMatch(/TIN/);
  });
  it('rejects a missing device serial', () => {
    expect(validateVsdcEnvelope({ ...base, tin: '100000000', mrcNo: '', dvcSrlNo: '' })).toMatch(/device serial/);
  });
});

describe('documentIndicator / isFormalNoticeIndicator — RRA checklist §55', () => {
  it('a normal, certified sale has no watermark and no "not official" notice', () => {
    const data = makePayload();
    expect(documentIndicator(data)).toBe('');
    expect(isFormalNoticeIndicator(documentIndicator(data)) || !data.certification.isCertified).toBe(false);
  });

  it('proforma is watermarked PROFORMA and always carries the notice', () => {
    const data = makePayload({ invoice: { isProforma: true } });
    expect(documentIndicator(data)).toBe('PROFORMA');
    expect(isFormalNoticeIndicator(documentIndicator(data))).toBe(true);
  });

  it('copy is titled COPY and carries no not-official notice', () => {
    const data = makePayload({ invoice: { isCopy: true } });
    expect(documentIndicator(data)).toBe('COPY');
    expect(isFormalNoticeIndicator(documentIndicator(data))).toBe(false);
  });

  it('a sale not yet certified by VSDC falls back to the notice even without a watermark', () => {
    const data = makePayload({ certification: { isCertified: false } });
    expect(documentIndicator(data)).toBe('');
    expect(isFormalNoticeIndicator(documentIndicator(data)) || !data.certification.isCertified).toBe(true);
  });
});

// ============================================================================
// RRA code class 32 — refund reasons are the RRA-controlled list, nothing else
// ============================================================================
describe('RRA refund reason codes (code class 32)', () => {
  it('exposes exactly the 13 RRA codes with RRA names', () => {
    const codes = getRefundReasonCodes();
    expect(codes.map((c) => c.code)).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13'],
    );
    expect(codes.find((c) => c.code === '13')!.name).toBe('Other reason');
    expect(codes.find((c) => c.code === '06')!.name).toBe('Refund');
    expect(DEFAULT_RFD_RSN_CD).toBe('06');
  });

  it('accepts every RRA code 01–13', () => {
    for (const c of getRefundReasonCodes()) {
      expect(validateRefundReasonCode(c.code)).toBe(c.code);
    }
  });

  it('rejects invented/out-of-list codes instead of submitting them', () => {
    expect(() => validateRefundReasonCode('99')).toThrow(/Invalid RRA refund reason/);
    expect(() => validateRefundReasonCode('')).toThrow(/Invalid RRA refund reason/);
    expect(() => validateRefundReasonCode('0A')).toThrow(/Invalid RRA refund reason/);
  });
});

// ============================================================================
// Customer TIN — valid TINs pass through, business buyers without one block,
// walk-in individuals get the documented placeholder (never the seller TIN)
// ============================================================================
describe('resolveCustTinForVsdc — safe customer TIN handling', () => {
  const base = { id: 9, saleNumber: 'SALE-1' };

  it('accepts 1- and 9-prefix 9-digit TINs', () => {
    expect(isValidRraTin('100000001')).toBe(true);
    expect(isValidRraTin('999945560')).toBe(true);
  });

  it('rejects 7-prefix, short, empty and all-zero values', () => {
    expect(isValidRraTin('700000001')).toBe(false);
    expect(isValidRraTin('123')).toBe(false);
    expect(isValidRraTin('')).toBe(false);
    expect(isValidRraTin('000000000')).toBe(false);
  });

  it('uses the customer real TIN when valid', () => {
    expect(resolveCustTinForVsdc({
      ...base,
      customer: { id: 1, name: 'Real Ltd', phone: '', TIN: '100000001', customerType: 'CORPORATE', email: null },
    })).toBe('100000001');
  });

  it('blocks CORPORATE/INSURANCE buyers without a valid TIN', () => {
    for (const t of ['CORPORATE', 'INSURANCE']) {
      expect(() => resolveCustTinForVsdc({
        ...base,
        customer: { id: 1, name: 'No Tin Ltd', phone: '', TIN: null, customerType: t, email: null },
      })).toThrow(/no valid 9-digit RRA TIN/);
    }
  });

  it('gives walk-in individuals the deterministic placeholder, never the seller TIN', () => {
    const tin = resolveCustTinForVsdc({
      ...base,
      customer: { id: 42, name: 'Walk-in Customer', phone: '', TIN: null, customerType: 'INDIVIDUAL', email: null },
    });
    expect(tin).toBe(walkInCustTin(42));
    // 19xxxxxxx band (deliberate — avoids colliding with common RRA sandbox
    // test TINs such as 100000000/100000001, see walkInCustTin).
    expect(tin).toBe('190000042');
    expect(isValidRraTin(tin)).toBe(true);
  });
});

// ============================================================================
// Payload guards — no fake prcOrdCd, no synthetic itemCd, sanitized unit codes
// ============================================================================
describe('buildRraSendReceiptPayload — submission guards', () => {
  function makeSale(over: Partial<SaleWithRelations> = {}): SaleWithRelations {
    return {
      id: 1,
      saleNumber: 'SALE-1',
      invoiceNumber: 'INV-1',
      vsdcInvcNo: 11,
      prcOrdCd: 'ABC123',
      rcptLabel: 'NS',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      status: 'COMPLETED',
      paymentType: 'CASH',
      cashAmount: new Decimal(1180),
      debtAmount: new Decimal(0),
      insuranceAmount: new Decimal(0),
      totalAmount: new Decimal(1180),
      taxableAmount: new Decimal(1000),
      vatAmount: new Decimal(180),
      branchId: 1,
      branch: { id: 1, name: 'Main', code: 'M', bhfId: '00', ebmDeviceId: null, ebmSerialNo: null },
      customer: { id: 5, name: 'Client', phone: '+250788000001', TIN: '100000000', customerType: 'INDIVIDUAL', email: null },
      user: { id: 1, name: 'Cashier' },
      saleItems: [
        {
          productId: 10,
          quantity: 1,
          unitPrice: new Decimal(1180),
          totalPrice: new Decimal(1180),
          taxRate: new Decimal(18),
          taxAmount: new Decimal(180),
          taxCode: 'B',
          dcRate: new Decimal(0),
          dcAmt: new Decimal(0),
          measurementUnit: 'PCS',
          product: { name: 'Widget', itemCd: 'RW2CTU0000001', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null },
        },
      ],
      ...over,
    };
  }
  const org = { TIN: '100000000', name: 'Seller', address: 'Kigali' };

  it('throws instead of sending a fake prcOrdCd when no code is on record', () => {
    const sale = makeSale({ prcOrdCd: null });
    (sale.customer as any).prcOrdCd = null;
    expect(() => buildRraSendReceiptPayload(sale, org, '01')).toThrowError(PurchaseCodeMissingError);
  });

  it('forwards the sale purchase code when present', () => {
    const payload = buildRraSendReceiptPayload(makeSale(), org, '01') as any;
    expect(payload.prcOrdCd).toBe('ABC123');
  });

  it('throws for a catalog product without an RRA itemCd', () => {
    const sale = makeSale();
    sale.saleItems[0].product = { ...(sale.saleItems[0].product as any), itemCd: null };
    expect(() => buildRraSendReceiptPayload(sale, org, '01')).toThrow(/no RRA item code/);
  });

  it('sanitizes unknown unit codes to RRA-accepted values instead of 913', () => {
    const sale = makeSale();
    sale.saleItems[0].product = { ...(sale.saleItems[0].product as any), pkgUnitCd: 'XX', qtyUnitCd: 'XX' };
    const payload = buildRraSendReceiptPayload(sale, org, '01') as any;
    expect(payload.itemList[0].pkgUnitCd).toBe('CT');
    expect(payload.itemList[0].qtyUnitCd).toBe('U');
  });

  it('derives the quantity unit from the measurement unit when the product has none', () => {
    const sale = makeSale();
    sale.saleItems[0].product = { ...(sale.saleItems[0].product as any), qtyUnitCd: null };
    sale.saleItems[0].measurementUnit = 'KG';
    const payload = buildRraSendReceiptPayload(sale, org, '01') as any;
    expect(payload.itemList[0].qtyUnitCd).toBe('KG');
  });

  it('accepts the RRA refund reason on a refund payload', () => {
    const payload = buildRraSendReceiptPayload(
      makeRefundSale(),
      org,
      '01',
      { orgInvcNo: 1, rfdDt: new Date('2026-08-30T09:00:00.000Z'), rfdRsnCd: '13' },
    ) as any;
    expect(payload.rfdRsnCd).toBe('13');
    expect(payload.salesSttsCd).toBe('05');
  });

  it('includes TrnsSalesSaveWrItem insurance keys and bcd per VSDC JSON sample', () => {
    const sale = makeSale();
    sale.saleItems[0].product = { ...(sale.saleItems[0].product as any), barcode: '8901234567890' };
    const payload = buildRraSendReceiptPayload(sale, org, '01') as any;
    expect(payload.itemList[0].bcd).toBe('8901234567890');
    expect(payload.itemList[0]).toMatchObject({
      isrccCd: null,
      isrccNm: null,
      isrcRt: null,
      isrcAmt: null,
    });
    expect(payload.receipt.adrs.length).toBeLessThanOrEqual(200);
  });

  it('sends the seller name as the receipt topMsg, both messages within CHAR 20', () => {
    const full = buildRraSendReceiptPayload(
      makeSale(),
      { TIN: '100000000', name: 'Seller', address: 'Kigali', phone: '+250788000000' },
      '01',
    ) as any;
    expect(full.receipt.topMsg).toBe('Seller');
    expect(full.receipt.btmMsg).toBe('THANK YOU');
    expect(full.receipt.btmMsg.length).toBeLessThanOrEqual(20);
    const bare = buildRraSendReceiptPayload(
      makeSale(),
      { TIN: null, name: 'Seller', address: null },
      '01',
    ) as any;
    expect(bare.receipt.topMsg).toBe('Seller');
  });

  it('does not send taxRtF / taxRtTt (not in TrnsSalesSaveWrReq)', () => {
    const p = buildRraSendReceiptPayload(makeSale(), { TIN: '100000000', name: 'Seller', address: null }, '01') as any;
    expect(p).not.toHaveProperty('taxRtF');
    expect(p).not.toHaveProperty('taxRtTt');
    expect(p).toHaveProperty('taxRtA');
    expect(p).toHaveProperty('taxRtD');
  });

  it('a void carries salesSttsCd 04 and orgInvcNo = the original invoice', () => {
    const p = buildRraSendReceiptPayload(
      makeSale(),
      { TIN: '100000000', name: 'Seller', address: null },
      '01',
      { cnclDt: new Date('2026-10-01T08:00:00.000Z'), invcNoOverride: 99, orgInvcNo: 42 },
    ) as any;
    expect(p.salesSttsCd).toBe('04');
    expect(p.invcNo).toBe(99);
    expect(p.orgInvcNo).toBe(42);
  });
});

describe('VSDC buyer identity mapping — official receipt structure', () => {
  function makeBuyerSale(customer: {
    TIN?: string | null;
    phone?: string | null;
    name?: string;
    customerType?: string;
  }): SaleWithRelations {
    return {
      id: 7,
      saleNumber: 'SALE-7',
      invoiceNumber: 'INV-7',
      vsdcInvcNo: 77,
      prcOrdCd: 'ABC123',
      rcptLabel: 'NS',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      status: 'COMPLETED',
      paymentType: 'CASH',
      cashAmount: new Decimal(1180),
      debtAmount: new Decimal(0),
      insuranceAmount: new Decimal(0),
      totalAmount: new Decimal(1180),
      taxableAmount: new Decimal(1000),
      vatAmount: new Decimal(180),
      branchId: 1,
      branch: { id: 1, name: 'Main', code: 'M', bhfId: '00', ebmDeviceId: null, ebmSerialNo: null },
      customer: {
        id: 9,
        name: 'Buyer',
        phone: '',
        TIN: null,
        customerType: 'INDIVIDUAL',
        email: null,
        ...customer,
      },
      user: { id: 1, name: 'Cashier' },
      saleItems: [
        {
          productId: 10,
          quantity: 1,
          unitPrice: new Decimal(1180),
          totalPrice: new Decimal(1180),
          taxRate: new Decimal(18),
          taxAmount: new Decimal(180),
          taxCode: 'B',
          dcRate: new Decimal(0),
          dcAmt: new Decimal(0),
          measurementUnit: 'PCS',
          product: { name: 'Widget', itemCd: 'RW2CTU0000001', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null },
        },
      ],
    } as unknown as SaleWithRelations;
  }
  const seller = { TIN: '100000000', name: 'Seller', address: 'Kigali' };

  function receiptOf(payload: unknown) {
    return (payload as any).receipt as Record<string, unknown>;
  }

  it('1. customer with TIN only → TIN everywhere, phone slot is JSON null', () => {
    const payload = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '100000001', phone: '', customerType: 'CORPORATE' }),
      seller,
      '01',
    ) as any;
    expect(payload.custTin).toBe('100000001');
    expect(receiptOf(payload).custTin).toBe('100000001');
    expect(receiptOf(payload).custMblNo).toBeNull();
    expect('custMblNo' in receiptOf(payload)).toBe(true);
  });

  it('2. customer with phone only → top-level custTin is the 9-digit local mobile, receipt.custTin stays null', () => {
    const payload = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: null, phone: '788428899', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(payload.custTin).toBe('788428899');
    expect(receiptOf(payload).custTin).toBeNull();
    expect('custTin' in receiptOf(payload)).toBe(true);
    expect(receiptOf(payload).custMblNo).toBe('788428899');
  });

  it('2b. phone-only buyer: +250 / 250 / 0 prefixes are normalized to the local form VSDC accepts', () => {
    for (const phone of ['+250788428899', '250788428899', '0788428899']) {
      const payload = buildRraSendReceiptPayload(
        makeBuyerSale({ TIN: null, phone, customerType: 'INDIVIDUAL' }),
        seller,
        '01',
      ) as any;
      expect(payload.custTin, phone).toBe('788428899');
    }
    expect(toVsdcCustTinMobile('not-a-phone')).toBeNull();
    expect(toVsdcCustTinMobile('100000002')).toBeNull();
    expect(toVsdcCustTinMobile(null)).toBeNull();
  });

  it('topMsg is the seller name clamped to CHAR 20', () => {
    const payload = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '100000001', phone: '', customerType: 'INDIVIDUAL' }),
      { TIN: '999945560', name: 'Exceledge demo pharmacy', address: 'KN 100 ST', phone: '0788888888' },
      '01',
    ) as any;
    expect(receiptOf(payload).topMsg).toBe('Exceledge demo pharm');
    const long = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '100000001', phone: '', customerType: 'INDIVIDUAL' }),
      { TIN: '999945560', name: 'N'.repeat(400), address: null },
      '01',
    ) as any;
    expect((receiptOf(long).topMsg as string).length).toBe(20);
  });

  it('3. customer with both TIN and phone → TIN wins on top, both receipt slots filled, never swapped', () => {
    const payload = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '100000001', phone: '+250788428899', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(payload.custTin).toBe('100000001');
    expect(receiptOf(payload).custTin).toBe('100000001');
    expect(receiptOf(payload).custMblNo).toBe('+250788428899');
  });

  it('4. customer with neither → all three buyer fields are JSON null (never "")', () => {
    const payload = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: null, phone: '', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(payload.custTin).toBeNull();
    expect(receiptOf(payload).custTin).toBeNull();
    expect(receiptOf(payload).custMblNo).toBeNull();
  });

  it('5. invalid TIN is rejected as a TIN (individual submits null custTin; business blocks)', () => {
    const individual = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '123', phone: '+250788428899', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(receiptOf(individual).custTin).toBeNull();
    expect(individual.custTin).toBe('788428899');
    expect(() => buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '123', phone: '+250788428899', customerType: 'CORPORATE' }),
      seller,
      '01',
    )).toThrow(/no valid 9-digit RRA TIN/);
  });

  it('6. invalid phone is rejected as a phone (never lands in custMblNo; TIN-shaped phones dropped)', () => {
    const badPhone = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: '100000001', phone: 'not-a-phone', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(receiptOf(badPhone).custMblNo).toBeNull();
    expect(badPhone.custTin).toBe('100000001');
    // A TIN-shaped value sitting in the phone column is a suspected swap —
    // it must leak into neither receipt slot.
    const swapped = buildRraSendReceiptPayload(
      makeBuyerSale({ TIN: null, phone: '100000002', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(receiptOf(swapped).custMblNo).toBeNull();
    expect(receiptOf(swapped).custTin).toBeNull();
    expect(swapped.custTin).toBeNull();
  });

  it('7. hostile customer text stays a plain JSON string and never corrupts the payload', () => {
    const evil = "'; DROP TABLE Students; --";
    const payload = buildRraSendReceiptPayload(
      makeBuyerSale({ name: evil, TIN: '100000001', phone: '+250788428899', customerType: 'INDIVIDUAL' }),
      seller,
      '01',
    ) as any;
    expect(payload.custNm).toBe(evil);
    expect(typeof payload.custNm).toBe('string');
    // JSON round-trip (exactly what the VSDC sender transmits) preserves the
    // value byte-for-byte and keeps every buyer field well-typed.
    const wire = JSON.parse(JSON.stringify(payload));
    expect(wire.custNm).toBe(evil);
    expect(wire.custTin).toBe('100000001');
    expect(wire.receipt.custTin).toBe('100000001');
    expect(wire.receipt.custMblNo).toBe('+250788428899');
    expect(typeof wire.receipt.trdeNm).toBe('string');
    expect(typeof wire.receipt.adrs).toBe('string');
    expect(typeof wire.receipt.topMsg).toBe('string');
    expect(typeof wire.receipt.btmMsg).toBe('string');
  });

  it('isValidVsdcPhone accepts official mobile shapes only', () => {
    expect(isValidVsdcPhone('788428899')).toBe(true);
    expect(isValidVsdcPhone('+250788428899')).toBe(true);
    expect(isValidVsdcPhone('0788428899')).toBe(true);
    expect(isValidVsdcPhone('not-a-phone')).toBe(false);
    expect(isValidVsdcPhone('123')).toBe(false);
    expect(isValidVsdcPhone('')).toBe(false);
    expect(isValidVsdcPhone(null)).toBe(false);
  });

  it('resolveVsdcBuyerIdentity never swaps the two receipt slots', () => {
    expect(resolveVsdcBuyerIdentity({ TIN: '100000001', phone: '+250788428899' })).toEqual({
      custTin: '100000001',
      receiptCustTin: '100000001',
      receiptCustMblNo: '+250788428899',
    });
    expect(resolveVsdcBuyerIdentity({ TIN: null, phone: null })).toEqual({
      custTin: null,
      receiptCustTin: null,
      receiptCustMblNo: null,
    });
    expect(resolveVsdcBuyerIdentity(null)).toEqual({
      custTin: null,
      receiptCustTin: null,
      receiptCustMblNo: null,
    });
  });
});

describe('vsdcRequestBody — payload envelope parity', () => {
  it('sends only tin+bhfId from the device envelope (no sdcId/mrcNo/env pollution)', async () => {
    const { vsdcRequestBody } = await import('../src/services/vsdc-api.service');
    // A full device envelope in, only tin+bhfId out (no sdcId/mrcNo/env pollution).
    const envelope: VsdcEnvelope = { tin: '999945560', bhfId: '00', sdcId: 'SDC1', mrcNo: 'MRC1', dvcSrlNo: 'MRC1', env: 'sandbox' };
    const body = vsdcRequestBody(
      envelope,
      { invcNo: 1, salesTyCd: 'N' },
    );
    expect(body).toEqual({ tin: '999945560', bhfId: '00', invcNo: 1, salesTyCd: 'N' });
    expect(body).not.toHaveProperty('sdcId');
    expect(body).not.toHaveProperty('mrcNo');
    expect(body).not.toHaveProperty('dvcSrlNo');
    expect(body).not.toHaveProperty('env');
  });
});

describe('RRA unit-code resolvers (classes 10/17)', () => {
  it('keeps real RRA codes, normalizes case', () => {
    expect(resolvePkgUnitCd('ct')).toBe('CT');
    expect(resolveQtyUnitCd('kg', 'PCS', deriveQtyUnitCd)).toBe('KG');
  });

  it('falls back for unknown codes', () => {
    expect(resolvePkgUnitCd('XX')).toBe('CT');
    expect(resolveQtyUnitCd('XX', 'KG', deriveQtyUnitCd)).toBe('KG');
    expect(resolveQtyUnitCd(null, null, deriveQtyUnitCd)).toBe('U');
  });
});
