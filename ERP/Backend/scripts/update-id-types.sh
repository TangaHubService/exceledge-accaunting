#!/bin/bash
# Script to help identify files that need ID type updates
# This script finds patterns that indicate string ID usage

echo "Searching for files that may need ID type updates..."

# Find files with req.params.organizationId (without parseInt)
echo "=== Files with organizationId params (may need parseInt) ==="
grep -r "req\.params\.organizationId" --include="*.ts" --include="*.tsx" server/src/ | grep -v "parseInt" | cut -d: -f1 | sort -u

echo ""
echo "=== Files with id params (may need parseInt) ==="
grep -r "req\.params\.id" --include="*.ts" --include="*.tsx" server/src/ | grep -v "parseInt" | cut -d: -f1 | sort -u

echo ""
echo "=== Files with string ID types in interfaces ==="
grep -r "id:.*string" --include="*.ts" --include="*.tsx" inventory-system-fn/src/ | grep -i "interface\|type" | cut -d: -f1 | sort -u

echo ""
echo "Migration helper script complete. Review the files above and update them."
