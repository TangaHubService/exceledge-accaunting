/**
 * Creates a batch of test B2B customers (business TINs, non-7-prefix) and
 * tops up a matching RRA purchase-code pool for each one, so B2B sale
 * testing isn't limited to the single seeded "Credit Wholesale Ltd" customer.
 *
 * TIN format: sandbox WAR v3.0.2 validates custTin against `^[1,9]\d{8}$`
 * (9 digits, first digit 1 or 9) and rejects 7-prefix TINs — see
 * src/services/rra-ebm.service.ts:511-514. TINs here start at 100000000,
 * matching the confirmed-working seeded value. Idempotent: an existing
 * customer with a given TIN is reused rather than duplicated, and existing
 * purchase codes are skipped when re-topping up.
 *
 * Usage:
 *   npx tsx scripts/create-test-b2b-customers.ts [organizationId] [count] [codesPerCustomer]
 *
 * Defaults:
 *   organizationId   -> first org (preferring name containing "test" or "demo")
 *   count            -> 10 customers (TINs 100000000..100000009)
 *   codesPerCustomer -> 100 purchase codes per customer's pool
 */
import dotenv from "dotenv"
import { CustomerType, PrismaClient } from "@prisma/client"
import { generateValidPurchaseCodes, isValidPurchaseCode } from "../src/services/purchase-code.checksum"

dotenv.config()

const prisma = new PrismaClient()

const TIN_BASE = 100000000
const DEFAULT_COUNT = 10
const DEFAULT_CODES_PER_CUSTOMER = 100

async function main() {
  const [orgArg, countArg, codesArg] = process.argv.slice(2)

  let orgId = orgArg ? parseInt(orgArg, 10) : null
  if (orgArg && !Number.isInteger(orgId)) {
    throw new Error(`Invalid organizationId: "${orgArg}"`)
  }

  const count = countArg ? parseInt(countArg, 10) : DEFAULT_COUNT
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Invalid count: "${countArg}"`)
  }

  const codesPerCustomer = codesArg ? parseInt(codesArg, 10) : DEFAULT_CODES_PER_CUSTOMER
  if (!Number.isInteger(codesPerCustomer) || codesPerCustomer < 0) {
    throw new Error(`Invalid codesPerCustomer: "${codesArg}"`)
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

  // Existing codes are tracked org-wide (unique on organizationId+code) so the
  // checksum-valid generator never collides with prior runs.
  const existingCodeRows = await prisma.organizationPurchaseCode.findMany({
    where: { organizationId: org.id },
    select: { code: true },
  })
  const existingCodes = new Set(existingCodeRows.map((c) => c.code))

  const sellerTin = org.TIN?.trim()
  if (!sellerTin) {
    throw new Error(`Organization "${org.name}" (id=${org.id}) has no TIN — required to derive valid purchase codes.`)
  }

  const summary: { tin: string; customerId: number; created: boolean; codesAdded: number; poolSize: number }[] = []

  for (let i = 0; i < count; i++) {
    const tin = String(TIN_BASE + i)

    let customer = await prisma.customer.findFirst({
      where: { organizationId: org.id, TIN: tin },
    })
    let created = false

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          organizationId: org.id,
          name: `Test B2B Customer ${String(i + 1).padStart(2, "0")}`,
          phone: `+250788500${String(i).padStart(3, "0")}`,
          email: `test-b2b-${i + 1}@excledge.test`,
          customerType: CustomerType.CORPORATE,
          TIN: tin,
        },
      })
      created = true
    }

    let codesAdded = 0
    if (codesPerCustomer > 0) {
      const newCodes = generateValidPurchaseCodes(tin, sellerTin, codesPerCustomer, existingCodes)

      await prisma.organizationPurchaseCode.createMany({
        data: newCodes.map((code) => ({
          organizationId: org!.id,
          code,
          buyerTin: tin,
        })),
      })
      codesAdded = newCodes.length
    }

    const poolSize = await prisma.organizationPurchaseCode.count({
      where: { organizationId: org.id, buyerTin: tin, consumed: false },
    })

    summary.push({ tin, customerId: customer.id, created, codesAdded, poolSize })
  }

  console.log(`Test B2B customers for org "${org.name}" (id=${org.id}):\n`)
  console.log("TIN        | Customer ID | Status   | Codes added | Pool size")
  console.log("-----------|-------------|----------|--------------|----------")
  for (const row of summary) {
    console.log(
      `${row.tin} | ${String(row.customerId).padEnd(11)} | ${(row.created ? "created" : "existing").padEnd(8)} | ${String(row.codesAdded).padEnd(12)} | ${row.poolSize}`
    )
  }
}

main()
  .catch((e) => {
    console.error("Failed to create test B2B customers:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
