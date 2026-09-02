import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = fs.readFileSync(path.join(rootDir, "src", "main.jsx"), "utf8");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "authenticated-entry-preload");
const bundle = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(bundle, { force: true }); } catch { /* noop */ } });

function loadAuthenticatedEntryHarness() {
  const loaderSource = main.match(/let august15EntryPromise;[\s\S]*?^}\n(?=const August15AuthenticatedShell)/m)?.[0];
  assert.ok(loaderSource, "main must export the shared August 15 authenticated-entry loader");
  require("esbuild").buildSync({
    stdin: {
      contents: `${loaderSource}\nexport function replaceAugust15EntryPromiseForTest(entryPromise) { august15EntryPromise = entryPromise; }`,
      resolveDir: path.join(rootDir, "src"),
      loader: "jsx"
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: bundle,
    logLevel: "silent"
  });
  delete require.cache[bundle];
  return require(bundle);
}

test("authenticated entry loader shares one in-flight import and retries after rejection", async () => {
  const { loadAugust15AuthenticatedEntry } = loadAuthenticatedEntryHarness();
  let rejectedCalls = 0;
  const failed = loadAugust15AuthenticatedEntry(() => {
    rejectedCalls += 1;
    return Promise.reject(new Error("offline"));
  });

  assert.equal(rejectedCalls, 1);
  await assert.rejects(failed, /offline/);

  let importerCalls = 0;
  const module = { August15AuthenticatedShell: "shell" };
  const importer = () => {
    importerCalls += 1;
    return Promise.resolve(module);
  };
  const first = loadAugust15AuthenticatedEntry(importer);
  const second = loadAugust15AuthenticatedEntry(importer);

  assert.equal(importerCalls, 1);
  assert.equal(first, second);
  assert.equal(await first, module);
});

test("stale rejection cleanup preserves a newer shared import", async () => {
  const { loadAugust15AuthenticatedEntry, replaceAugust15EntryPromiseForTest } = loadAuthenticatedEntryHarness();
  let rejectOld;
  const oldPromise = new Promise((resolve, reject) => { rejectOld = reject; });
  loadAugust15AuthenticatedEntry(() => oldPromise);

  // Model a retry that has cleared the failed old entry before that entry's delayed cleanup runs.
  replaceAugust15EntryPromiseForTest(undefined);
  let newerImporterCalls = 0;
  const newerPromise = new Promise(() => {});
  const newer = loadAugust15AuthenticatedEntry(() => {
    newerImporterCalls += 1;
    return newerPromise;
  });

  rejectOld(new Error("stale import failure"));
  await assert.rejects(oldPromise, /stale import failure/);

  const repeatedRetry = loadAugust15AuthenticatedEntry(() => {
    newerImporterCalls += 1;
    return Promise.resolve({ August15AuthenticatedShell: "duplicate" });
  });
  assert.equal(repeatedRetry, newer);
  assert.equal(newerImporterCalls, 1);
});

test("production preload transfers the authenticated entry without its stylesheet", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "kordyn-authenticated-entry-preload-"));
  const outputDir = path.join(outputRoot, "dist");
  try {
    await build({ root: rootDir, logLevel: "silent", build: { outDir: outputDir, emptyOutDir: true, manifest: true } });
    const manifest = JSON.parse(await readFile(path.join(outputDir, ".vite", "manifest.json"), "utf8"));
    const entry = Object.values(manifest).find((candidate) => candidate?.name === "App" && candidate?.isDynamicEntry === true);
    const styles = manifest["src/aug15/productStyles.js"];

    assert.ok(entry?.file, "the authenticated entry remains a production dynamic asset for early transfer");
    assert.deepEqual(entry.css || [], [], "preloading authenticated code must not apply August 15 CSS before the data gate");
    assert.match(styles?.file || "", /\.css$/, "the authenticated stylesheet must remain a separately deferred production asset");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("legacy preload starts before bootstrap completes while rendering keeps auth and data gates", () => {
  const effectStart = main.indexOf('  useEffect(() => {\n    if (uiVersion !== "legacy"');
  const effectEnd = main.indexOf("  }, [authRequired, loading, productStylesAttempt, uiVersion]);", effectStart);
  const preloadEffect = effectStart >= 0 && effectEnd >= 0
    ? main.slice(effectStart, effectEnd + "  }, [authRequired, loading, productStylesAttempt, uiVersion]);".length)
    : "";

  assert.ok(preloadEffect, "main must retain its authenticated-entry preload effect");
  assert.doesNotMatch(preloadEffect, /\|\| loading/);
  assert.doesNotMatch(preloadEffect, /\|\| authRequired/);
  assert.match(main, /if \(authRequired\) return <AppFrame><LandingPage/);
  assert.match(main, /import\("\.\/aug15\/productStyles\.js"\)/);
  assert.match(main, /if \(!loading && data && uiVersion === "legacy" && \(productEntryState !== "ready" \|\| productStylesState !== "ready"\)\)/);
  assert.match(main, /if \(!loading && !data\) return <AppFrame authenticated><ConnectionScreen/);
  assert.match(main, /if \(loading \|\| !data\) return <AppFrame authenticated><AuthenticatedBootState/);
});
