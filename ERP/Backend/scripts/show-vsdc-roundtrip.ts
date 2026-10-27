/**
 * Manual verification script (NOT part of the automated suite):
 * prints the FULL VSDC sales payload, then runs the FULL round-trip through
 * the real code — vsdcRequestBody → saveInvc (mock transport, no network) →
 * parseVsdcResponse on a realistic VSDC success body → the fiscal record +
 * QR string the invoice prints.
 *
 * Run:  EBM_USE_MOCK=true npx tsx scripts/show-vsdc-roundtrip.ts
 * (from Backend/). Requires temp/invoice-samples/ from generate-invoice-samples.ts.
 */
import { promises as fs } from "fs"
import path from "path"
import {
  saveInvc,
  parseVsdcResponse,
  parseVsdcStatusCode,
  vsdcRequestBody,
} from "../src/services/vsdc-api.service"

const OUT = path.resolve(process.cwd(), "temp/invoice-samples")

/** CIS/VSDC spec §4.2 QR string — identical to the backend invoice composer:
 * ddmmyyyy#hhmmss#sdcId#sdcRcptNo#internalData#receiptSignature */
function buildRraQrString(p: {
  sdcDateTime: string | Date
  sdcId: string
  sdcRcptNo: number | string
  internalData: string
  receiptSignature: string
}): string {
  const dt = p.sdcDateTime instanceof Date ? p.sdcDateTime : new Date(p.sdcDateTime)
  const p2 = (x: number) => String(x).padStart(2, "0")
  return [
    `${p2(dt.getDate())}${p2(dt.getMonth() + 1)}${dt.getFullYear()}`,
    `${p2(dt.getHours())}${p2(dt.getMinutes())}${p2(dt.getSeconds())}`,
    p.sdcId,
    String(p.sdcRcptNo),
    p.internalData,
    p.receiptSignature,
  ].join("#")
}

async function main(): Promise<void> {
  const payload = JSON.parse(
    await fs.readFile(path.join(OUT, "01-NS-normal-original.vsdc-payload.json"), "utf8"),
  ) as Record<string, unknown>

  console.log("\n================ 1. FULL VSDC REQUEST PAYLOAD (TrnsSalesSaveWrReq) ================\n")
  console.log(JSON.stringify(payload, null, 2))

  // Real envelope assembly + real sender (mock transport returns a VSDC-shaped
  // success without touching the network when EBM_USE_MOCK=true).
  const envelope = { tin: "100000001", bhfId: "00", sdcId: "SDC010000001", mrcNo: "MRC010000001", dvcSrlNo: "MRC010000001", env: "sandbox" }
  console.log("\n================ 2. WIRE BODY (vsdcRequestBody: tin+bhfId+payload) ================\n")
  const wire = vsdcRequestBody(envelope, payload)
  console.log(`keys: ${Object.keys(wire).join(", ")} | tin=${wire.tin} bhfId=${wire.bhfId}`)
  const sent = await saveInvc(envelope, payload)
  console.log(`saveInvc → success=${sent.success} rawStatus=${sent.rawStatus}`)

  // Realistic VSDC success body, RRA VSDC API v1.0.5 §3.3.6.1 shape.
  const rawSuccess = {
    resultCd: "000",
    resultMsg: "It is succeeded",
    resultDt: "20260915103000",
    data: {
      rcptNo: "12",
      intrlData: "ABCD1234EFGH5678",
      rcptSign: "SIGNA9876TURE5432",
      totRcptNo: "20",
      vsdcRcptPbctDate: "20260915103000",
      sdcId: "SDC010000001",
      mrcNo: "MRC010000001",
    },
  }
  console.log("\n================ 3. VSDC RAW SUCCESS BODY ================\n")
  console.log(JSON.stringify(rawSuccess, null, 2))

  const status = parseVsdcStatusCode(rawSuccess)
  const vsdc = parseVsdcResponse(rawSuccess)
  console.log("\n================ 4. PARSED (parseVsdcStatusCode + parseVsdcResponse) ================\n")
  console.log(JSON.stringify({ status, vsdc }, null, 2))

  // What the outbox worker persists on the EBM transaction + what the invoice prints.
  const sdcRcptNo = parseInt(vsdc.rcptNo, 10)
  const totalRcptNo = parseInt(vsdc.totRcptNo, 10)
  const qr = buildRraQrString({
    sdcDateTime: vsdc.sdcDateTime,
    sdcId: vsdc.sdcId,
    sdcRcptNo,
    internalData: vsdc.intrlData,
    receiptSignature: vsdc.vsdcSignature,
  })
  console.log("\n================ 5. FISCAL RECORD STORED + PRINTED ON THE INVOICE ================\n")
  console.log(JSON.stringify({
    ebmInvoiceNumber: String((payload.invcNo as number) ?? ""),
    sdcId: vsdc.sdcId,
    sdcRcptNo,
    totalRcptNo,
    internalData: vsdc.intrlData,
    receiptSignature: vsdc.vsdcSignature,
    sdcDateTime: vsdc.sdcDateTime,
    mrcNo: vsdc.mrcNo,
    printedReceiptCounter: `${sdcRcptNo}/${totalRcptNo} NS`,
    printedBottomReceiptNumber: `RECEIPT NUMBER:${payload.invcNo}`,
    qrString: qr,
  }, null, 2))
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
