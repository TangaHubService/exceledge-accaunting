const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const domainDir = path.resolve(__dirname, "../packages/domain");
if (!fs.existsSync(path.join(domainDir, "package.json"))) {
  console.error("[prebuild] ERROR: domain not found at " + domainDir + " (Dokploy Root Directory should be backend)");
  process.exit(1);
}
// Always rebuild from a clean dist: a leftover or cached dist (say, from an older module format) must not ship.
fs.rmSync(path.join(domainDir, "dist"), { recursive: true, force: true });
console.log("[prebuild] building @exceledge/accounting-domain...");
execSync("npm run build", { cwd: domainDir, stdio: "inherit" });
