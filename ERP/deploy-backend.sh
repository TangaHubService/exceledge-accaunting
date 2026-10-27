#!/bin/bash
set -euo pipefail

# Backend deploy script — companion to deploy.sh (which only deploys the
# frontend). Adjust the paths/process name below to match your server.

# ── Configuration — adjust these for your server ──────────────────────────
APP_DIR="/root/apps/inventory-system/Backend"   # ADJUST: path to this repo's Backend/ on the server
PM2_APP_NAME="excledge-backend"                 # ADJUST: pm2 process name (see `pm2 list`)

cd "$APP_DIR" || exit 1

# Pull latest changes
git pull origin main

# Install dependencies (matches deploy.sh's use of yarn for the frontend)
yarn install --frozen-lockfile

# Apply any pending database migrations BEFORE starting the new code —
# this was previously not automated anywhere, which is what let migration
# history and the live database drift apart silently.
npx prisma generate
npx prisma migrate deploy

# Build
yarn build

# Restart via pm2, keeping the process running across deploys.
# First-time setup on a fresh server:
#   pm2 start dist/index.js --name "$PM2_APP_NAME"
#   pm2 save
if pm2 describe "$PM2_APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  echo "pm2 process '$PM2_APP_NAME' not found — starting it for the first time."
  pm2 start dist/index.js --name "$PM2_APP_NAME"
  pm2 save
fi

echo "✅ Backend updated and deployed successfully!"
