# Database Backup & Restore

This document captures the steps that keep a working backup and lets you roll the schema/data back when needed.

## Backup

1. Ensure `server/.env` (or your environment) defines `DATABASE_URL`. If needed, copy `.env.example` and fill in the credentials.
2. From the `server` directory run:

   ```bash
   ./scripts/backup-database.sh
   ```

   The script exports the current `DATABASE_URL`, creates `backups/`, and writes `backup_<dbname>_<timestamp>.sql.gz`. It first tries `pg_dump --no-version-check` and falls back to a standard `pg_dump` if the flag fails.
3. If you cannot run `pg_dump --no-version-check` (e.g., newer PostgreSQL server), use the alternative script that also creates a `.sql.gz` file but avoids the unsupported flag:

   ```bash
   ./scripts/backup-database-alternative.sh
   ```

4. Store the generated `.sql.gz` file outside the project (S3, network share, etc.) and document the timestamp/version in your deployment notes.

## Restore

1. Copy the desired backup (e.g., `backup_inventory_20260122_220231.sql.gz`) back into `server/backups/` if needed.
2. Decompress it:

   ```bash
   gunzip backups/backup_<dbname>_<timestamp>.sql.gz
   ```

3. Restore the dump once the decompressed `.sql` file is ready:

   ```bash
   psql "$DATABASE_URL" < backups/backup_<dbname>_<timestamp>.sql
   ```

   Use the same `DATABASE_URL` as your target environment (set via the `.env` file or process environment). The scripts default to `postgresql://postgres:123@localhost:5432/inventory` when the variable is missing.
4. Re-apply any application-specific migrations/seeds if the dump does not include the latest Prisma migration metadata:

   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```

5. After restoring, run `npm run prisma:generate` and `npm run build` to synchronize generated clients if you changed the schema.
