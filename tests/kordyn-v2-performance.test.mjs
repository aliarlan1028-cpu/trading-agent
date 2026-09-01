import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let performanceModule;
let performanceImportError = null;
try {
  performanceModule = await import("./kordyn-v2-performance-report.mjs");
} catch (error) {
  performanceImportError = error;
}

let performanceRunner;
let performanceRunnerImportError = null;
try {
  performanceRunner = await import("./run-kordyn-v2-performance-build.mjs");
} catch (error) {
  performanceRunnerImportError = error;
}

test("V2 performance analysis separates public and authenticated route ownership", async () => {
  assert.ifError(performanceImportError);
  assert.equal(typeof performanceModule.buildV2PerformanceReport, "function");
  assert.equal(typeof performanceModule.analyzeV2BuildManifest, "function");
});

test("the executable performance gate is import-safe and exposes one deterministic runner", () => {
  assert.ifError(performanceRunnerImportError);
  assert.equal(typeof performanceRunner.runV2PerformanceGate, "function");
});

test("the V2 Root owns four explicit domain loaders and no legacy stylesheet import", async () => {
  const rootSource = await readFile(path.join(rootDir, "src/kordynV2/KordynV2Root.jsx"), "utf8");
  assert.match(rootSource, /const domainLoaders = Object\.freeze\(\{/);
  for (const domainId of ["ai", "account", "assets", "governance"]) {
    assert.match(rootSource, new RegExp(`${domainId}: \\(\\) => import\\(\"\\./domains/${domainId}/index\\.jsx\"\\)`));
    const domainSource = await readFile(path.join(rootDir, `src/kordynV2/domains/${domainId}/index.jsx`), "utf8");
    assert.match(domainSource, new RegExp(`import \"\\./${domainId}\\.css\";`), `${domainId}: owns its domain CSS`);
    assert.doesNotMatch(domainSource, /productStyles|styles\.css|product-foundation|zero-base/u, `${domainId}: no legacy stylesheet`);
  }
  assert.doesNotMatch(rootSource, /productStyles|styles\.css|product-foundation|zero-base/u);
});

test("performance budgets remain strict decimal-byte gates", () => {
  assert.ifError(performanceImportError);
  assert.deepEqual(performanceModule.KORDYN_V2_PERFORMANCE_BUDGETS, {
    publicCss: 40_000,
    publicJs: 450_000,
    aiShellCss: 180_000,
    accountDomainCss: 120_000,
    assetsDomainCss: 120_000,
    governanceDomainCss: 120_000,
    governanceDomainJs: 650_000
  });
});

const validManifest = Object.freeze({
  "index.html": Object.freeze({
    file: "assets/main.js",
    name: "index",
    src: "index.html",
    isEntry: true,
    imports: ["_react.js"],
    dynamicImports: ["src/productStyles.js", "src/kordynV2/entry.jsx"],
    css: ["assets/entry.css"]
  }),
  "_react.js": Object.freeze({ file: "assets/react.js", name: "react" }),
  "src/productStyles.js": Object.freeze({
    file: "assets/legacy.js",
    name: "productStyles",
    src: "src/productStyles.js",
    isDynamicEntry: true,
    css: ["assets/legacy.css"]
  }),
  "src/kordynV2/entry.jsx": Object.freeze({
    file: "assets/v2.js",
    name: "entry",
    src: "src/kordynV2/entry.jsx",
    isDynamicEntry: true,
    imports: ["index.html", "_react.js"],
    dynamicImports: [
      "src/kordynV2/domains/ai/index.jsx",
      "src/kordynV2/domains/account/index.jsx",
      "src/kordynV2/domains/assets/index.jsx",
      "src/kordynV2/domains/governance/index.jsx"
    ],
    css: ["assets/v2.css"]
  }),
  "src/kordynV2/domains/ai/index.jsx": Object.freeze({
    file: "assets/ai.js",
    name: "index",
    src: "src/kordynV2/domains/ai/index.jsx",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/ai.css"]
  }),
  "src/kordynV2/domains/account/index.jsx": Object.freeze({
    file: "assets/account.js",
    name: "index",
    src: "src/kordynV2/domains/account/index.jsx",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/account.css"]
  }),
  "src/kordynV2/domains/assets/index.jsx": Object.freeze({
    file: "assets/assets.js",
    name: "index",
    src: "src/kordynV2/domains/assets/index.jsx",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/assets.css"]
  }),
  "src/kordynV2/domains/governance/index.jsx": Object.freeze({
    file: "assets/governance.js",
    name: "index",
    src: "src/kordynV2/domains/governance/index.jsx",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/governance.css"]
  })
});

const validAssetStats = Object.freeze({
  "assets/main.js": Object.freeze({ raw: 200_000, gzip: 70_000 }),
  "assets/react.js": Object.freeze({ raw: 100_000, gzip: 35_000 }),
  "assets/entry.css": Object.freeze({ raw: 20_000, gzip: 5_000 }),
  "assets/legacy.js": Object.freeze({ raw: 30_000, gzip: 10_000 }),
  "assets/legacy.css": Object.freeze({ raw: 170_000, gzip: 26_000 }),
  "assets/v2.js": Object.freeze({ raw: 80_000, gzip: 25_000 }),
  "assets/v2.css": Object.freeze({ raw: 120_000, gzip: 18_000 }),
  "assets/ai.js": Object.freeze({ raw: 65_000, gzip: 20_000 }),
  "assets/ai.css": Object.freeze({ raw: 30_000, gzip: 7_000 }),
  "assets/account.js": Object.freeze({ raw: 70_000, gzip: 21_000 }),
  "assets/account.css": Object.freeze({ raw: 48_000, gzip: 8_000 }),
  "assets/assets.js": Object.freeze({ raw: 75_000, gzip: 23_000 }),
  "assets/assets.css": Object.freeze({ raw: 51_000, gzip: 9_000 }),
  "assets/governance.js": Object.freeze({ raw: 90_000, gzip: 27_000 }),
  "assets/governance.css": Object.freeze({ raw: 62_000, gzip: 10_000 })
});

test("manifest graph ownership reports public, V2 shell, and legacy assets without following lazy siblings", () => {
  assert.ifError(performanceImportError);
  const report = performanceModule.analyzeV2BuildManifest({
    manifest: validManifest,
    assetStats: validAssetStats
  });
  assert.deepEqual(report.public, {
    entry: "index.html",
    js: 300_000,
    jsGzip: 105_000,
    css: 20_000,
    cssGzip: 5_000,
    assets: ["assets/entry.css", "assets/main.js", "assets/react.js"]
  });
  assert.deepEqual(report.routes.aiShell, {
    entry: "src/kordynV2/entry.jsx",
    js: 445_000,
    jsGzip: 150_000,
    css: 170_000,
    cssGzip: 30_000,
    assets: ["assets/ai.css", "assets/ai.js", "assets/entry.css", "assets/main.js", "assets/react.js", "assets/v2.css", "assets/v2.js"],
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: []
  });
  assert.deepEqual(report.routes.legacy, {
    entry: "src/productStyles.js",
    js: 30_000,
    jsGzip: 10_000,
    css: 170_000,
    cssGzip: 26_000,
    assets: ["assets/legacy.css", "assets/legacy.js"]
  });
  assert.deepEqual(report.routes.aiDomain, {
    entry: "src/kordynV2/domains/ai/index.jsx",
    js: 165_000,
    jsGzip: 55_000,
    css: 30_000,
    cssGzip: 7_000,
    assets: ["assets/ai.css", "assets/ai.js", "assets/react.js"],
    lazyOwnedBy: "src/kordynV2/entry.jsx",
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: [],
    sharedShellCss: []
  });
  assert.deepEqual(report.routes.accountDomain, {
    entry: "src/kordynV2/domains/account/index.jsx",
    js: 170_000,
    jsGzip: 56_000,
    css: 48_000,
    cssGzip: 8_000,
    assets: ["assets/account.css", "assets/account.js", "assets/react.js"],
    lazyOwnedBy: "src/kordynV2/entry.jsx",
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: [],
    sharedShellCss: []
  });
  assert.deepEqual(report.routes.governanceDomain, {
    entry: "src/kordynV2/domains/governance/index.jsx",
    js: 190_000,
    jsGzip: 62_000,
    css: 62_000,
    cssGzip: 10_000,
    assets: ["assets/governance.css", "assets/governance.js", "assets/react.js"],
    lazyOwnedBy: "src/kordynV2/entry.jsx",
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: [],
    sharedShellCss: []
  });
  assert.deepEqual(report.routes.assetsDomain, {
    entry: "src/kordynV2/domains/assets/index.jsx",
    js: 175_000,
    jsGzip: 58_000,
    css: 51_000,
    cssGzip: 9_000,
    assets: ["assets/assets.css", "assets/assets.js", "assets/react.js"],
    lazyOwnedBy: "src/kordynV2/entry.jsx",
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: [],
    sharedShellCss: []
  });
  assert.deepEqual(report.budgets, {
    publicCss: { actual: 20_000, limit: 40_000, pass: true },
    publicJs: { actual: 300_000, limit: 450_000, pass: true },
    aiShellCss: { actual: 170_000, limit: 180_000, pass: true },
    accountDomainCss: { actual: 48_000, limit: 120_000, pass: true },
    assetsDomainCss: { actual: 51_000, limit: 120_000, pass: true },
    governanceDomainCss: { actual: 62_000, limit: 120_000, pass: true },
    governanceDomainJs: { actual: 190_000, limit: 650_000, pass: true }
  });
});

const coalescedV2Manifest = Object.freeze({
  ...validManifest,
  "index.html": Object.freeze({
    ...validManifest["index.html"],
    dynamicImports: ["src/productStyles.js", "_entry-v2.js"]
  }),
  "_entry-v2.js": Object.freeze({
    file: "assets/v2.js",
    name: "entry",
    isDynamicEntry: true,
    imports: ["index.html", "_react.js"],
    dynamicImports: [
      "src/kordynV2/domains/ai/index.jsx",
      "src/kordynV2/domains/account/index.jsx",
      "src/kordynV2/domains/assets/index.jsx",
      "src/kordynV2/domains/governance/index.jsx"
    ],
    css: ["assets/v2.css"]
  }),
  "src/kordynV2/domains/ai/index.jsx": Object.freeze({
    file: "assets/ai.js",
    name: "index",
    src: "src/kordynV2/domains/ai/index.jsx",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/ai.css"]
  }),
  "src/kordynV2/domains/account/index.jsx": Object.freeze({
    file: "assets/account.js",
    name: "index",
    src: "src/kordynV2/domains/account/index.jsx",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/account.css"]
  })
});

const coalescedAssetStats = Object.freeze({
  ...validAssetStats,
  "assets/ai.js": Object.freeze({ raw: 55_000, gzip: 18_000 }),
  "assets/ai.css": Object.freeze({ raw: 45_000, gzip: 9_000 })
});

test("Vite-coalesced V2 entry is resolved by unique public-owned structural identity", () => {
  assert.ifError(performanceImportError);
  const manifest = { ...coalescedV2Manifest };
  delete manifest["src/kordynV2/entry.jsx"];
  const report = performanceModule.analyzeV2BuildManifest({
    manifest,
    assetStats: coalescedAssetStats
  });
  assert.equal(report.routes.aiShell.entry, "_entry-v2.js");
  assert.equal(report.routes.aiShell.loadsLegacyProductStyles, false);
  assert.ok(report.routes.aiShell.assets.includes("assets/v2.css"));
  assert.equal(report.routes.aiShell.assets.includes("assets/ai.css"), true, "initial authenticated AI experience includes its active domain CSS");
  assert.equal(report.routes.aiShell.assets.includes("assets/account.css"), false, "inactive lazy Account child stays outside static shell closure");
  assert.equal(report.routes.accountDomain.entry, "src/kordynV2/domains/account/index.jsx");
  assert.equal(report.routes.accountDomain.css, 48_000);
});

test("a Vite-coalesced domain entry is resolved as the sole remaining V2 lazy child", () => {
  assert.ifError(performanceImportError);
  const manifest = structuredClone(validManifest);
  delete manifest["src/kordynV2/domains/assets/index.jsx"];
  manifest["src/kordynV2/entry.jsx"].dynamicImports = [
    "src/kordynV2/domains/ai/index.jsx",
    "src/kordynV2/domains/account/index.jsx",
    "_assets-v2.js",
    "src/kordynV2/domains/governance/index.jsx"
  ];
  manifest["_assets-v2.js"] = {
    file: "assets/assets.js",
    name: "index",
    isDynamicEntry: true,
    imports: ["_react.js"],
    dynamicImports: ["src/kordynV2/domains/assets/StrategyWorkspace.jsx"],
    css: ["assets/assets.css"]
  };
  const report = performanceModule.analyzeV2BuildManifest({ manifest, assetStats: validAssetStats });
  assert.equal(report.routes.assetsDomain.entry, "_assets-v2.js");
  assert.equal(report.routes.assetsDomain.css, 51_000);
});

test("a source-less remaining lazy child cannot impersonate a coalesced domain entry", () => {
  assert.ifError(performanceImportError);
  const manifest = structuredClone(validManifest);
  delete manifest["src/kordynV2/domains/assets/index.jsx"];
  manifest["src/kordynV2/entry.jsx"].dynamicImports = [
    "src/kordynV2/domains/ai/index.jsx",
    "src/kordynV2/domains/account/index.jsx",
    "_unscoped-v2.js",
    "src/kordynV2/domains/governance/index.jsx"
  ];
  manifest["_unscoped-v2.js"] = {
    file: "assets/assets.js",
    name: "index",
    isDynamicEntry: true,
    imports: ["_react.js"],
    css: ["assets/assets.css"]
  };
  assert.throws(
    () => performanceModule.analyzeV2BuildManifest({ manifest, assetStats: validAssetStats }),
    /missing_assets_entry/
  );
});

test("Vite-coalesced V2 entry resolution fails closed when the structural owner is ambiguous", () => {
  assert.ifError(performanceImportError);
  const manifest = { ...coalescedV2Manifest };
  delete manifest["src/kordynV2/entry.jsx"];
  manifest["index.html"] = {
    ...manifest["index.html"],
    dynamicImports: [...manifest["index.html"].dynamicImports, "_entry-v2-copy.js"]
  };
  manifest["_entry-v2-copy.js"] = {
    ...manifest["_entry-v2.js"],
    file: "assets/v2-copy.js"
  };
  assert.throws(
    () => performanceModule.analyzeV2BuildManifest({
      manifest,
      assetStats: {
        ...coalescedAssetStats,
        "assets/v2-copy.js": { raw: 80_000, gzip: 25_000 }
      }
    }),
    /ambiguous_v2_entry/
  );
});

test("Vite-coalesced V2 entry resolution rejects misowned or unscoped structural candidates", () => {
  assert.ifError(performanceImportError);
  for (const mutate of [
    (manifest) => { manifest["index.html"].dynamicImports = ["src/productStyles.js"]; },
    (manifest) => { manifest["_entry-v2.js"].isDynamicEntry = false; },
    (manifest) => { manifest["_entry-v2.js"].css = []; },
    (manifest) => { manifest["_entry-v2.js"].dynamicImports = []; }
  ]) {
    const manifest = structuredClone(coalescedV2Manifest);
    delete manifest["src/kordynV2/entry.jsx"];
    mutate(manifest);
    assert.throws(
      () => performanceModule.analyzeV2BuildManifest({ manifest, assetStats: coalescedAssetStats }),
      /missing_v2_entry/
    );
  }
});

test("manifest analysis fails closed on missing, ambiguous, non-finite, or legacy-owned assets", () => {
  assert.ifError(performanceImportError);
  const analyze = performanceModule.analyzeV2BuildManifest;
  const withoutV2 = { ...validManifest };
  delete withoutV2["src/kordynV2/entry.jsx"];
  assert.throws(() => analyze({ manifest: withoutV2, assetStats: validAssetStats }), /missing_v2_entry/);

  const ambiguousV2 = {
    ...validManifest,
    duplicate: { ...validManifest["src/kordynV2/entry.jsx"], file: "assets/v2-copy.js" }
  };
  assert.throws(() => analyze({ manifest: ambiguousV2, assetStats: validAssetStats }), /ambiguous_v2_entry/);

  const missingSize = { ...validAssetStats };
  delete missingSize["assets/v2.css"];
  assert.throws(() => analyze({ manifest: validManifest, assetStats: missingSize }), /missing_asset_size.*assets\/v2\.css/);

  const nonFinite = { ...validAssetStats, "assets/v2.css": { raw: Number.NaN, gzip: 1 } };
  assert.throws(() => analyze({ manifest: validManifest, assetStats: nonFinite }), /non_finite_asset_size.*assets\/v2\.css/);

  const importsLegacy = {
    ...validManifest,
    "src/kordynV2/entry.jsx": {
      ...validManifest["src/kordynV2/entry.jsx"],
      imports: ["_react.js", "src/productStyles.js"]
    }
  };
  assert.throws(() => analyze({ manifest: importsLegacy, assetStats: validAssetStats }), /v2_imports_legacy_styles/);

  const sharedLegacyCss = {
    ...validManifest,
    "src/kordynV2/entry.jsx": {
      ...validManifest["src/kordynV2/entry.jsx"],
      css: ["assets/v2.css", "assets/legacy.css"]
    }
  };
  assert.throws(() => analyze({ manifest: sharedLegacyCss, assetStats: validAssetStats }), /v2_loads_legacy_css/);
});

async function writeFakeBuild(outDir) {
  await mkdir(path.join(outDir, ".vite"), { recursive: true });
  await mkdir(path.join(outDir, "assets"), { recursive: true });
  await writeFile(path.join(outDir, ".vite/manifest.json"), JSON.stringify(validManifest));
  for (const [file, stats] of Object.entries(validAssetStats)) {
    await writeFile(path.join(outDir, file), Buffer.alloc(stats.raw, file.endsWith(".css") ? 65 : 66));
  }
}

test("isolated report ignores checked-in dist and removes its owned temporary build root", async () => {
  assert.ifError(performanceImportError);
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-performance-test-root-"));
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-performance-test-temp-"));
  let builtOutput = "";
  try {
    await mkdir(path.join(testRoot, "dist"), { recursive: true });
    await mkdir(path.join(testRoot, "src"), { recursive: true });
    await writeFile(path.join(testRoot, "dist/sentinel.txt"), "checked-in-dist");
    await writeFile(path.join(testRoot, "src/sentinel.txt"), "source-tree");
    const report = await performanceModule.buildV2PerformanceReport({
      root: testRoot,
      temporaryParent,
      build: async (config) => {
        builtOutput = config.build.outDir;
        assert.equal(config.build.emptyOutDir, true);
        assert.equal(config.build.manifest, true);
        await writeFakeBuild(builtOutput);
      }
    });
    assert.equal(report.freshBuild, true);
    assert.equal(report.public.css, 20_000);
    assert.equal(report.routes.aiShell.css, 170_000);
    assert.equal(await readFile(path.join(testRoot, "dist/sentinel.txt"), "utf8"), "checked-in-dist");
    assert.equal(await readFile(path.join(testRoot, "src/sentinel.txt"), "utf8"), "source-tree");
    await assert.rejects(access(path.dirname(builtOutput)), /ENOENT/);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
    await rm(temporaryParent, { recursive: true, force: true });
  }
});

test("isolated report cleans its owned temporary root after build failure", async () => {
  assert.ifError(performanceImportError);
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-performance-failure-root-"));
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-performance-failure-temp-"));
  let builtOutput = "";
  try {
    await assert.rejects(
      performanceModule.buildV2PerformanceReport({
        root: testRoot,
        temporaryParent,
        build: async (config) => {
          builtOutput = config.build.outDir;
          throw new Error("expected_build_failure");
        }
      }),
      /expected_build_failure/
    );
    await assert.rejects(access(path.dirname(builtOutput)), /ENOENT/);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
    await rm(temporaryParent, { recursive: true, force: true });
  }
});
