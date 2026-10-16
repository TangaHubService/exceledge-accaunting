const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const domainDir = path.resolve(__dirname, "../packages/domain");
const entry = path.join(domainDir, "dist", "index.js");
if (fs.existsSync(entry)) {
  console.log("[prebuild] domain dist exists, skipping rebuild");
  process.exit(0);
}
if (!fs.existsSync(path.join(domainDir, "package.json"))) {
  console.error("[prebuild] ERROR: domain not found at " + domainDir + " (Dokploy Root Directory should be frontend)");
  process.exit(1);
}
console.log("[prebuild] building @exceledge/accounting-domain...");
execSync("npm run build", { cwd: domainDir, stdio: "inherit" });
