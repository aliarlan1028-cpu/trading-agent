import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const googleFontHost = /fonts\.(?:googleapis|gstatic)\.com/;

function assertFontFree(document, label) {
  assert.doesNotMatch(document, googleFontHost, `${label} must not request a remote Google font host`);
}

export function verifySynchronizedIosFontDelivery({ rootDir }) {
  const builtIndex = path.join(rootDir, "dist/index.html");
  const iosIndex = path.join(rootDir, "ios/App/App/public/index.html");

  assert.ok(existsSync(builtIndex), "built product document is missing; run npm run ios:sync first");
  assert.ok(existsSync(iosIndex), "synchronized iOS product bundle is missing; run npm run ios:sync first");

  const builtDocument = readFileSync(builtIndex, "utf8");
  const iosDocument = readFileSync(iosIndex, "utf8");
  assertFontFree(builtDocument, "built product document");
  assertFontFree(iosDocument, "synchronized iOS product bundle");
  assert.equal(iosDocument, builtDocument, "synchronized iOS product bundle must match the built product document");

  return { builtIndex, iosIndex };
}

const ownFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  const rootDir = path.resolve(path.dirname(ownFile), "..");
  const { iosIndex } = verifySynchronizedIosFontDelivery({ rootDir });
  console.log(`iOS font delivery verified: ${iosIndex}`);
}
