/**
 * postinstall: make sure npm actually linked the workspace packages.
 *
 * Some installers/environments (older npm under production mode, layered
 * container builds) can finish `npm i` without the
 * node_modules/@exceledge/* symlinks, which later fails the TypeScript build
 * with "Cannot find module '@exceledge/accounting-domain'". This repairs
 * those links deterministically; it is a no-op when they already exist.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const links = [
  ["apps/api", "@exceledge/accounting-domain", "../../packages/domain"],
  ["apps/web", "@exceledge/accounting-domain", "../../packages/domain"],
];

let fixed = 0;
for (const [scopeDir, name, target] of links) {
  const linkPath = path.join(root, "node_modules", ...name.split("/"));
  let ok = false;
  try {
    ok = fs.readlinkSync(linkPath) === target;
  } catch {
    ok = false;
  }
  if (ok) continue;
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    const type = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(target, linkPath, type);
    fixed += 1;
    console.log(`[ensure-workspace-links] repaired ${name} for ${scopeDir}`);
  } catch (err) {
    console.warn(`[ensure-workspace-links] could not link ${name}: ${err.message}`);
  }
}
if (!fixed) console.log("[ensure-workspace-links] workspace links ok");
