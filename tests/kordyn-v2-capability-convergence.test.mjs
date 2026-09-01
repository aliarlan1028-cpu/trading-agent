import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-capability-convergence");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { DEPLOYED_FEATURES } from "./src/productCoverage.js";
      export { KORDYN_V2_CAPABILITY_SURFACES } from "./src/kordynV2/architecture/capabilitySurfaces.js";
      export { KORDYN_V2_OBJECT_CONTRACTS, KORDYN_V2_REQUIRED_OBJECT_TYPES } from "./src/kordynV2/architecture/objectContracts.js";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});

const {
  DEPLOYED_FEATURES,
  KORDYN_V2_CAPABILITY_SURFACES,
  KORDYN_V2_OBJECT_CONTRACTS,
  KORDYN_V2_REQUIRED_OBJECT_TYPES
} = require(outFile);

const REQUIRED_OBJECT_TYPES = Object.freeze([
  "Mission", "Signal", "Market", "Account", "Position", "Plan", "Order", "Fill",
  "Event", "Event source", "Watch", "Strategy product", "Strategy", "Knowledge source",
  "Evidence", "Capability", "Validation run", "Review", "Owner candidate", "Mandate",
  "Risk rule", "Risk incident", "Task", "Agent run", "Notification", "Audit log", "Recovery record",
  "Configuration item"
]);

test("all 66 deployed capabilities resolve to implemented Desktop and APP surfaces", () => {
  assert.equal(DEPLOYED_FEATURES.length, 66);
  assert.equal(Object.keys(KORDYN_V2_CAPABILITY_SURFACES).length, 66);
  assert.deepEqual(Object.keys(KORDYN_V2_CAPABILITY_SURFACES), DEPLOYED_FEATURES.map((feature) => feature.id));

  for (const feature of DEPLOYED_FEATURES) {
    const surface = KORDYN_V2_CAPABILITY_SURFACES[feature.id];
    assert.ok(surface, feature.id);
    assert.equal(surface.id, feature.id, `${feature.id}: id`);
    assert.equal(typeof surface.desktop?.component, "function", `${feature.id}: Desktop component`);
    assert.equal(typeof surface.mobile?.component, "function", `${feature.id}: APP component`);
    assert.ok(surface.desktop?.entry, `${feature.id}: Desktop entry`);
    assert.ok(surface.mobile?.entry, `${feature.id}: APP entry`);
    assert.ok(surface.route?.domainId && surface.route?.workspaceId && surface.route?.legacyRoute, `${feature.id}: route`);
    assert.ok(surface.actionBoundary, `${feature.id}: action`);
    assert.ok(surface.permissionBoundary, `${feature.id}: permission`);
    assert.ok(surface.resourceStateBoundary, `${feature.id}: state`);
    assert.equal(surface.objects.length > 0 || surface.viewOnly === true, true, `${feature.id}: object/view`);
  }
});

test("all selectable object types update the shell object, Context, and Proof identity", () => {
  assert.deepEqual(KORDYN_V2_REQUIRED_OBJECT_TYPES, REQUIRED_OBJECT_TYPES);
  assert.deepEqual(Object.keys(KORDYN_V2_OBJECT_CONTRACTS), REQUIRED_OBJECT_TYPES);

  for (const type of REQUIRED_OBJECT_TYPES) {
    const contract = KORDYN_V2_OBJECT_CONTRACTS[type];
    assert.ok(contract?.identity, `${type}: identity`);
    assert.ok(contract?.canonicalType, `${type}: canonical type`);
    assert.ok(contract?.domainId && contract?.workspaceId, `${type}: route ownership`);
    assert.ok(Array.isArray(contract.collections) && contract.collections.length > 0, `${type}: source collection`);
    assert.deepEqual(contract.selectionUpdates, ["object", "context", "proof"], `${type}: selection projections`);
    assert.equal(contract.failClosed, true, `${type}: fail closed`);
  }
});

test("capability object declarations resolve only through declared canonical contracts", () => {
  for (const [featureId, surface] of Object.entries(KORDYN_V2_CAPABILITY_SURFACES)) {
    for (const type of surface.objects) {
      assert.ok(KORDYN_V2_OBJECT_CONTRACTS[type], `${featureId}: ${type}`);
    }
  }
});
