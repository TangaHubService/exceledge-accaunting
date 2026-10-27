/**
 * Post-seed EBM bootstrap: initialize device, sync master data, push all
 * products to VSDC, and top up purchase-code pools. Safe to re-run.
 *
 *   npx tsx scripts/post-seed-ebm.ts [organizationId]
 */
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { syncAllRraMasterData } from "../src/services/rra-master-data.service"
import { syncProductToRra } from "../src/services/product-sync.service"
import { initializeVsdcDevice } from "../src/services/vsdc-init.service"
import { generateValidPurchaseCodes } from "../src/services/purchase-code.checksum"
import { walkInCustTin } from "../src/services/rra-ebm.service"
import { syncInsuranceToRra } from "../src/services/rra-branch-sync.service"

dotenv.config()

const prisma = new PrismaClient()

async function resolveOrg(orgArg?: string) {
  const orgId = orgArg ? parseInt(orgArg, 10) : null
  if (orgArg && !Number.isInteger(orgId)) throw new Error(`Invalid organizationId: ${orgArg}`)
  return (
    (orgId ? await prisma.organization.findUnique({ where: { id: orgId! } }) : null)
    ?? (await prisma.organization.findFirst({ where: { name: { contains: "demo", mode: "insensitive" } } }))
    ?? (await prisma.organization.findFirst())
  )
}

async function topUpCodes(organizationId: number, sellerTin: string, buyerTin: string, count: number) {
  const existing = await prisma.organizationPurchaseCode.findMany({
    where: { organizationId },
    select: { code: true },
  })
  const existingCodes = new Set(existing.map((c) => c.code))
  const codes = generateValidPurchaseCodes(buyerTin, sellerTin, count, existingCodes)
  let created = 0
  for (const code of codes) {
    try {
      await prisma.organizationPurchaseCode.create({
        data: { organizationId, code, buyerTin },
      })
      created += 1
    } catch {
      /* unique collision — skip */
    }
  }
  console.log(`  purchase codes for ${buyerTin}: +${created} (wanted ${count})`)
}

async function main() {
  const org = await resolveOrg(process.argv[2])
  if (!org) throw new Error("No organization found — run prisma seed first")
  if (!org.TIN) throw new Error(`Organization ${org.id} has no TIN`)

  const branch =
    (await prisma.branch.findFirst({
      where: { organizationId: org.id, isDefault: true },
    }))
    ?? (await prisma.branch.findFirst({
      where: { organizationId: org.id, ebmSerialNo: { not: null } },
      orderBy: { id: "asc" },
    }))
    ?? (await prisma.branch.findFirst({
      where: { organizationId: org.id },
      orderBy: { id: "asc" },
    }))
  if (!branch) throw new Error(`Organization ${org.id} has no branch`)

  // Ensure the fiscal branch is marked default for future runs.
  if (!branch.isDefault) {
    await prisma.branch.updateMany({ where: { organizationId: org.id }, data: { isDefault: false } })
    await prisma.branch.update({ where: { id: branch.id }, data: { isDefault: true } })
  }

  console.log(`Post-seed EBM bootstrap for org=${org.id} (${org.name}) branch=${branch.id}`)

  // 1) Device init
  try {
    const init = await initializeVsdcDevice(org.id, branch.id)
    console.log(`  device init: ${init.success ? "OK" : `FAILED — ${init.error}`}`)
  } catch (e: any) {
    console.warn(`  device init skipped/failed: ${e?.message ?? e}`)
  }

  // 2) Master data
  try {
    const md = await syncAllRraMasterData(org.id, branch.id)
    for (const o of md) {
      console.log(`  master data ${o.resource}: ok=${o.ok} fetched=${o.fetched} upserted=${o.upserted}${o.error ? ` error=${o.error}` : ""}`)
    }
  } catch (e: any) {
    console.warn(`  master data sync failed: ${e?.message ?? e}`)
  }

  // 3) Push products
  const products = await prisma.product.findMany({
    where: { organizationId: org.id, deletedAt: null, itemCd: { not: null }, itemClsCd: { not: null } },
    select: { id: true, name: true, itemCd: true },
  })
  let synced = 0
  let failed = 0
  for (const p of products) {
    const res = await syncProductToRra(p.id, undefined, branch.id)
    if (res.success) synced += 1
    else {
      failed += 1
      console.warn(`  product sync failed #${p.id} ${p.name} (${p.itemCd}): ${res.error}`)
    }
  }
  console.log(`  products synced: ${synced} ok / ${failed} failed / ${products.length} total`)

  // 4) Push insurance companies
  const insurers = await prisma.customer.findMany({
    where: { organizationId: org.id, customerType: "INSURANCE", deletedAt: null, isrccCd: { not: null } },
    select: { id: true, name: true },
  })
  for (const c of insurers) {
    const res = await syncInsuranceToRra(org.id, c.id, { branchId: branch.id })
    console.log(`  insurance ${c.name}: ${res.success ? "OK" : res.error}`)
  }

  // 5) Top up purchase-code pools
  const walkIn = await prisma.customer.findFirst({
    where: { organizationId: org.id, name: { contains: "Walk-in" }, deletedAt: null },
    select: { id: true },
  })
  console.log("  topping up purchase codes…")
  await topUpCodes(org.id, org.TIN, "100000000", 30)
  if (walkIn) await topUpCodes(org.id, org.TIN, walkInCustTin(walkIn.id), 40)
  await topUpCodes(org.id, org.TIN, "100000001", 10)

  console.log("Done.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
