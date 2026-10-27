/**
 * Tops up an organization's RRA purchase-code pool (organization_purchase_codes)
 * so B2B test sales don't get blocked once the seeded codes run out.
 *
 * These codes stand in for codes the buyer's own VSDC/OSDC would issue in
 * production (see consumeOrgPurchaseCode / consumeAnyOrgPurchaseCode in
 * src/services/rra-ebm.service.ts). Codes are buyer-scoped: the sandbox binds
 * each code's checksum to the buyer TIN it was generated for and rejects
 * cross-buyer codes with 882, so always top up for the exact buyer TIN that
 * will be submitted. Idempotent: skips any code that already exists for the
 * organization.
 *
 * Usage:
 *   npx tsx scripts/topup-purchase-codes.ts [organizationId] [buyerTin] [count]
 *
 * Defaults:
 *   organizationId -> first org (preferring name containing "test" or "demo")
 *   buyerTin       -> "100000000" (the seeded sandbox B2B test TIN)
 *   count          -> 20
 */
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { generateValidPurchaseCodes, isValidPurchaseCode } from "../src/services/purchase-code.checksum"

dotenv.config()

const prisma = new PrismaClient()

const DEFAULT_BUYER_TIN = "100000000"
const DEFAULT_COUNT = 20

async function main() {
  const [orgArg, buyerTinArg, countArg] = process.argv.slice(2)

  let orgId = orgArg ? parseInt(orgArg, 10) : null
  if (orgArg && !Number.isInteger(orgId)) {
    throw new Error(`Invalid organizationId: "${orgArg}"`)
  }

  const buyerTin = buyerTinArg?.trim() || DEFAULT_BUYER_TIN

  const count = countArg ? parseInt(countArg, 10) : DEFAULT_COUNT
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Invalid count: "${countArg}"`)
  }

  let org = orgId
    ? await prisma.organization.findUnique({ where: { id: orgId } })
    : null

  if (!org) {
    org =
      (await prisma.organization.findFirst({
        where: { name: { contains: "test", mode: "insensitive" } },
      })) ??
      (await prisma.organization.findFirst({
        where: { name: { contains: "demo", mode: "insensitive" } },
      })) ??
      (await prisma.organization.findFirst())
  }

  if (!org) {
    throw new Error("No organization found. Create one first (e.g. npm run prisma:seed).")
  }

  const sellerTin = org.TIN?.trim()
  if (!sellerTin) {
    throw new Error(`Organization "${org.name}" (id=${org.id}) has no TIN — required to derive valid purchase codes.`)
  }

  // Existing codes for this org, so we generate fresh ones instead of colliding
  // with (org.id, code) unique constraint on repeated runs.
  const existing = await prisma.organizationPurchaseCode.findMany({
    where: { organizationId: org.id },
    select: { code: true },
  })
  const existingCodes = new Set(existing.map((c) => c.code))

  // Generate codes that satisfy the sandbox's TIN-derived checksum — sequential
  // numbers (the old behavior) are rejected with resultCd 882.
  const newCodes = generateValidPurchaseCodes(buyerTin, sellerTin, count, existingCodes)

  await prisma.organizationPurchaseCode.createMany({
    data: newCodes.map((code) => ({
      organizationId: org!.id,
      code,
      buyerTin,
    })),
  })

  const poolCount = await prisma.organizationPurchaseCode.count({
    where: { organizationId: org.id, buyerTin, consumed: false },
  })

  console.log("Purchase-code pool topped up:")
  console.log(`  Organization      : ${org.name} (id=${org.id})`)
  console.log(`  Seller TIN        : ${sellerTin}`)
  console.log(`  Buyer TIN         : ${buyerTin}`)
  console.log(`  Codes added       : ${newCodes.length} (${newCodes[0] ?? 'none'}..${newCodes[newCodes.length - 1] ?? ''})`)
  console.log(`  All checksum-valid: ${newCodes.every((c) => isValidPurchaseCode(c, buyerTin, sellerTin))}`)
  console.log(`  Unconsumed in pool: ${poolCount}`)
}

main()
  .catch((e) => {
    console.error("Failed to top up purchase codes:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
