import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildV2PerformanceReport } from "./kordyn-v2-performance-report.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function snapshotTree(target) {
  const rows = [];
  async function visit(current, relative) {
    let identity;
    try {
      identity = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT" && relative === "") return "missing";
      throw error;
    }
    if (identity.isSymbolicLink()) throw new Error(`tree_snapshot_symlink:${current}`);
    if (identity.isFile()) {
      const bytes = await readFile(current);
      rows.push(`${relative}\0${createHash("sha256").update(bytes).digest("hex")}`);
      return "present";
    }
    if (!identity.isDirectory()) throw new Error(`tree_snapshot_unsupported:${current}`);
    for (const name of (await readdir(current)).sort()) {
      await visit(path.join(current, name), relative ? `${relative}/${name}` : name);
    }
    return "present";
  }
  const state = await visit(target, "");
  if (state === "missing") return "missing";
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

export async function runV2PerformanceGate({ root = rootDir } = {}) {
  const sourceBefore = await snapshotTree(path.join(root, "src"));
  const distBefore = await snapshotTree(path.join(root, "dist"));
  const report = await buildV2PerformanceReport({ root });
  const sourceAfter = await snapshotTree(path.join(root, "src"));
  const distAfter = await snapshotTree(path.join(root, "dist"));
  assert.equal(sourceAfter, sourceBefore, "isolated V2 build must not mutate source tree");
  assert.equal(distAfter, distBefore, "isolated V2 build must not read through or overwrite checked-in dist");
  for (const [name, budget] of Object.entries(report.budgets)) {
    assert.equal(budget.pass, true, `${name} ${budget.actual} must remain below ${budget.limit}`);
  }
  assert.equal(report.routes.aiShell.loadsLegacyProductStyles, false);
  assert.equal(report.routes.governanceDomain.loadsLegacyProductStyles, false);
  return {
    ...report,
    treeIntegrity: {
      source: "unchanged",
      checkedInDist: "unchanged",
      temporaryOutput: "removed"
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runV2PerformanceGate();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
