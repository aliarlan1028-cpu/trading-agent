import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
    stdin: { contents: loaderSource, resolveDir: path.join(rootDir, "src"), loader: "jsx" },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: bundle,
    logLevel: "silent"
  });
  return require(bundle).loadAugust15AuthenticatedEntry;
}

test("authenticated entry loader shares one in-flight import and retries after rejection", async () => {
  const loadAugust15AuthenticatedEntry = loadAuthenticatedEntryHarness();
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
  assert.match(main, /if \(!loading && uiVersion === "legacy" && productStylesState !== "ready"\)/);
  assert.match(main, /if \(!loading && !data\) return <AppFrame authenticated><ConnectionScreen/);
  assert.match(main, /if \(loading \|\| !data\) return <AppFrame authenticated><AuthenticatedBootState/);
});
