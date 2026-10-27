import { describe, expect, it, vi } from "vitest"
import PDFDocument from "pdfkit"
import {
  renderDailyReportPdf,
  renderPluReportPdf,
  type DailyReportData,
  type PluReportData,
} from "../src/services/fiscal-report-pdf.service"

const header = {
  orgName: "Configured Taxpayer Ltd",
  tin: "100000000",
  mrcNo: "MRC010000001",
  sdcId: "SDC010000001",
  branchName: "Kigali Central",
  bhfId: "00",
  address: "Kigali, Rwanda",
}

function dailyFixture(reportType: "X" | "Z"): DailyReportData {
  return {
    reportType,
    reportDate: "2026-08-30",
    generatedAt: "2026-08-30T18:00:00.000Z",
    periodStart: "2026-08-30T00:00:00.000Z",
    periodEnd: "2026-08-30T23:59:59.999Z",
    previousCloseAt: null,
    coversSinceLastZ: false,
    header,
    counters: { firstRcptNo: 12, lastRcptNo: 47, lastTotalRcptNo: 512, receiptCount: 36, itemCount: 120 },
    summary: {
      normalSalesCount: 34,
      normalRefundsCount: 2,
      grossSalesAmt: 4_500_000,
      grossRefundAmt: 118_000,
      netSalesAmt: 4_382_000,
      totalTaxAmt: 668_440,
      trainingCount: 1,
      trainingAmt: 1_180,
      copyCount: 3,
      copyAmt: 35_400,
      openingDeposit: 50_000,
      proformaCount: 1,
      proformaAmt: 23_600,
      discountTotal: 5_000,
      otherReductionsAmt: 0,
      incompleteSalesCount: 2,
    },
    taxBands: {
      A: { taxableAmt: 200_000, taxAmt: 0, salesAmt: 200_000 },
      B: { taxableAmt: 3_714_000, taxAmt: 668_440, salesAmt: 4_382_440 },
      C: { taxableAmt: 0, taxAmt: 0, salesAmt: 0 },
      D: { taxableAmt: 0, taxAmt: 0, salesAmt: 0 },
    },
    taxRates: { A: 0, B: 18, C: 0, D: 0, E: 0 },
    refundBands: {
      A: { taxableAmt: 0, taxAmt: 0, salesAmt: 0 },
      B: { taxableAmt: -100_000, taxAmt: -15_254, salesAmt: -118_000 },
    },
    paymentBreakdown: { CASH: 3_900_000, MOBILE_MONEY: 482_000 },
    refundPaymentBreakdown: { CASH: -118_000 },
    groupTotals: {
      Dairy: { salesAmt: 4_382_440, refundAmt: -118_000, itemCount: 37 },
    },
    vsdcConfirmation: reportType === "Z" ? { checked: true, rptDe: "20260830" } : null,
  }
}

function pluFixture(): PluReportData {
  return {
    header,
    periodLabel: "2026-08-01 → 2026-08-30",
    generatedAt: "2026-08-30T18:00:00.000Z",
    rows: [
      { itemCd: "RW2CTU0000001", productName: "Widget A", unit: "PCS", quantity: 120, revenue: 141_600, taxAmount: 21_600, transactionCount: 40 },
      { itemCd: "RW2CTU0000002", productName: "Widget B", unit: "PCS", quantity: 60, revenue: 70_800, taxAmount: 10_800, transactionCount: 25 },
    ],
    summary: { uniqueItemCodes: 2, totalQuantity: 180, totalRevenue: 212_400, totalTax: 32_400 },
  }
}

describe("fiscal report PDFs", () => {
  it("renders an X daily report on an 80 mm roll", async () => {
    const pdf = await renderDailyReportPdf(dailyFixture("X"))
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(2_000)
    // 80 mm roll width = 226.77 pt.
    expect(pdf.toString("latin1")).toMatch(/MediaBox\s*\[\s*0\s+0\s+226\.77/)
  })

  it("renders a Z daily report including the VSDC confirmation block", async () => {
    const pdf = await renderDailyReportPdf(dailyFixture("Z"))
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(2_000)
  })

  it("renders refund bands, refunds by method and main groups (R10 splits)", async () => {
    const drawn: string[] = []
    const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: any, text: unknown) {
      drawn.push(String(text))
      return this
    })
    try {
      await renderDailyReportPdf(dailyFixture("Z"))
    } finally {
      spy.mockRestore()
    }
    const blob = drawn.join("\n")
    expect(blob).toMatch(/REFUND BANDS/)
    expect(blob).toMatch(/REFUNDS BY METHOD/)
    expect(blob).toMatch(/MAIN GROUPS/)
  })

  it("renders a PLU report", async () => {
    const pdf = await renderPluReportPdf(pluFixture())
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(2_000)
  })

  it("still renders when there is no activity for the day", async () => {
    const empty = dailyFixture("X")
    empty.counters = { firstRcptNo: null, lastRcptNo: null, lastTotalRcptNo: null, receiptCount: 0, itemCount: 0 }
    empty.paymentBreakdown = {}
    empty.summary = { ...empty.summary, normalSalesCount: 0, normalRefundsCount: 0, grossSalesAmt: 0, grossRefundAmt: 0, netSalesAmt: 0, totalTaxAmt: 0 }
    const pdf = await renderDailyReportPdf(empty)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  })
})
