import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Vite builds the marketing page as an isolated hashed entry", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "kordyn-landing-build-"));

  try {
    execFileSync("node", ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir], {
      cwd: rootDir,
      stdio: "pipe"
    });

    const marketingHtml = readFileSync(path.join(outDir, "landing.html"), "utf8");
    const productHtml = readFileSync(path.join(outDir, "index.html"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(outDir, ".vite", "manifest.json"), "utf8"));

    assert.match(marketingHtml, /TO THE/);
    assert.doesNotMatch(marketingHtml, /src\/main\.jsx|index-[^"']+\.js/);
    assert.match(marketingHtml, /\/assets\/landing-[^"']+\.js/);
    assert.match(marketingHtml, /\/assets\/landing-[^"']+\.css/);
    assert.match(productHtml, /\/assets\/index-[^"']+\.js/);
    assert.ok(manifest["landing.html"], "landing entry must be listed in Vite's manifest");
    assert.ok(manifest["index.html"], "product entry must be listed in Vite's manifest");

    const assetPath = (html, extension) => {
      const match = html.match(new RegExp(`/assets/(landing-[^"']+\\.${extension})`));
      assert.ok(match, `missing hashed landing ${extension}`);
      return path.join(outDir, "assets", match[1]);
    };
    const compressedBytes = [
      Buffer.from(marketingHtml),
      readFileSync(assetPath(marketingHtml, "css")),
      readFileSync(assetPath(marketingHtml, "js"))
    ].reduce((total, asset) => total + gzipSync(asset).length, 0);

    assert.ok(compressedBytes < 75 * 1024, `marketing HTML, CSS, and JS gzip to ${compressedBytes} bytes`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    assert.equal(existsSync(outDir), false, "isolated build output must be removed");
  }
});
