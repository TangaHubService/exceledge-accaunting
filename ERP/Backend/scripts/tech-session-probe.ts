import { prisma } from '../src/lib/prisma'

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, TIN: true, trainingMode: true },
    take: 10,
  })
  console.log(JSON.stringify(orgs, null, 2))
  for (const o of orgs) {
    const branches = await prisma.branch.findMany({
      where: { organizationId: o.id },
      select: { id: true, code: true, bhfId: true, ebmSerialNo: true, ebmDeviceId: true, isDefault: true },
    })
    const users = await prisma.user.findMany({
      where: { organizationId: o.id },
      select: { id: true, email: true },
      take: 3,
    })
    const products = await prisma.product.findMany({
      where: {
        organizationId: o.id,
        isActive: true,
        deletedAt: null,
        itemCd: { not: null },
        itemClsCd: { not: null },
      },
      select: { id: true, name: true, itemCd: true, itemClsCd: true, taxCode: true, unitPrice: true },
      take: 5,
    })
    console.log('ORG', o.id, o.name, 'TIN', o.TIN)
    console.log(' branches', branches)
    console.log(' users', users)
    console.log(' products', products)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
