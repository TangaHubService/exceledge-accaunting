#!/usr/bin/env node
/** Copy backend/packages/domain → frontend/packages/domain (keep both deploy roots in sync). */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "backend", "packages", "domain");
const dest = path.join(root, "frontend", "packages", "domain");

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(src, "package.json"))) {
  console.error("Missing", src);
  process.exit(1);
}
rimraf(dest);
copyDir(src, dest);
console.log("Synced domain → frontend/packages/domain");
