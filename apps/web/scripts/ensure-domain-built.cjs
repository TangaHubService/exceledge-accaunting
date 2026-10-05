/**
 * Prebuild helper: ensure @exceledge/accounting-domain dist exists.
 *
 * Why not `npm run build -w @exceledge/accounting-domain`?
 * Nixpacks ships npm 9, where a `-w` script nested inside another `-w`
 * invocation (root `npm run build -w web` -> web `prebuild -w domain`)
 * fails with "No workspaces found". Invoking the domain build by directory
 * (cwd) avoids workspace-flag nesting entirely and works on npm 9/10/11
 * regardless of which directory the build is launched from.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Resolved from this file's location, not cwd — robust to whatever
// cwd npm / Nixpacks invokes the prebuild with.
const domainDir = path.resolve(__dirname, "../../../packages/domain");
const entry = path.join(domainDir, "dist", "index.js");

if (fs.existsSync(entry)) {
  console.log("[prebuild] domain dist exists, skipping rebuild");
  process.exit(0);
}

if (!fs.existsSync(path.join(domainDir, "package.json"))) {
  console.error(
    "[prebuild] ERROR: domain package not found at " +
      domainDir +
      ". The build context must be the repository root (it contains package.json with workspaces). " +
      "In Dokploy, set the application's Root Directory to the repo root (empty value)."
  );
  process.exit(1);
}

console.log("[prebuild] building @exceledge/accounting-domain...");
execSync("npm run build", { cwd: domainDir, stdio: "inherit" });
