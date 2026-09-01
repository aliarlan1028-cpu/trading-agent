export const KORDYN_V2_PERFORMANCE_BUDGETS = Object.freeze({
  publicCss: 40_000,
  publicJs: 450_000,
  aiShellCss: 180_000,
  accountDomainCss: 120_000,
  assetsDomainCss: 120_000,
  governanceDomainCss: 120_000,
  governanceDomainJs: 650_000
});

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid_${label}`);
  }
  return value;
}

function uniqueEntry(manifest, source, label) {
  const matches = Object.entries(manifest).filter(([key, row]) => (
    key === source || row?.src === source
  ));
  if (matches.length === 0) throw new Error(`missing_${label}_entry`);
  if (matches.length !== 1) throw new Error(`ambiguous_${label}_entry`);
  return matches[0][0];
}

function uniquePublicEntry(manifest) {
  const matches = Object.entries(manifest).filter(([key, row]) => (
    row?.isEntry === true
    && (key.endsWith(".html") || (typeof row.src === "string" && row.src.endsWith(".html")))
  ));
  if (matches.length === 0) throw new Error("missing_public_entry");
  if (matches.length !== 1) throw new Error("ambiguous_public_entry");
  return matches[0][0];
}

function validOwnedCss(row) {
  return Array.isArray(row?.css)
    && row.css.length > 0
    && row.css.every((file) => typeof file === "string" && file.endsWith(".css") && file.length > 4);
}

function resolveV2Entry(manifest, publicEntry) {
  const exact = Object.entries(manifest).filter(([key, row]) => (
    key === "src/kordynV2/entry.jsx" || row?.src === "src/kordynV2/entry.jsx"
  ));
  if (exact.length > 1) throw new Error("ambiguous_v2_entry");
  if (exact.length === 1) return exact[0][0];

  const publicDynamic = manifest[publicEntry]?.dynamicImports;
  if (!Array.isArray(publicDynamic) || publicDynamic.some((value) => typeof value !== "string" || !value)) {
    throw new Error("invalid_public_dynamic_imports");
  }
  let aiEntry;
  try {
    aiEntry = uniqueEntry(manifest, "src/kordynV2/domains/ai/index.jsx", "ai");
  } catch (error) {
    if (error?.message === "missing_ai_entry") throw new Error("missing_v2_entry");
    if (error?.message === "ambiguous_ai_entry") throw new Error("ambiguous_v2_entry");
    throw error;
  }
  const candidates = publicDynamic.filter((key) => {
    const row = manifest[key];
    return row?.isDynamicEntry === true
      && validOwnedCss(row)
      && Array.isArray(row.dynamicImports)
      && row.dynamicImports.length > 0
      && row.dynamicImports.includes(aiEntry)
      && validOwnedCss(manifest[aiEntry]);
  });
  if (candidates.length === 0) throw new Error("missing_v2_entry");
  if (candidates.length !== 1) throw new Error("ambiguous_v2_entry");
  return candidates[0];
}

function resolveDomainEntries(manifest, v2Entry) {
  const definitions = [
    ["ai", "src/kordynV2/domains/ai/index.jsx"],
    ["account", "src/kordynV2/domains/account/index.jsx"],
    ["assets", "src/kordynV2/domains/assets/index.jsx"],
    ["governance", "src/kordynV2/domains/governance/index.jsx"]
  ];
  const dynamicImports = manifest[v2Entry]?.dynamicImports;
  if (!Array.isArray(dynamicImports) || dynamicImports.some((value) => typeof value !== "string" || !value)) {
    throw new Error("invalid_v2_dynamic_imports");
  }
  const resolved = {};
  const missing = [];
  for (const [domainId, source] of definitions) {
    const matches = Object.entries(manifest).filter(([key, row]) => key === source || row?.src === source);
    if (matches.length > 1) throw new Error(`ambiguous_${domainId}_entry`);
    if (matches.length === 1) resolved[domainId] = matches[0][0];
    else missing.push(domainId);
  }
  const claimed = new Set(Object.values(resolved));
  const remaining = dynamicImports.filter((key) => !claimed.has(key));
  if (missing.length === 1 && remaining.length === 1) {
    const row = manifest[remaining[0]];
    const domainPrefix = `src/kordynV2/domains/${missing[0]}/`;
    const children = [...(Array.isArray(row?.imports) ? row.imports : []), ...(Array.isArray(row?.dynamicImports) ? row.dynamicImports : [])];
    const ownsDomainChild = children.some((key) => key.startsWith(domainPrefix) || manifest[key]?.src?.startsWith(domainPrefix));
    if (row?.isDynamicEntry === true && validOwnedCss(row) && ownsDomainChild) resolved[missing[0]] = remaining[0];
  }
  for (const [domainId] of definitions) {
    const entry = resolved[domainId];
    if (!entry) throw new Error(missing.length > 1 || remaining.length > 1 ? `ambiguous_${domainId}_entry` : `missing_${domainId}_entry`);
    if (!dynamicImports.includes(entry)) throw new Error(`${domainId}_entry_not_owned_by_v2_lazy_graph`);
  }
  return Object.freeze(resolved);
}

function staticClosure(manifest, entryKey) {
  const visited = new Set();
  const pending = [entryKey];
  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    const row = manifest[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`missing_manifest_chunk:${key}`);
    }
    visited.add(key);
    const imports = row.imports ?? [];
    if (!Array.isArray(imports) || imports.some((value) => typeof value !== "string" || !value)) {
      throw new Error(`invalid_manifest_imports:${key}`);
    }
    for (const imported of imports) pending.push(imported);
  }
  return visited;
}

function assetsForClosure(manifest, closure) {
  const files = new Set();
  const css = new Set();
  for (const key of closure) {
    const row = manifest[key];
    if (typeof row.file !== "string" || !row.file) throw new Error(`missing_manifest_file:${key}`);
    files.add(row.file);
    const styles = row.css ?? [];
    if (!Array.isArray(styles) || styles.some((value) => typeof value !== "string" || !value)) {
      throw new Error(`invalid_manifest_css:${key}`);
    }
    for (const file of styles) {
      css.add(file);
      files.add(file);
    }
  }
  return { files, css };
}

function sizeOf(assetStats, file, field) {
  const stats = assetStats[file];
  if (!stats) throw new Error(`missing_asset_size:${file}`);
  const value = stats[field];
  if (field === "gzip" && value == null) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error(`non_finite_asset_size:${file}:${field}`);
  return value;
}

function summarize(entry, assets, assetStats, extra = {}) {
  let js = 0;
  let jsGzip = 0;
  let css = 0;
  let cssGzip = 0;
  let jsGzipComplete = true;
  let cssGzipComplete = true;
  for (const file of assets.files) {
    const raw = sizeOf(assetStats, file, "raw");
    const gzip = sizeOf(assetStats, file, "gzip");
    if (assets.css.has(file)) {
      css += raw;
      if (gzip == null) cssGzipComplete = false;
      else cssGzip += gzip;
    } else if (file.endsWith(".js")) {
      js += raw;
      if (gzip == null) jsGzipComplete = false;
      else jsGzip += gzip;
    }
  }
  return {
    entry,
    js,
    jsGzip: jsGzipComplete ? jsGzip : null,
    css,
    cssGzip: cssGzipComplete ? cssGzip : null,
    assets: [...assets.files].sort(),
    ...extra
  };
}

export function analyzeV2BuildManifest({ manifest: manifestInput, assetStats: assetStatsInput } = {}) {
  const manifest = record(manifestInput, "manifest");
  const assetStats = record(assetStatsInput, "asset_stats");
  const publicEntry = uniquePublicEntry(manifest);
  const v2Entry = resolveV2Entry(manifest, publicEntry);
  const legacyEntry = uniqueEntry(manifest, "src/classicStyles.js", "legacy");
  const domainEntries = resolveDomainEntries(manifest, v2Entry);
  const aiEntry = domainEntries.ai;
  const accountEntry = domainEntries.account;
  const assetsEntry = domainEntries.assets;
  const governanceEntry = domainEntries.governance;
  const dynamicImports = manifest[publicEntry]?.dynamicImports;
  if (!Array.isArray(dynamicImports) || !dynamicImports.includes(v2Entry)) {
    throw new Error("v2_entry_not_owned_by_public_graph");
  }
  if (!dynamicImports.includes(legacyEntry)) {
    throw new Error("legacy_entry_not_owned_by_public_graph");
  }
  const publicClosure = staticClosure(manifest, publicEntry);
  const v2Closure = staticClosure(manifest, v2Entry);
  const legacyClosure = staticClosure(manifest, legacyEntry);
  const aiClosure = staticClosure(manifest, aiEntry);
  const accountClosure = staticClosure(manifest, accountEntry);
  const assetsClosure = staticClosure(manifest, assetsEntry);
  const governanceClosure = staticClosure(manifest, governanceEntry);
  if (v2Closure.has(legacyEntry)) throw new Error("v2_imports_legacy_styles");
  if (aiClosure.has(legacyEntry)) throw new Error("ai_imports_legacy_styles");
  if (accountClosure.has(legacyEntry)) throw new Error("account_imports_legacy_styles");
  if (assetsClosure.has(legacyEntry)) throw new Error("assets_imports_legacy_styles");
  if (governanceClosure.has(legacyEntry)) throw new Error("governance_imports_legacy_styles");

  const publicAssets = assetsForClosure(manifest, publicClosure);
  const v2Assets = assetsForClosure(manifest, v2Closure);
  const legacyAssets = assetsForClosure(manifest, legacyClosure);
  const aiAssets = assetsForClosure(manifest, aiClosure);
  const aiShellAssets = assetsForClosure(manifest, new Set([...v2Closure, ...aiClosure]));
  const accountAssets = assetsForClosure(manifest, accountClosure);
  const assetsDomainAssets = assetsForClosure(manifest, assetsClosure);
  const governanceAssets = assetsForClosure(manifest, governanceClosure);
  const forbiddenLegacyCss = [...aiShellAssets.css].filter((file) => legacyAssets.css.has(file)).sort();
  if (forbiddenLegacyCss.length > 0) {
    throw new Error(`v2_loads_legacy_css:${forbiddenLegacyCss.join(",")}`);
  }
  const domainDefinitions = [
    ["ai", aiEntry, aiAssets],
    ["account", accountEntry, accountAssets],
    ["assets", assetsEntry, assetsDomainAssets],
    ["governance", governanceEntry, governanceAssets]
  ];
  const domainCss = Object.fromEntries(domainDefinitions.map(([domainId, , domainAssets]) => {
    const forbidden = [...domainAssets.css].filter((file) => legacyAssets.css.has(file)).sort();
    if (forbidden.length > 0) throw new Error(`${domainId}_loads_legacy_css:${forbidden.join(",")}`);
    return [domainId, {
      forbidden,
      shared: [...domainAssets.css].filter((file) => v2Assets.css.has(file)).sort()
    }];
  }));

  const publicReport = summarize(publicEntry, publicAssets, assetStats);
  const aiShell = summarize(v2Entry, aiShellAssets, assetStats, {
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss
  });
  const legacy = summarize(legacyEntry, legacyAssets, assetStats);
  const aiDomain = summarize(aiEntry, aiAssets, assetStats, {
    lazyOwnedBy: v2Entry,
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: domainCss.ai.forbidden,
    sharedShellCss: domainCss.ai.shared
  });
  const accountDomain = summarize(accountEntry, accountAssets, assetStats, {
    lazyOwnedBy: v2Entry,
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: domainCss.account.forbidden,
    sharedShellCss: domainCss.account.shared
  });
  const assetsDomain = summarize(assetsEntry, assetsDomainAssets, assetStats, {
    lazyOwnedBy: v2Entry,
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: domainCss.assets.forbidden,
    sharedShellCss: domainCss.assets.shared
  });
  const governanceDomain = summarize(governanceEntry, governanceAssets, assetStats, {
    lazyOwnedBy: v2Entry,
    loadsLegacyProductStyles: false,
    forbiddenLegacyCss: domainCss.governance.forbidden,
    sharedShellCss: domainCss.governance.shared
  });
  return {
    public: publicReport,
    routes: { aiShell, legacy, aiDomain, accountDomain, assetsDomain, governanceDomain },
    budgets: {
      publicCss: {
        actual: publicReport.css,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.publicCss,
        pass: publicReport.css < KORDYN_V2_PERFORMANCE_BUDGETS.publicCss
      },
      publicJs: {
        actual: publicReport.js,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.publicJs,
        pass: publicReport.js < KORDYN_V2_PERFORMANCE_BUDGETS.publicJs
      },
      aiShellCss: {
        actual: aiShell.css,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.aiShellCss,
        pass: aiShell.css < KORDYN_V2_PERFORMANCE_BUDGETS.aiShellCss
      },
      accountDomainCss: {
        actual: accountDomain.css,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.accountDomainCss,
        pass: accountDomain.css < KORDYN_V2_PERFORMANCE_BUDGETS.accountDomainCss
      },
      assetsDomainCss: {
        actual: assetsDomain.css,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.assetsDomainCss,
        pass: assetsDomain.css < KORDYN_V2_PERFORMANCE_BUDGETS.assetsDomainCss
      },
      governanceDomainCss: {
        actual: governanceDomain.css,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.governanceDomainCss,
        pass: governanceDomain.css < KORDYN_V2_PERFORMANCE_BUDGETS.governanceDomainCss
      },
      governanceDomainJs: {
        actual: governanceDomain.js,
        limit: KORDYN_V2_PERFORMANCE_BUDGETS.governanceDomainJs,
        pass: governanceDomain.js < KORDYN_V2_PERFORMANCE_BUDGETS.governanceDomainJs
      }
    }
  };
}

function containedPath(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`unsafe_${label}_path:${candidate}`);
  }
  return candidate;
}

function manifestAssets(manifest) {
  const files = new Set();
  for (const [key, row] of Object.entries(manifest)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`invalid_manifest_chunk:${key}`);
    const candidates = [row.file, ...(row.css ?? []), ...(row.assets ?? [])];
    for (const file of candidates) {
      if (typeof file !== "string" || !file || path.isAbsolute(file)) {
        throw new Error(`invalid_manifest_asset:${key}`);
      }
      const normalized = path.normalize(file);
      if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
        throw new Error(`manifest_asset_escape:${file}`);
      }
      files.add(normalized);
    }
  }
  return [...files].sort();
}

async function readAssetStats(dist, manifest) {
  const realDist = await realpath(dist);
  const stats = {};
  for (const file of manifestAssets(manifest)) {
    const target = containedPath(realDist, path.resolve(realDist, file), "asset");
    const resolved = await realpath(target).catch(() => {
      throw new Error(`missing_build_asset:${file}`);
    });
    containedPath(realDist, resolved, "asset");
    const identity = await lstat(resolved);
    if (!identity.isFile() || identity.isSymbolicLink()) throw new Error(`invalid_build_asset:${file}`);
    const bytes = await readFile(resolved);
    stats[file] = Object.freeze({ raw: bytes.length, gzip: gzipSync(bytes).length });
  }
  return Object.freeze(stats);
}

async function removeOwnedBuildRoot({ buildRoot, temporaryParent, identity, marker, ownerToken }) {
  containedPath(temporaryParent, buildRoot, "cleanup");
  if (!path.basename(buildRoot).startsWith("kordyn-v2-performance-")) {
    throw new Error(`unsafe_cleanup_name:${buildRoot}`);
  }
  const current = await lstat(buildRoot);
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new Error(`unsafe_cleanup_identity:${buildRoot}`);
  }
  const markerIdentity = await lstat(marker);
  if (!markerIdentity.isFile() || markerIdentity.isSymbolicLink() || await readFile(marker, "utf8") !== ownerToken) {
    throw new Error(`unsafe_cleanup_owner:${buildRoot}`);
  }
  await rm(buildRoot, { recursive: true, force: false });
  try {
    await access(buildRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`cleanup_failed:${buildRoot}`);
}

export async function buildV2PerformanceReport({
  root = repositoryRoot,
  temporaryParent = os.tmpdir(),
  build = viteBuild
} = {}) {
  if (typeof build !== "function") throw new Error("invalid_build_function");
  const realRoot = await realpath(root);
  const realTemporaryParent = await realpath(temporaryParent);
  const temporaryIdentity = await lstat(realTemporaryParent);
  if (!temporaryIdentity.isDirectory() || temporaryIdentity.isSymbolicLink()) {
    throw new Error("invalid_temporary_parent");
  }
  const buildRoot = await mkdtemp(path.join(realTemporaryParent, "kordyn-v2-performance-"));
  const identity = await lstat(buildRoot);
  const ownerToken = randomUUID();
  const marker = path.join(buildRoot, ".owner");
  await writeFile(marker, ownerToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const dist = path.join(buildRoot, "dist");
  try {
    await build({
      root: realRoot,
      logLevel: "silent",
      build: {
        outDir: dist,
        emptyOutDir: true,
        manifest: true
      }
    });
    const manifestFile = path.join(dist, ".vite/manifest.json");
    const manifestResolved = await realpath(manifestFile).catch(() => {
      throw new Error("missing_vite_manifest");
    });
    containedPath(await realpath(dist), manifestResolved, "manifest");
    const manifest = JSON.parse(await readFile(manifestResolved, "utf8"));
    const assetStats = await readAssetStats(dist, manifest);
    return {
      result: "PASS",
      freshBuild: true,
      ...analyzeV2BuildManifest({ manifest, assetStats }),
      build: {
        manifest: ".vite/manifest.json",
        output: "isolated temporary directory",
        cleanup: "verified in finally"
      }
    };
  } finally {
    await removeOwnedBuildRoot({
      buildRoot,
      temporaryParent: realTemporaryParent,
      identity,
      marker,
      ownerToken
    });
  }
}
import { randomUUID } from "node:crypto";
import { access, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
