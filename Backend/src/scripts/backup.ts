import "../config/env";
import { autonomousPrisma } from "../lib/prisma";
import { runBackup } from "../modules/platform/backup.service";

/** npm run backup [-- --no-verify]: dumps the database to BACKUP_DIR and proves it restores. */
runBackup(undefined, { verify: !process.argv.includes("--no-verify") })
  .then((r) => console.log(`${r.file} (${r.sizeBytes} bytes, sha256 ${r.sha256})${r.verified ? ", restore verified" : ""}`))
  .catch((e) => {
    console.error(`Backup failed: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => autonomousPrisma.$disconnect());
