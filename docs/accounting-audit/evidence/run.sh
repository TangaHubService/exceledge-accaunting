#!/bin/sh
# Run from Backend/. Recreates the throwaway database exceledge_audit on the DATABASE_URL server, then runs the audit harness.
URL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"'); BASE=${URL%%\?*}
psql "${BASE%/*}/postgres" -qc 'DROP DATABASE IF EXISTS exceledge_audit' -c 'CREATE DATABASE exceledge_audit'
export DATABASE_URL="${BASE%/*}/exceledge_audit?schema=public"; npx prisma migrate deploy >/dev/null 2>&1
MAIL_TRANSPORT=json npx tsx ../docs/accounting-audit/evidence/audit-scenarios.ts > ../docs/accounting-audit/evidence/run.txt 2>&1
