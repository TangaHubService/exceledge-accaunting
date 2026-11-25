#!/bin/sh
# Run from Backend/ with DATABASE_URL on a throwaway server. Recreates the database exceledge_audit there, then runs the audit harness.
: "${DATABASE_URL:?Set DATABASE_URL to a throwaway server}"
BASE=${DATABASE_URL%%\?*}
psql "${BASE%/*}/postgres" -qc 'DROP DATABASE IF EXISTS exceledge_audit' -c 'CREATE DATABASE exceledge_audit'
export DATABASE_URL="${BASE%/*}/exceledge_audit?schema=public"; npx prisma migrate deploy >/dev/null 2>&1
MAIL_TRANSPORT=json npx tsx ../docs/accounting-audit/evidence/audit-scenarios.ts > ../docs/accounting-audit/evidence/run.txt 2>&1
