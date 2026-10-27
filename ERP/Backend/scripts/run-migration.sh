#!/bin/bash
# Run UUID to Integer ID Migration
# Usage: ./run-migration.sh

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get database URL from environment or use default
DATABASE_URL=${DATABASE_URL:-"postgresql://postgres:123@localhost:5432/inventory"}

echo "=========================================="
echo "UUID to Integer ID Migration"
echo "=========================================="
echo ""
echo "WARNING: This will modify your database structure!"
echo "Make sure you have a backup before proceeding."
echo ""
read -p "Have you backed up your database? (yes/y/no): " backup_confirm

backup_confirm_lower=$(echo "$backup_confirm" | tr '[:upper:]' '[:lower:]')

if [ "$backup_confirm_lower" != "yes" ] && [ "$backup_confirm_lower" != "y" ]; then
    echo "Migration cancelled. Please backup your database first."
    exit 1
fi

echo ""
echo "Step 1: Running data migration script..."
psql "$DATABASE_URL" -f prisma/migrations/uuid_to_int_migration.sql

if [ $? -eq 0 ]; then
    echo "✅ Data migration completed successfully!"
    echo ""
    echo "Step 2: Verifying data migration..."
    echo "Checking if new_id columns are populated..."
    
    # Check a few key tables
    psql "$DATABASE_URL" -c "SELECT COUNT(*) as org_count, COUNT(new_id) as new_id_count FROM organizations;" -t
    psql "$DATABASE_URL" -c "SELECT COUNT(*) as user_count, COUNT(new_id) as new_id_count FROM users;" -t
    psql "$DATABASE_URL" -c "SELECT COUNT(*) as sale_count, COUNT(new_id) as new_id_count FROM sales;" -t
    
    echo ""
    echo "✅ Data migration verification complete!"
    echo ""
    echo "Next steps:"
    echo "1. Review the data above to ensure all new_id columns are populated"
    echo "2. Run: cd server && npx prisma migrate dev --name uuid_to_integer_ids"
    echo "3. Run: npx prisma generate"
    echo "4. Update remaining controllers and frontend components"
else
    echo "❌ Data migration failed!"
    echo "Please check the error messages above."
    exit 1
fi
