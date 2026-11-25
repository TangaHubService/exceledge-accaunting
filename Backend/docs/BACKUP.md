# Backups

`npm run backup` (after `npm run build`) writes a `pg_dump` file to `BACKUP_DIR`, restores it into a scratch database, compares the counts and checks that debits equal credits, then deletes the scratch database and all but the newest `BACKUP_KEEP` files (14). The database user needs `CREATEDB`; without it use `npm run backup -- --no-verify`.

With `BACKUP_DIR` set, the API also does this once a day. Results are on the Backups page. Put `BACKUP_DIR` on storage outside this server; the files hold every company's books and are not encrypted.

`pg_dump` must be at least the server's PostgreSQL version. The Docker image carries version 17.

## Restoring

1. Stop the API.
2. `createdb exceledge_restored`
3. `pg_restore --no-owner --no-privileges --exit-on-error --dbname exceledge_restored <file>`
4. Point `DATABASE_URL` at it and start the API. Migrations run on start. Keep the old database until the books are checked.

Uploaded files (`DOCUMENT_STORAGE_DIR` or S3) and `FIELD_ENCRYPTION_KEY` are not in the dump. Back them up separately; without the key, encrypted pay details can't be read.

## Pay encryption

Generate a key with `openssl rand -base64 32`, set `FIELD_ENCRYPTION_KEY`, restart, then run `npm run encrypt-pay` once. Until a key is set, pay details stay readable in the database.
