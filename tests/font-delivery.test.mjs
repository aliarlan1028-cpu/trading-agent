import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifySynchronizedIosFontDelivery } from "./verify-ios-font-delivery.mjs";

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

test("iOS sync builds the Capacitor web directory before copying it", () => {
  const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const capacitorConfig = JSON.parse(readFileSync(path.join(rootDir, "capacitor.config.json"), "utf8"));
  const iosSync = packageJson.scripts["ios:sync"];
  const buildOffset = iosSync.indexOf("npm run build");
  const syncOffset = iosSync.indexOf("cap sync ios");

  assert.ok(buildOffset >= 0, "iOS sync must build the web directory");
  assert.ok(syncOffset > buildOffset, "iOS sync must build before Capacitor copies the web directory");
  assert.equal(capacitorConfig.webDir, "dist");
});

test("iOS artifact verifier rejects a clean checkout missing synchronized output", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "kordyn-ios-font-verifier-"));

  try {
    mkdirSync(path.join(fixtureRoot, "dist"), { recursive: true });
    writeFileSync(path.join(fixtureRoot, "dist/index.html"), "<html><head></head><body></body></html>");

    assert.throws(
      () => verifySynchronizedIosFontDelivery({ rootDir: fixtureRoot }),
      /synchronized iOS product bundle is missing/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
