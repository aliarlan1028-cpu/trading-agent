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
  const august15Entry = Object.values(manifest).find((row) => row?.name === "App" && row?.isDynamicEntry === true && Array.isArray(row.css));
  assert.ok(august15Entry, "lazy August 15 authenticated entry is missing");
  const productCss = august15Entry.css?.[0];
  assert.ok(productCss, "lazy August 15 authenticated CSS asset is missing");
  assert.doesNotMatch(html, new RegExp(productCss.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "authenticated CSS must not be linked by the public HTML entry");

  const initialJs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1].replace(/^\//, ""));
  const initialJsBytes = (await Promise.all(initialJs.map(async (file) => (await stat(path.join(dist, file))).size))).reduce((sum, value) => sum + value, 0);
  assert.ok(initialJsBytes < 450_000, `initial JS ${initialJsBytes} exceeds 450 kB`);

  console.log(JSON.stringify({
    result: "PASS",
    freshBuild: true,
    initialCss: { files: initialCss, bytes: initialCssBytes, budget: 40_000 },
    initialJs: { files: initialJs, bytes: initialJsBytes, budget: 450_000 },
    authenticatedCss: { file: productCss, linkedInitially: false }
  }, null, 2));
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}
