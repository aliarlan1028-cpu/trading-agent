import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const googleFontHost = /fonts\.(?:googleapis|gstatic)\.com/;

function assertFontFree(document, label) {
  assert.doesNotMatch(document, googleFontHost, `${label} must not request a remote Google font host`);
}

test("product source keeps local fallbacks and has no remote Google font host", () => {
  assertFontFree(readFileSync(path.join(rootDir, "index.html"), "utf8"), "product source");

  for (const cssFile of ["src/styles.css", "src/product-foundation.css", "src/kordynV2/styles/tokens.css"]) {
    const css = readFileSync(path.join(rootDir, cssFile), "utf8");
    assert.match(css, /\b(?:sans-serif|monospace)\b/, `${cssFile} must retain a generic font fallback`);
  }
});

test("isolated Vite product build has no remote Google font host", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "kordyn-font-delivery-build-"));

  try {
    execFileSync("node", ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir], {
      cwd: rootDir,
      stdio: "pipe"
    });

    assertFontFree(readFileSync(path.join(outDir, "index.html"), "utf8"), "isolated product build");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("synchronized iOS product bundle has no remote Google font host", () => {
  const iosIndex = path.join(rootDir, "ios/App/App/public/index.html");
  assert.ok(existsSync(iosIndex), "run npm run ios:sync before verifying the generated iOS product bundle");
  assertFontFree(readFileSync(iosIndex, "utf8"), "generated iOS product bundle");
});
