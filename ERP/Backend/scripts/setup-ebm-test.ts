/**
 * Loads the RRA EBM sandbox test credentials into an existing organization/branch
 * so the app can submit sales to the RRA test VSDC server.
 *
 * Test credentials from the RRA EBM Certification team:
 *   tin: 999945560
 *   bhfId: 00
 *   dvcSrlNo: excelwartest
 *   Test API server: https://sdcsandbox.rra.gov.rw
 *
 * Mapping to the data model (see src/services/vsdc-api.service.ts buildVsdcEnvelope):
 *   tin       -> Organization.TIN
 *   bhfId     -> Branch.bhfId
 *   dvcSrlNo  -> Branch.ebmSerialNo  (envelope sends dvcSrlNo = mrcNo = ebmSerialNo)
 *
 * Usage (optional args):
 *   npx tsx scripts/setup-ebm-test.ts [organizationId] [branchCode]
 *
 * If organizationId is omitted, the first org (preferring name containing
 * "test" or "demo") is used. If branchCode is omitted, the org's default branch
 * is used, falling back to its first branch. Idempotent — safe to re-run.
 */
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"

dotenv.config()

const prisma = new PrismaClient()

const TEST_TIN = process.env.EBM_DEFAULT_TIN || "";
const TEST_BHF_ID = process.env.EBM_DEFAULT_BHF_ID || "00";
const TEST_DVC_SRL_NO = process.env.EBM_DEFAULT_DVC_SRL_NO || "excelwartest";

async function main() {
  const [orgArg, branchCodeArg] = process.argv.slice(2)

  let orgId = orgArg ? parseInt(orgArg, 10) : null
  if (orgId && !Number.isInteger(orgId)) {
    throw new Error(`Invalid organizationId: "${orgArg}"`)
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

  let branch = branchCodeArg
    ? await prisma.branch.findFirst({
        where: { organizationId: org.id, code: branchCodeArg },
      })
    : null

  if (!branch) {
    branch =
      (await prisma.branch.findFirst({
        where: { organizationId: org.id, isDefault: true },
      })) ??
      (await prisma.branch.findFirst({ where: { organizationId: org.id } }))
  }

  if (!branch) {
    throw new Error(`Organization "${org.name}" (id=${org.id}) has no branches.`)
  }

  const [updatedOrg, updatedBranch] = await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { TIN: TEST_TIN },
    }),
    prisma.branch.update({
      where: { id: branch.id },
      data: {
        bhfId: TEST_BHF_ID,
        ebmSerialNo: TEST_DVC_SRL_NO,
      },
    }),
  ])

  console.log("EBM sandbox test credentials applied:")
  console.log(`  Organization : ${updatedOrg.name} (id=${updatedOrg.id})`)
  console.log(`  TIN          : ${updatedOrg.TIN}`)
  console.log(`  Branch       : ${updatedBranch.name} (code=${updatedBranch.code}, id=${updatedBranch.id})`)
  console.log(`  bhfId        : ${updatedBranch.bhfId}`)
  console.log(`  dvcSrlNo/MRC : ${updatedBranch.ebmSerialNo}`)
  console.log("")
  console.log("Next: ensure Backend/.env has ENABLE_EBM=true and EBM_API_URL=https://sdcsandbox.rra.gov.rw,")
  console.log("then create a sale in the app to submit it to the RRA sandbox.")
}

main()
  .catch((e) => {
    console.error("Failed to set EBM test credentials:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
