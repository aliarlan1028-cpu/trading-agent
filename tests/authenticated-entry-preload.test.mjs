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
const stylesBundle = path.join(cacheDir, `styles-bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(bundle, { force: true }); } catch { /* noop */ }
  try { fs.rmSync(stylesBundle, { force: true }); } catch { /* noop */ }
});

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

function loadAuthenticatedStylesHarness() {
  const loaderSource = main.match(/let august15StylesPromise;[\s\S]*?^}\n(?=const kordynV2StyleNodes)/m)?.[0];
  assert.ok(loaderSource, "main must export the shared August 15 authenticated-styles loader");
  require("esbuild").buildSync({
    stdin: {
      contents: loaderSource,
      resolveDir: path.join(rootDir, "src"),
      loader: "jsx"
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: stylesBundle,
    logLevel: "silent"
  });
  delete require.cache[stylesBundle];
  return require(stylesBundle);
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

test("authenticated stylesheet loader reuses its loaded link and promise", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const links = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, "link");
        return { remove() { this.removed = true; } };
      },
      head: {
        append(link) {
          links.push(link);
          queueMicrotask(() => link.onload());
        }
      }
    }
  });
  try {
    const { loadAugust15AuthenticatedStyles } = loadAuthenticatedStylesHarness();
    let importerCalls = 0;
    const importer = () => {
      importerCalls += 1;
      return Promise.resolve({ stylesheetUrl: "/assets/aug15.css" });
    };
    const first = loadAugust15AuthenticatedStyles(importer);
    const second = loadAugust15AuthenticatedStyles(importer);
    assert.equal(first, second);
    await first;
    assert.equal(importerCalls, 1);
    assert.equal(links.length, 1);
    assert.equal(links[0].rel, "stylesheet");
    assert.match(links[0].href, /\/assets\/aug15\.css\?authenticatedStylesRetry=1$/);
    assert.equal(loadAugust15AuthenticatedStyles(importer), first);
    assert.equal(importerCalls, 1);
    assert.equal(links.length, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  }
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
    assert.match(styles?.file || "", /\.js$/, "the authenticated stylesheet URL must remain a separately deferred production module");
    assert.ok(styles?.assets?.some((asset) => asset.endsWith(".css")), "the deferred stylesheet module must expose its production CSS asset");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("legacy preload starts before bootstrap completes while rendering keeps auth and data gates", () => {
  const effectStart = main.indexOf('  useEffect(() => {\n    if (uiVersion !== "legacy"');
  const effectEnd = main.indexOf("  }, [authRequired, loading, uiVersion]);", effectStart);
  const preloadEffect = effectStart >= 0 && effectEnd >= 0
    ? main.slice(effectStart, effectEnd + "  }, [authRequired, loading, uiVersion]);".length)
    : "";

  assert.ok(preloadEffect, "main must retain its authenticated-entry preload effect");
  assert.doesNotMatch(preloadEffect, /\|\| loading/);
  assert.doesNotMatch(preloadEffect, /\|\| authRequired/);
  assert.match(main, /if \(authRequired\) return <AppFrame><LandingPage/);
  assert.match(main, /import\("\.\/aug15\/productStyles\.js"\)/);
  const stylesEffectStart = main.indexOf('  useEffect(() => {\n    if (uiVersion !== "legacy" || authRequired');
  const stylesEffectEnd = main.indexOf("  }, [authRequired, loading, Boolean(data), productEntryState, uiVersion]);", stylesEffectStart);
  const stylesEffect = stylesEffectStart >= 0 && stylesEffectEnd >= 0
    ? main.slice(stylesEffectStart, stylesEffectEnd)
    : "";
  assert.ok(stylesEffect, "main must retain its authenticated stylesheet loader effect");
  assert.doesNotMatch(stylesEffect, /\|\| !data/);
  assert.match(main, /if \(!loading && uiVersion === "legacy" && \(productEntryState !== "ready" \|\| productStylesState !== "ready"\)\)/);
  assert.ok(
    main.indexOf('if (!loading && uiVersion === "legacy"') < main.indexOf('if (!loading && !data) return <AppFrame authenticated><ConnectionScreen'),
    "connection failure must wait for the authenticated stylesheet outcome after loading completes"
  );
  assert.match(main, /if \(!loading && !data\) return <AppFrame authenticated><ConnectionScreen/);
  assert.match(main, /if \(loading \|\| !data\) return <AppFrame authenticated><AuthenticatedBootState/);
});
