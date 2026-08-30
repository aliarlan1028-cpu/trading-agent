import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

let provenance;
let provenanceImportError = null;
try {
  provenance = await import("./helpers/kordyn-v2-account-source-provenance.mjs");
} catch (error) {
  provenanceImportError = error;
}

let comparison;
let comparisonImportError = null;
try {
  comparison = await import("../scripts/compare-kordyn-v2-concepts.mjs");
} catch (error) {
  comparisonImportError = error;
}

const git = (repo, args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

async function seedRepository() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-account-provenance-"));
  await mkdir(path.join(repo, "src/kordynV2"), { recursive: true });
  await mkdir(path.join(repo, "tests/helpers"), { recursive: true });
  await writeFile(path.join(repo, "src/kordynV2/root.js"), "export const product = true;\n");
  const captureFiles = [
    "tests/run-kordyn-v2-account-browser.mjs",
    "tests/kordyn-v2-account-browser.html",
    "tests/kordyn-v2-account-browser.jsx",
    "tests/kordyn-v2-production-fixture.js",
    "tests/helpers/kordyn-v2-account-source-provenance.mjs",
    "package.json",
    "package-lock.json",
    "vite.config.js"
  ];
  for (const file of captureFiles) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), `${file}\n`);
  }
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "task5@example.invalid"]);
  git(repo, ["config", "user.name", "Task 5"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "seed"]);
  return { repo, captureFiles };
}

test("account provenance resolves separate scoped owners and rejects tracked staged and untracked dirtiness", async () => {
  assert.ifError(provenanceImportError);
  const { repo } = await seedRepository();
  try {
    const seed = git(repo, ["rev-parse", "HEAD"]);
    const initial = provenance.resolveAccountSourceProvenance(repo);
    assert.deepEqual(initial, {
      productSourceCommit: seed,
      captureTestSourceCommit: seed
    });
    assert.deepEqual(provenance.verifyAccountSourceProvenance(repo, initial), initial);

    await writeFile(path.join(repo, "src/kordynV2/root.js"), "export const product = false;\n");
    assert.throws(() => provenance.resolveAccountSourceProvenance(repo), /dirty_product_source:.*src\/kordynV2\/root\.js/s);
    git(repo, ["restore", "--", "src/kordynV2/root.js"]);

    await writeFile(path.join(repo, "tests/run-kordyn-v2-account-browser.mjs"), "staged change\n");
    git(repo, ["add", "tests/run-kordyn-v2-account-browser.mjs"]);
    assert.throws(() => provenance.resolveAccountSourceProvenance(repo), /dirty_capture_test_source:.*tests\/run-kordyn-v2-account-browser\.mjs/s);
    git(repo, ["restore", "--staged", "--", "tests/run-kordyn-v2-account-browser.mjs"]);
    git(repo, ["restore", "--", "tests/run-kordyn-v2-account-browser.mjs"]);

    await writeFile(path.join(repo, "src/kordynV2/untracked.js"), "untracked source\n");
    assert.throws(() => provenance.resolveAccountSourceProvenance(repo), /dirty_product_source:.*src\/kordynV2\/untracked\.js/s);
    await rm(path.join(repo, "src/kordynV2/untracked.js"));

    await writeFile(path.join(repo, "src/kordynV2/root.js"), "export const product = 'second';\n");
    git(repo, ["add", "src/kordynV2/root.js"]);
    git(repo, ["commit", "-m", "product second"]);
    const productCommit = git(repo, ["rev-parse", "HEAD"]);
    const separated = provenance.resolveAccountSourceProvenance(repo);
    assert.deepEqual(separated, {
      productSourceCommit: productCommit,
      captureTestSourceCommit: seed
    });
    assert.deepEqual(provenance.verifyAccountSourceProvenance(repo, separated), separated);
    assert.throws(
      () => provenance.verifyAccountSourceProvenance(repo, { ...separated, productSourceCommit: seed }),
      /product_source_tree_mismatch/
    );
    assert.throws(
      () => provenance.verifyAccountSourceProvenance(repo, { ...separated, captureTestSourceCommit: "f".repeat(40) }),
      /capture_test_commit_missing/
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("account comparator provenance gate verifies both scoped commits against the current source trees", async () => {
  assert.ifError(provenanceImportError);
  assert.ifError(comparisonImportError);
  assert.equal(typeof comparison.verifyComparisonCaptureProvenance, "function");
  const { repo } = await seedRepository();
  try {
    const source = provenance.resolveAccountSourceProvenance(repo);
    assert.deepEqual(
      comparison.verifyComparisonCaptureProvenance({ scope: "account", evidence: source, sourceRoot: repo }),
      source
    );
    assert.throws(
      () => comparison.verifyComparisonCaptureProvenance({ scope: "account", evidence: { ...source, captureTestSourceCommit: "e".repeat(40) }, sourceRoot: repo }),
      /capture_test_commit_missing/
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
