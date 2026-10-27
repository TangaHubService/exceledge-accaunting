#!/bin/bash
# Database Backup Script
# Usage: ./backup-database.sh

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get database URL from environment or use default
DATABASE_URL=${DATABASE_URL:-"postgresql://postgres:123@localhost:5432/inventory"}

# Extract database name from URL
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

# Create backup directory if it doesn't exist
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR

# Generate backup filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_${DB_NAME}_${TIMESTAMP}.sql"

echo "Starting database backup..."
echo "Database: $DB_NAME"
echo "Backup file: $BACKUP_FILE"

# Perform backup using pg_dump
# Try with --no-version-check flag first (for version mismatches)
pg_dump --no-version-check "$DATABASE_URL" > "$BACKUP_FILE" 2>&1

if [ $? -ne 0 ]; then
    echo "Warning: pg_dump with --no-version-check failed, trying without flag..."
    # Try without the flag
    pg_dump "$DATABASE_URL" > "$BACKUP_FILE" 2>&1
fi

if [ $? -eq 0 ]; then
    echo "Backup completed successfully!"
    echo "Backup file: $BACKUP_FILE"
    # Compress the backup
    gzip "$BACKUP_FILE"
    echo "Backup compressed: ${BACKUP_FILE}.gz"
    echo ""
    echo "To restore this backup, use:"
    echo "gunzip ${BACKUP_FILE}.gz"
    echo "psql \$DATABASE_URL < ${BACKUP_FILE}"
else
    echo "Backup failed due to version mismatch!"
    echo ""
    echo "Your PostgreSQL server version (17.3) is newer than pg_dump version (14.19)."
    echo ""
    echo "Options:"
    echo "1. Update pg_dump: brew upgrade postgresql@14 (or install postgresql@17)"
    echo "2. Use pg_dump from PostgreSQL 17: /usr/local/opt/postgresql@17/bin/pg_dump"
    echo "3. Or use psql to create a custom dump:"
    echo "   psql \$DATABASE_URL -c \"\\copy (SELECT * FROM organizations) TO 'backup_orgs.csv' CSV HEADER\""
    echo ""
    exit 1
fi
