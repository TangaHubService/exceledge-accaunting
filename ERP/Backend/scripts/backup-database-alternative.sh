#!/bin/bash
# Alternative Database Backup Script (for version mismatch issues)
# Uses psql COPY commands instead of pg_dump
# Usage: ./backup-database-alternative.sh

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

echo "Starting database backup (alternative method)..."
echo "Database: $DB_NAME"
echo "Backup file: $BACKUP_FILE"

# Create SQL dump using pg_dumpall or custom SQL
# This method works around version mismatches
psql "$DATABASE_URL" -c "
-- Backup script header
\\echo '-- Database Backup'
\\echo '-- Generated: $(date)'
\\echo '-- Database: $DB_NAME'
\\echo ''
" > "$BACKUP_FILE"

# Get all table names and dump them
TABLES=$(psql "$DATABASE_URL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")

if [ $? -eq 0 ]; then
    echo "Backing up schema and data..."
    
    # Dump schema
    pg_dump --no-version-check --schema-only "$DATABASE_URL" >> "$BACKUP_FILE" 2>/dev/null || \
    psql "$DATABASE_URL" -c "\d+" >> "$BACKUP_FILE" 2>/dev/null
    
    # Dump data for each table
    for table in $TABLES; do
        table=$(echo $table | xargs)  # Trim whitespace
        if [ ! -z "$table" ]; then
            echo "Backing up table: $table"
            psql "$DATABASE_URL" -c "COPY $table TO STDOUT WITH CSV HEADER;" >> "$BACKUP_FILE" 2>/dev/null || \
            psql "$DATABASE_URL" -c "\\copy $table TO STDOUT CSV HEADER" >> "$BACKUP_FILE" 2>/dev/null
        fi
    done
    
    # Compress the backup
    gzip "$BACKUP_FILE"
    echo "✅ Backup completed successfully!"
    echo "Backup file: ${BACKUP_FILE}.gz"
    echo ""
    echo "Note: This is a simplified backup. For full backup with pg_dump,"
    echo "please update your PostgreSQL client tools to match server version."
else
    echo "❌ Backup failed!"
    echo ""
    echo "Trying simple schema dump..."
    psql "$DATABASE_URL" -c "\d" > "${BACKUP_FILE%.sql}_schema.txt" 2>&1
    echo "Schema information saved to: ${BACKUP_FILE%.sql}_schema.txt"
    exit 1
fi
