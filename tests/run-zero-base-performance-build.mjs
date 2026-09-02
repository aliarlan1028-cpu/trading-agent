import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = await mkdtemp(path.join(os.tmpdir(), "kordyn-zero-performance-"));
const dist = path.join(buildRoot, "dist");

try {
  await build({
    root,
    logLevel: "silent",
    build: {
      outDir: dist,
      emptyOutDir: true,
      manifest: true
    }
  });

  const html = await readFile(path.join(dist, "index.html"), "utf8");
  const initialCss = [...html.matchAll(/href="([^"]+\.css)"/g)].map((match) => match[1].replace(/^\//, ""));
  assert.equal(initialCss.length, 1, "public/auth entry must ship one small CSS asset");
  const initialCssBytes = (await Promise.all(initialCss.map(async (file) => (await stat(path.join(dist, file))).size))).reduce((sum, value) => sum + value, 0);
  assert.ok(initialCssBytes < 40_000, `initial CSS ${initialCssBytes} exceeds 40 kB`);

  const manifest = JSON.parse(await readFile(path.join(dist, ".vite", "manifest.json"), "utf8"));
  const august15Entry = Object.values(manifest).find((row) => row?.name === "App" && row?.isDynamicEntry === true);
  assert.ok(august15Entry, "lazy August 15 authenticated entry is missing");
  assert.deepEqual(august15Entry.css || [], [], "early August 15 App JS closure must not carry authenticated CSS");
  assert.equal((august15Entry.assets || []).some((file) => file.endsWith(".css")), false, "early August 15 App JS assets must not include authenticated CSS");

  const productStylesManifestRow = Object.entries(manifest).find(([, row]) => row?.name === "productStyles" && row?.isDynamicEntry === true);
  const [productStylesKey, productStylesEntry] = productStylesManifestRow || [];
  assert.ok(productStylesEntry, "deferred August 15 productStyles module is missing");
  const productCssAssets = (productStylesEntry.assets || []).filter((file) => file.endsWith(".css"));
  assert.equal(productCssAssets.length, 1, `deferred productStyles must own exactly one CSS asset, got ${JSON.stringify(productStylesEntry.assets || [])}`);
  const [productCss] = productCssAssets;
  const productCssSource = Object.values(manifest).find((row) => row?.src?.endsWith("/src/aug15/styles.css") && row?.file === productCss);
  assert.ok(productCssSource, "deferred productStyles CSS must resolve to the real August 15 stylesheet source");
  const earlyAppClosure = [...(august15Entry.imports || []), ...(august15Entry.dynamicImports || [])];
  assert.equal(earlyAppClosure.some((reference) => reference === productStylesKey || reference === productStylesEntry.file), false, "early App JS closure must exclude deferred productStyles JS");
  assert.doesNotMatch(html, new RegExp(productCss.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "authenticated CSS must not be linked by the public HTML entry");
  assert.doesNotMatch(html, new RegExp(productStylesEntry.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "deferred productStyles JS must not be linked by the public HTML entry");

  const initialJs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1].replace(/^\//, ""));
  const initialJsBytes = (await Promise.all(initialJs.map(async (file) => (await stat(path.join(dist, file))).size))).reduce((sum, value) => sum + value, 0);
  assert.ok(initialJsBytes < 450_000, `initial JS ${initialJsBytes} exceeds 450 kB`);

  console.log(JSON.stringify({
    result: "PASS",
    freshBuild: true,
    initialCss: { files: initialCss, bytes: initialCssBytes, budget: 40_000 },
    initialJs: { files: initialJs, bytes: initialJsBytes, budget: 450_000 },
    authenticatedEntry: { file: august15Entry.file, cssInEarlyClosure: false },
    authenticatedCss: { file: productCss, source: productCssSource.src, deferredBy: productStylesEntry.file, linkedInitially: false }
  }, null, 2));
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}
