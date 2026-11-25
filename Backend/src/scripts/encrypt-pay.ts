import { env } from "../config/env";
import { autonomousPrisma as db } from "../lib/prisma";
import { openEmployee, sealEmployee } from "../modules/workspace/employee-privacy";

/** npm run encrypt-pay: encrypts employees saved before FIELD_ENCRYPTION_KEY was set. Safe to run again. */
async function main() {
  if (!env.fieldEncryptionKey) throw new Error("Set FIELD_ENCRYPTION_KEY first");
  const rows = await db.employee.findMany();
  for (const row of rows) {
    const { nationalId, bankName, accountHolder, accountNumber, tin, rssb, basicSalary } = openEmployee(row);
    await db.employee.update({ where: { id: row.id }, data: sealEmployee({ nationalId, bankName, accountHolder, accountNumber, tin, rssb, basicSalary }) });
  }
  console.log(`${rows.length} employee(s) encrypted`);
}
main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
