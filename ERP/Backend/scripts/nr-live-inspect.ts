/**
 * Manual live-NR helper: dump the outbox row + EbmTransaction for a refund
 * sale so the actual VSDC request/response can be reviewed.
 *
 * Run (from Backend/):  npx tsx scripts/nr-live-inspect.ts <refundSaleId>
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"

async function main() {
  const saleId = Number(process.argv[2])
  if (!saleId) throw new Error("usage: nr-live-inspect.ts <refundSaleId>")

  const outbox = await prisma.ebmOutbox.findMany({ where: { saleId }, orderBy: { id: "asc" } })
  const txs = await prisma.ebmTransaction.findMany({ where: { saleId }, orderBy: { id: "asc" } })
  console.log(JSON.stringify({ outbox, ebmTransactions: txs }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
