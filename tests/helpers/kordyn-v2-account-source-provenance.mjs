import { execFileSync } from "node:child_process";

export const ACCOUNT_PRODUCT_SOURCE_PATHS = Object.freeze(["src"]);
export const ACCOUNT_CAPTURE_TEST_SOURCE_PATHS = Object.freeze([
  "tests/run-kordyn-v2-account-browser.mjs",
  "tests/kordyn-v2-account-browser.html",
  "tests/kordyn-v2-account-browser.jsx",
  "tests/kordyn-v2-production-fixture.js",
  "tests/helpers/kordyn-v2-account-source-provenance.mjs",
  "package.json",
  "package-lock.json",
  "vite.config.js"
]);

const commitPattern = /^[0-9a-f]{40}$/u;

function git(rootDir, args, options = {}) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "pipe"]
  }).trim();
}

function assertClean(rootDir, label, paths) {
  const status = git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...paths]);
  if (status) throw new Error(`dirty_${label}_source:${status}`);
}

function assertTracked(rootDir, label, paths) {
  for (const sourcePath of paths) {
    try {
      git(rootDir, ["ls-files", "--error-unmatch", sourcePath], { quiet: true });
    } catch {
      throw new Error(`untracked_${label}_source:${sourcePath}`);
    }
  }
}

function scopedOwnerCommit(rootDir, label, paths) {
  const commit = git(rootDir, ["log", "-1", "--format=%H", "--", ...paths]);
  if (!commitPattern.test(commit)) throw new Error(`${label}_source_owner_missing`);
  return commit;
}

function assertCommit(rootDir, label, commit) {
  if (!commitPattern.test(commit || "")) throw new Error(`${label}_commit_invalid`);
  try {
    git(rootDir, ["cat-file", "-e", `${commit}^{commit}`], { quiet: true });
  } catch {
    throw new Error(`${label}_commit_missing:${commit}`);
  }
}

function assertTreeAtCommit(rootDir, label, commit, paths) {
  try {
    git(rootDir, ["diff", "--quiet", commit, "--", ...paths], { quiet: true });
  } catch {
    throw new Error(`${label}_source_tree_mismatch:${commit}`);
  }
}

export function resolveAccountSourceProvenance(rootDir) {
  assertClean(rootDir, "product", ACCOUNT_PRODUCT_SOURCE_PATHS);
  assertClean(rootDir, "capture_test", ACCOUNT_CAPTURE_TEST_SOURCE_PATHS);
  assertTracked(rootDir, "capture_test", ACCOUNT_CAPTURE_TEST_SOURCE_PATHS);
  return Object.freeze({
    productSourceCommit: scopedOwnerCommit(rootDir, "product", ACCOUNT_PRODUCT_SOURCE_PATHS),
    captureTestSourceCommit: scopedOwnerCommit(rootDir, "capture_test", ACCOUNT_CAPTURE_TEST_SOURCE_PATHS)
  });
}

export function verifyAccountSourceProvenance(rootDir, evidence = {}) {
  const current = resolveAccountSourceProvenance(rootDir);
  const productSourceCommit = evidence?.productSourceCommit;
  const captureTestSourceCommit = evidence?.captureTestSourceCommit;
  assertCommit(rootDir, "product_source", productSourceCommit);
  assertCommit(rootDir, "capture_test", captureTestSourceCommit);
  assertTreeAtCommit(rootDir, "product", productSourceCommit, ACCOUNT_PRODUCT_SOURCE_PATHS);
  assertTreeAtCommit(rootDir, "capture_test", captureTestSourceCommit, ACCOUNT_CAPTURE_TEST_SOURCE_PATHS);
  if (productSourceCommit !== current.productSourceCommit) {
    throw new Error(`product_source_owner_mismatch:${productSourceCommit}:${current.productSourceCommit}`);
  }
  if (captureTestSourceCommit !== current.captureTestSourceCommit) {
    throw new Error(`capture_test_source_owner_mismatch:${captureTestSourceCommit}:${current.captureTestSourceCommit}`);
  }
  return current;
}
