#!/bin/bash

# Navigate to project folder
cd /root/apps/inventory-system/inventory-system-fn || exit

# Pull latest changes
git pull origin main

# Remove old build
rm -rf dist

# Install dependencies
yarn install

# Build frontend
yarn build

# Copy built files to Nginx folder
sudo rm -rf /var/www/erp-fn/*
sudo cp -r dist/* /var/www/erp-fn/

# Set correct permissions (optional but recommended)
sudo chown -R www-data:www-data /var/www/erp-fn
sudo chmod -R 755 /var/www/erp-fn

# Reload Nginx to serve new build
sudo systemctl reload nginx

echo "✅ Frontend updated and deployed successfully!"
