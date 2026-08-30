import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-position-workspace");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { PositionWorkspace, positionSelectionCandidate } from "./src/kordynV2/domains/account/PositionWorkspace.jsx";
      export { PositionRegistry } from "./src/kordynV2/domains/account/PositionRegistry.jsx";
      export { PositionInspector, executionSelectionCandidate } from "./src/kordynV2/domains/account/PositionInspector.jsx";
      export { MobilePositionScreen } from "./src/kordynV2/domains/account/MobilePositionScreen.jsx";
      export { DesktopShell } from "./src/kordynV2/shell/DesktopShell.jsx";
      export { MobileShell } from "./src/kordynV2/shell/MobileShell.jsx";
      export { buildAccountDomainModel } from "./src/kordynV2/domains/account/accountModel.js";
      export { runAccountAction, requestPositionExit } from "./src/kordynV2/domains/account/index.jsx";
      export { createV2Selection } from "./src/kordynV2/viewModels/selection.js";
      export { normalizePositionsForUi } from "./server/positionView.mjs";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});

const {
  PositionWorkspace, PositionRegistry, PositionInspector, MobilePositionScreen, DesktopShell, MobileShell,
  buildAccountDomainModel, createV2Selection, executionSelectionCandidate,
  positionSelectionCandidate, requestPositionExit, runAccountAction, normalizePositionsForUi
} = require(outFile);

const resourceState = { cockpit: "loaded" };
const validPosition = (overrides = {}) => ({
  positionId: "position-1", symbol: "ETH/USDT", direction: "long", source: "execution_engine",
  accountId: "account-okx", exchange: "OKX",
  quantity: 2.4, entry: 3420.5, mark: 3468.2, liquidationPrice: 1980,
  unrealizedPnl: 114.48, notional: 8323.68, margin: 2774.56, leverage: 3,
  liqDistancePct: 42.6, stopLoss: 3365, takeProfits: [3515, 3590],
  executionOrderId: "execution-1", planId: "plan-1", openedAt: "2026-08-30T05:00:00Z",
  rawSyncedAt: "2026-08-30T06:00:00Z",
  ...overrides
});
const validExecution = (overrides = {}) => ({
  id: "execution-1", positionId: "position-1", planId: "plan-1", agentRunId: "run-1",
  symbol: "ETH/USDT", direction: "long", status: "protecting", filledQuantity: 2.4,
  stopClientOrderId: "stop-execution-1", exchange: "OKX", accountId: "account-okx",
  ...overrides
});
const validSnapshot = (overrides = {}) => ({
  id: "snapshot-1", accountId: "account-okx", exchange: "OKX", status: "ok",
  createdAt: "2026-08-30T06:00:00Z", algoOrdersComplete: true,
  algoOrders: [{ instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-1", slTriggerPx: "3365" }],
  ...overrides
});
const rawEnginePosition = (overrides = {}) => validPosition({
  id: undefined, positionId: "position-1", instId: "ETH-USDT-SWAP", rawSyncedAt: undefined,
  accountId: undefined, exchange: undefined, ...overrides
});
const rawExchangeMirror = (accountId, exchange, rawSyncedAt, overrides = {}) => ({
  id: `mirror-${accountId}-${exchange}`, positionId: `mirror-${accountId}-${exchange}`,
  symbol: "ETH/USDT", instId: "ETH-USDT-SWAP", source: "exchange_rest", direction: "long", posSide: "long",
  coinSize: 2.4, mark: 3468.2, entry: 3420.5, liqPx: 1980, leverage: 3, pnl: 114.48,
  accountId, exchange, rawSyncedAt, ...overrides
});
const modelNow = Date.parse("2026-08-30T06:01:00Z");
const modelFixture = (overrides = {}) => buildAccountDomainModel({
  resourceState, positions: [validPosition()], executionOrders: [validExecution()],
  accountSnapshots: [validSnapshot()], reconciliationReports: [], riskIncidents: [], ...overrides
}, { now: modelNow });

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.type === "function") return findElement(node.type(node.props), predicate);
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("position model uses canonical fallback identities and preserves missing finance versus authoritative zero", () => {
  const model = buildAccountDomainModel({
    positions: [
      validPosition({ id: undefined, positionId: "position-native", quantity: 1, mark: 0, unrealizedPnl: 0, notional: 0, margin: 0 }),
      validPosition({ id: undefined, positionId: undefined, instId: "BTC-USDT-SWAP", symbol: "BTC/USDT", executionOrderId: undefined }),
      validPosition({ id: undefined, positionId: undefined, instId: undefined, symbol: "SOL/USDT", executionOrderId: undefined })
    ],
    executionOrders: [], accountSnapshots: [], riskIncidents: []
  });
  assert.deepEqual(model.positions.map((row) => row.id), ["position-native", "BTC-USDT-SWAP", "SOL/USDT"]);
  assert.equal(model.positions[0].quantity, 1);
  assert.equal(model.positions[0].mark, 0);
  assert.equal(model.positions[0].unrealizedPnl, 0);
  assert.equal(model.positions[0].notional, 0);
});

test("stopLossPrice is a descriptor-safe canonical stop fallback without inventing zero", () => {
  const hostile = {};
  Object.defineProperty(hostile, "stopLossPrice", { enumerable: true, get() { throw new Error("must not run"); } });
  const model = buildAccountDomainModel({
    positions: [
      validPosition({ positionId: "numeric-stop", stopLoss: undefined, stopLossPrice: 3360, executionOrderId: undefined }),
      validPosition({ positionId: "string-stop", stopLoss: undefined, stopLossPrice: "3370.5", executionOrderId: undefined }),
      validPosition({ positionId: "missing-stop", stopLoss: undefined, stopLossPrice: undefined, executionOrderId: undefined }),
      validPosition({ positionId: "invalid-stop", stopLoss: undefined, stopLossPrice: "not-a-price", executionOrderId: undefined }),
      hostile
    ],
    executionOrders: [], accountSnapshots: [], riskIncidents: []
  });
  assert.deepEqual(model.positions.map((position) => [position.id, position.stopLoss]), [
    ["numeric-stop", 3360], ["string-stop", 3370.5], ["missing-stop", null]
  ]);
  const html = renderToStaticMarkup(React.createElement(PositionWorkspace, {
    model,
    selection: { object: { id: "numeric-stop", type: "Position" } }
  }));
  assert.match(html, /<dt>止损<\/dt><dd>3,360\.00<\/dd>/);
  assert.doesNotMatch(html, /invalid-stop|must not run/);
});

test("malformed placeholder and duplicate Position identities fail closed while a valid sibling remains", () => {
  const hostile = {};
  Object.defineProperty(hostile, "positionId", { enumerable: true, get() { throw new Error("must not escape"); } });
  const model = buildAccountDomainModel({
    positions: [
      validPosition({ positionId: "duplicate" }),
      validPosition({ positionId: "duplicate", symbol: "BTC/USDT" }),
      validPosition({ positionId: "Unavailable", symbol: "SOL/USDT" }), hostile,
      validPosition({ positionId: "position-safe", symbol: "LINK/USDT", executionOrderId: undefined })
    ],
    executionOrders: [], accountSnapshots: [], riskIncidents: []
  });
  assert.deepEqual(model.positions.map((row) => row.id), ["position-safe"]);
  assert.equal(positionSelectionCandidate(model.positions[0]).id, "position-safe");
  assert.equal(positionSelectionCandidate({ id: "Unavailable" }), null);
});

test("source-backed protection distinguishes verified failed degraded and unavailable evidence", () => {
  const verified = modelFixture();
  assert.deepEqual(
    { state: verified.positions[0].protection.state, stopPrice: verified.positions[0].protection.stopPrice, snapshotId: verified.positions[0].protection.snapshotId },
    { state: "verified", stopPrice: 3365, snapshotId: "snapshot-1" }
  );
  const failed = modelFixture({ accountSnapshots: [validSnapshot({ algoOrders: [] })] });
  assert.equal(failed.positions[0].protection.state, "failed");
  assert.equal(failed.positions[0].protection.reason, "exchange_stop_missing");
  const degraded = modelFixture({ accountSnapshots: [validSnapshot({ status: "degraded", algoOrdersComplete: false })] });
  assert.equal(degraded.positions[0].protection.state, "degraded");
  assert.equal(degraded.positions[0].protection.reason, "account_snapshot_degraded");
  const unavailable = modelFixture({ positions: [validPosition({ source: "exchange_rest", executionOrderId: undefined })], executionOrders: [], accountSnapshots: [] });
  assert.equal(unavailable.positions[0].protection.state, "unavailable");
  assert.equal(unavailable.positions[0].ownership, "manual_external");
});

test("raw engine and selected exchange mirror reach verified protection through the real UI normalizer", () => {
  const rawPositions = [
    validPosition({ id: "engine-position-1", positionId: "position-1", instId: undefined, rawSyncedAt: undefined }),
    {
      id: "exchange-position-1", positionId: "exchange-position-1", symbol: "ETH/USDT", instId: "ETH-USDT-SWAP",
      source: "exchange_rest", direction: "long", posSide: "long", coinSize: 2.4, mark: 3468.2,
      entry: 3420.5, liqPx: 1980, leverage: 3, pnl: 114.48, accountId: "account-okx",
      exchange: "OKX", rawSyncedAt: "2026-08-30T06:00:00Z"
    }
  ];
  const positions = normalizePositionsForUi(rawPositions, { executionOrders: [validExecution()] });
  const model = buildAccountDomainModel({
    resourceState, positions, executionOrders: [validExecution()], accountSnapshots: [validSnapshot()], riskIncidents: []
  }, { now: modelNow });
  assert.equal(positions.length, 1);
  assert.deepEqual(
    { state: model.positions[0].protection.state, snapshotId: model.positions[0].protection.snapshotId },
    { state: "verified", snapshotId: "snapshot-1" }
  );
});

test("conflicting Execution account aliases fail closed through normalize and the Account model", () => {
  const at = "2026-08-30T06:00:00Z";
  const conflictingExecution = validExecution({ accountId: "account-a", exchangeAccountId: "account-b", exchange: "OKX" });
  for (const snapshot of [
    validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at }),
    validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at, algoOrders: [] })
  ]) {
    const positions = normalizePositionsForUi([
      rawEnginePosition(), rawExchangeMirror("account-a", "OKX", at)
    ], { executionOrders: [conflictingExecution] });
    const managed = positions.find((position) => position.source === "execution_engine");
    const model = buildAccountDomainModel({
      resourceState, positions, executionOrders: [conflictingExecution], accountSnapshots: [snapshot], riskIncidents: []
    }, { now: Date.parse(at) + 60_000 });
    const protection = model.positions.find((position) => position.id === managed?.positionId)?.protection;
    assert.equal(managed?.rawSyncedAt, null);
    assert.notEqual(protection?.state, "verified");
    assert.notEqual(protection?.reason, "exchange_stop_missing");
  }
});

test("conflicting mirror account aliases cannot contribute protected provenance", () => {
  const at = "2026-08-30T06:00:00Z";
  const execution = validExecution({ accountId: "account-a", exchange: "OKX" });
  for (const snapshot of [
    validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at }),
    validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at, algoOrders: [] })
  ]) {
    const positions = normalizePositionsForUi([
      rawEnginePosition(),
      rawExchangeMirror("account-a", "OKX", at, { exchangeAccountId: "account-b" })
    ], { executionOrders: [execution] });
    const managed = positions.find((position) => position.source === "execution_engine");
    const model = buildAccountDomainModel({
      resourceState, positions, executionOrders: [execution], accountSnapshots: [snapshot], riskIncidents: []
    }, { now: Date.parse(at) + 60_000 });
    const protection = model.positions.find((position) => position.id === managed?.positionId)?.protection;
    assert.deepEqual(
      { rawSyncedAt: managed?.rawSyncedAt, accountId: managed?.accountId, exchange: managed?.exchange },
      { rawSyncedAt: null, accountId: null, exchange: null }
    );
    assert.notEqual(protection?.state, "verified");
    assert.notEqual(protection?.reason, "exchange_stop_missing");
  }
});

test("identical account aliases remain valid while invalid-present and accessor aliases fail closed without throws", () => {
  const at = "2026-08-30T06:00:00Z";
  const execution = validExecution({ accountId: "account-a", exchangeAccountId: "account-a", connectionAccountId: "account-a", exchange: "OKX" });
  const identical = normalizePositionsForUi([
    rawEnginePosition(),
    rawExchangeMirror("account-a", "OKX", at, { exchangeAccountId: "account-a", connectionAccountId: "account-a" })
  ], { executionOrders: [execution] });
  const identicalModel = buildAccountDomainModel({
    resourceState, positions: identical, executionOrders: [execution],
    accountSnapshots: [validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at })], riskIncidents: []
  }, { now: Date.parse(at) + 60_000 });
  assert.equal(identicalModel.positions.find((position) => position.id === "position-1")?.protection.state, "verified");

  const accessorMirror = rawExchangeMirror("account-a", "OKX", at);
  Object.defineProperty(accessorMirror, "exchangeAccountId", {
    enumerable: true,
    get() { throw new Error("account alias accessor must not run"); }
  });
  const proxyMirror = new Proxy(rawExchangeMirror("account-a", "OKX", at), {
    getOwnPropertyDescriptor(target, field) {
      if (field === "accountId") throw new Error("account alias descriptor must not escape");
      return Reflect.getOwnPropertyDescriptor(target, field);
    }
  });
  for (const { label, mirror, keepsDisplayFacts } of [
    { label: "invalid-present", mirror: rawExchangeMirror("account-a", "OKX", at, { exchangeAccountId: 17 }), keepsDisplayFacts: true },
    { label: "accessor", mirror: accessorMirror, keepsDisplayFacts: false },
    { label: "proxy-descriptor", mirror: proxyMirror, keepsDisplayFacts: false }
  ]) {
    let model;
    let normalized;
    assert.doesNotThrow(() => {
      normalized = normalizePositionsForUi([rawEnginePosition(), mirror], { executionOrders: [execution] });
      model = buildAccountDomainModel({
        resourceState, positions: normalized, executionOrders: [execution],
        accountSnapshots: [validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at })], riskIncidents: []
      }, { now: Date.parse(at) + 60_000 });
    });
    const mirrorRow = normalized.find((position) => position.source === "exchange_rest");
    if (keepsDisplayFacts) {
      assert.deepEqual(
        { rawSyncedAt: mirrorRow?.rawSyncedAt, accountId: mirrorRow?.accountId, exchange: mirrorRow?.exchange },
        { rawSyncedAt: null, accountId: null, exchange: null }
      );
    } else assert.equal(mirrorRow, undefined);
    assert.notEqual(model.positions.find((position) => position.id === "position-1")?.protection.state, "verified", label);
  }

  const accessorExecution = validExecution({ accountId: "account-a", exchange: "OKX" });
  Object.defineProperty(accessorExecution, "exchangeAccountId", {
    enumerable: true,
    get() { throw new Error("execution account alias accessor must not run"); }
  });
  const proxyExecution = new Proxy(validExecution({ accountId: "account-a", exchange: "OKX" }), {
    getOwnPropertyDescriptor(target, field) {
      if (field === "accountId") throw new Error("execution account alias descriptor must not escape");
      return Reflect.getOwnPropertyDescriptor(target, field);
    }
  });
  for (const hostileExecution of [
    validExecution({ accountId: "account-a", exchangeAccountId: 17, exchange: "OKX" }),
    accessorExecution,
    proxyExecution
  ]) {
    let model;
    let normalized;
    assert.doesNotThrow(() => {
      normalized = normalizePositionsForUi([
        rawEnginePosition(), rawExchangeMirror("account-a", "OKX", at)
      ], { executionOrders: [hostileExecution] });
      model = buildAccountDomainModel({
        resourceState, positions: normalized, executionOrders: [hostileExecution],
        accountSnapshots: [validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at })], riskIncidents: []
      }, { now: Date.parse(at) + 60_000 });
    });
    const managed = normalized.find((position) => position.source === "execution_engine");
    assert.deepEqual(
      { rawSyncedAt: managed?.rawSyncedAt, accountId: managed?.accountId, exchange: managed?.exchange },
      { rawSyncedAt: null, accountId: null, exchange: null }
    );
    const protection = model.positions.find((position) => position.id === "position-1")?.protection;
    assert.notEqual(protection?.state, "verified");
    assert.notEqual(protection?.reason, "exchange_stop_missing");
  }
});

test("a hostile Position sibling cannot hide a correct account-bound verified protection chain", () => {
  const at = "2026-08-30T06:00:00Z";
  const revoked = Proxy.revocable(rawExchangeMirror("account-hostile", "OKX", at), {});
  revoked.revoke();
  let model;
  let positions;
  assert.doesNotThrow(() => {
    positions = normalizePositionsForUi([
      rawEnginePosition(), rawExchangeMirror("account-okx", "OKX", at), revoked.proxy
    ], { executionOrders: [validExecution()] });
    model = buildAccountDomainModel({
      resourceState, positions, executionOrders: [validExecution()],
      accountSnapshots: [validSnapshot({ createdAt: at })], riskIncidents: []
    }, { now: Date.parse(at) + 60_000 });
  });
  assert.equal(positions.length, 1);
  assert.deepEqual(
    { accountId: positions[0].accountId, exchange: positions[0].exchange, rawSyncedAt: positions[0].rawSyncedAt },
    { accountId: "account-okx", exchange: "OKX", rawSyncedAt: at }
  );
  assert.equal(model.positions[0].protection.state, "verified");
});

test("frontend protection independently rejects conflicting or invalid normalized account aliases", () => {
  const at = "2026-08-30T06:00:00Z";
  const snapshot = validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at });
  const cases = [
    {
      position: validPosition({ accountId: "account-a", exchangeAccountId: "account-b", exchange: "OKX", rawSyncedAt: at }),
      execution: validExecution({ accountId: "account-a", exchange: "OKX" })
    },
    {
      position: validPosition({ accountId: "account-a", exchangeAccountId: 17, exchange: "OKX", rawSyncedAt: at }),
      execution: validExecution({ accountId: "account-a", exchange: "OKX" })
    },
    {
      position: validPosition({ accountId: "account-a", exchange: "OKX", rawSyncedAt: at }),
      execution: validExecution({ accountId: "account-a", exchangeAccountId: "account-b", exchange: "OKX" })
    }
  ];
  for (const { position, execution: row } of cases) {
    const model = buildAccountDomainModel({
      resourceState, positions: [position], executionOrders: [row], accountSnapshots: [snapshot], riskIncidents: []
    }, { now: Date.parse(at) + 60_000 });
    const protection = model.positions[0]?.protection;
    assert.notEqual(protection?.state, "verified");
    assert.notEqual(protection?.reason, "exchange_stop_missing");
  }
});

test("normalizer never cross-binds an A execution to a B account or exchange mirror", () => {
  const at = "2026-08-30T06:00:00Z";
  const executionA = validExecution({ accountId: "account-a", exchange: "OKX" });
  const snapshotA = validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at });
  for (const mirror of [
    rawExchangeMirror("account-b", "OKX", at),
    rawExchangeMirror("account-a", "BINANCE", at)
  ]) {
    const positions = normalizePositionsForUi([rawEnginePosition(), mirror], { executionOrders: [executionA] });
    const managed = positions.find((position) => position.source === "execution_engine");
    assert.deepEqual(
      { rawSyncedAt: managed?.rawSyncedAt, accountId: managed?.accountId, exchange: managed?.exchange },
      { rawSyncedAt: null, accountId: null, exchange: null }
    );
    const model = buildAccountDomainModel({
      resourceState, positions, executionOrders: [executionA], accountSnapshots: [snapshotA], riskIncidents: []
    }, { now: Date.parse(at) + 60_000 });
    const projected = model.positions.find((position) => position.id === "position-1");
    assert.notEqual(projected?.protection.state, "verified");
  }
});

test("execution account binding selects A mirror even when B is newer or shares its timestamp", () => {
  const atA = "2026-08-30T06:00:00Z";
  const atB = "2026-08-30T06:01:00Z";
  const executionA = validExecution({ accountId: "account-a", exchange: "OKX" });
  const snapshotA = validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: atA });
  for (const mirrorB of [
    rawExchangeMirror("account-b", "OKX", atB),
    rawExchangeMirror("account-b", "OKX", atA)
  ]) {
    const positions = normalizePositionsForUi([
      rawEnginePosition(), mirrorB, rawExchangeMirror("account-a", "OKX", atA)
    ], { executionOrders: [executionA] });
    const managed = positions.find((position) => position.source === "execution_engine");
    assert.deepEqual(
      { rawSyncedAt: managed?.rawSyncedAt, accountId: managed?.accountId, exchange: managed?.exchange },
      { rawSyncedAt: atA, accountId: "account-a", exchange: "OKX" }
    );
    const model = buildAccountDomainModel({
      resourceState, positions, executionOrders: [executionA], accountSnapshots: [snapshotA], riskIncidents: []
    }, { now: Date.parse(atA) + 60_000 });
    assert.equal(model.positions.find((position) => position.id === "position-1")?.protection.state, "verified");
  }
});

test("missing or conflicting execution linkage stays unbound when mirror accounts are ambiguous", () => {
  const at = "2026-08-30T06:00:00Z";
  const mirrors = [rawExchangeMirror("account-a", "OKX", at), rawExchangeMirror("account-b", "OKX", at)];
  const missing = normalizePositionsForUi([rawEnginePosition({ executionOrderId: undefined }), ...mirrors]);
  const duplicate = normalizePositionsForUi([rawEnginePosition(), ...mirrors], {
    executionOrders: [
      validExecution({ accountId: "account-a", exchange: "OKX" }),
      validExecution({ accountId: "account-b", exchange: "OKX" })
    ]
  });
  for (const positions of [missing, duplicate]) {
    const managed = positions.find((position) => position.source === "execution_engine");
    assert.deepEqual(
      { rawSyncedAt: managed?.rawSyncedAt, accountId: managed?.accountId, exchange: managed?.exchange },
      { rawSyncedAt: null, accountId: null, exchange: null }
    );
  }
});

test("frontend protection requires normalized mirror binding to equal its related Execution", () => {
  const at = "2026-08-30T06:00:00Z";
  const executionA = validExecution({ accountId: "account-a", exchange: "OKX" });
  const snapshotA = validSnapshot({ accountId: "account-a", exchange: "OKX", createdAt: at });
  for (const position of [
    validPosition({ accountId: "account-b", exchange: "OKX", rawSyncedAt: at }),
    validPosition({ accountId: "account-a", exchange: "BINANCE", rawSyncedAt: at }),
    validPosition({ accountId: undefined, exchange: undefined, rawSyncedAt: at })
  ]) {
    const model = buildAccountDomainModel({
      resourceState, positions: [position], executionOrders: [executionA], accountSnapshots: [snapshotA], riskIncidents: []
    }, { now: Date.parse(at) + 60_000 });
    assert.deepEqual(
      { state: model.positions[0].protection.state, reason: model.positions[0].protection.reason },
      { state: "degraded", reason: "exchange_stop_snapshot_unverified" }
    );
  }
});

test("section-v2 shared common projection passes scoped execution linkage into the real position normalizer", () => {
  const source = fs.readFileSync(path.join(rootDir, "server/index.mjs"), "utf8");
  const sectionBuilder = source.match(/function buildOverviewSectionSource[\s\S]*?if \(section === "chat"\)/)?.[0] || "";
  assert.match(sectionBuilder, /positions:\s*normalizePositionsForUi\(scopedDb\.positions,\s*\{\s*executionOrders:\s*scopedDb\.executionOrders\s*\}\)/);
});

test("exchange stop absence requires a post-open current-mirror structurally trustworthy snapshot", () => {
  const preOpen = modelFixture({
    positions: [validPosition({ rawSyncedAt: "2026-08-30T04:00:00Z" })],
    accountSnapshots: [validSnapshot({ createdAt: "2026-08-30T04:00:00Z", algoOrders: [] })]
  });
  assert.deepEqual(
    { state: preOpen.positions[0].protection.state, reason: preOpen.positions[0].protection.reason },
    { state: "degraded", reason: "exchange_stop_snapshot_unverified" }
  );

  const mirrorMismatch = modelFixture({ positions: [validPosition({ rawSyncedAt: "2026-08-30T06:01:00Z" })] });
  assert.deepEqual(
    { state: mirrorMismatch.positions[0].protection.state, reason: mirrorMismatch.positions[0].protection.reason },
    { state: "degraded", reason: "exchange_stop_snapshot_unverified" }
  );

  const malformedOnly = modelFixture({
    accountSnapshots: [validSnapshot({ algoOrders: [{ instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-1", slTriggerPx: "not-a-price" }] })]
  });
  assert.deepEqual(
    { state: malformedOnly.positions[0].protection.state, reason: malformedOnly.positions[0].protection.reason },
    { state: "degraded", reason: "exchange_stop_snapshot_unverified" }
  );

  const validAmongMalformed = modelFixture({
    accountSnapshots: [validSnapshot({ algoOrders: [
      { instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-1", slTriggerPx: "bad" },
      { instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-1", slTriggerPx: "3365" }
    ] })]
  });
  assert.equal(validAmongMalformed.positions[0].protection.state, "verified");

  const trustworthyAbsence = modelFixture({ accountSnapshots: [validSnapshot({ algoOrders: [] })] });
  assert.deepEqual(
    { state: trustworthyAbsence.positions[0].protection.state, reason: trustworthyAbsence.positions[0].protection.reason },
    { state: "failed", reason: "exchange_stop_missing" }
  );
});

test("exchange stop proof enforces the deterministic two-minute freshness boundary", () => {
  const snapshotAt = Date.parse("2026-08-30T06:00:00Z");
  const inputs = {
    resourceState, positions: [validPosition()], executionOrders: [validExecution()],
    accountSnapshots: [validSnapshot()], riskIncidents: []
  };
  const boundary = buildAccountDomainModel(inputs, { now: snapshotAt + 2 * 60_000 });
  assert.equal(boundary.positions[0].protection.state, "verified");

  const stale = buildAccountDomainModel(inputs, { now: snapshotAt + 2 * 60_000 + 1 });
  assert.deepEqual(
    { state: stale.positions[0].protection.state, reason: stale.positions[0].protection.reason },
    { state: "degraded", reason: "exchange_stop_snapshot_unverified" }
  );

  const staleMissing = buildAccountDomainModel({
    ...inputs,
    accountSnapshots: [validSnapshot({ algoOrders: [] })]
  }, { now: snapshotAt + 2 * 60_000 + 1 });
  assert.deepEqual(
    { state: staleMissing.positions[0].protection.state, reason: staleMissing.positions[0].protection.reason },
    { state: "degraded", reason: "exchange_stop_snapshot_unverified" }
  );
});

test("all Desktop and APP protection surfaces share explicit four-state tone label and icon semantics", () => {
  const expectations = {
    verified: { tone: "healthy", label: "已核验", icon: "shield-check" },
    failed: { tone: "critical", label: "保护异常", icon: "shield-alert" },
    degraded: { tone: "warning", label: "证据降级", icon: "triangle-alert" },
    unavailable: { tone: "unavailable", label: "证据不可用", icon: "shield" }
  };
  const base = modelFixture();
  for (const [state, expected] of Object.entries(expectations)) {
    const position = { ...base.positions[0], protection: { ...base.positions[0].protection, state } };
    const model = { ...base, positions: [position] };
    const selection = { object: { id: position.id, type: "Position" } };
    const desktop = renderToStaticMarkup(React.createElement(PositionWorkspace, { model, selection }));
    const mobile = renderToStaticMarkup(React.createElement(MobilePositionScreen, { model, selection, view: "detail" }));
    for (const surface of ["registry", "truth", "inspector"]) {
      assert.match(desktop, new RegExp(`data-protection-surface="${surface}" data-protection-state="${state}" data-protection-tone="${expected.tone}"`));
    }
    assert.match(mobile, new RegExp(`data-protection-surface="mobile-header" data-protection-state="${state}" data-protection-tone="${expected.tone}"`));
    assert.match(desktop, new RegExp(`lucide-${expected.icon}`));
    assert.match(mobile, new RegExp(`lucide-${expected.icon}`));
    assert.match(desktop, new RegExp(expected.label));
    assert.match(mobile, new RegExp(expected.label));
  }
});

test("production shells retain one page main and Position truth has a stable labelled region", () => {
  const model = modelFixture();
  const selection = { object: { id: "position-1", type: "Position" } };
  const location = { domainId: "account", workspaceId: "positions" };
  const shellProps = {
    location, truth: { mode: "compact" }, state: { kind: "ready" }, selection,
    identity: {}, supportContext: {}, onNavigate() {}, onSelect() {}, onRetry() {}
  };
  const workspace = React.createElement(PositionWorkspace, { model, selection });
  const mobileWorkspace = React.createElement(MobilePositionScreen, { model, selection, view: "detail" });
  const desktop = renderToStaticMarkup(React.createElement(DesktopShell, shellProps, workspace));
  const mobile = renderToStaticMarkup(React.createElement(MobileShell, shellProps, mobileWorkspace));

  for (const html of [desktop, mobile]) {
    assert.equal((html.match(/<main\b/g) || []).length, 1);
    const association = html.match(/<section class="kordynV2PositionTruth[^"]*"[^>]*aria-labelledby="([^"]+)"[\s\S]*?<h2[^>]*id="([^"]+)"/);
    assert.ok(association, "Position truth must be a labelled section");
    assert.equal(association[1], association[2]);
  }

  const empty = renderToStaticMarkup(React.createElement(PositionWorkspace, { model, selection: { object: null } }));
  assert.match(empty, /<section class="kordynV2PositionTruth is-empty"[^>]*aria-labelledby="([^"]+)"[\s\S]*?<h2 id="\1">选择持仓<\/h2>/);
});

test("malformed evidence siblings cannot hide valid protection and incident facts", () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const model = modelFixture({
    accountSnapshots: [revoked.proxy, validSnapshot()],
    riskIncidents: [
      revoked.proxy,
      { id: "incident-1", executionOrderId: "execution-1", status: "open", severity: "high", title: "止损证据需要复核", source: "position_manager", createdAt: "2026-08-30T06:01:00Z" },
      { id: "incident-invalid-time", executionOrderId: "execution-1", status: "open", severity: "high", title: "must not render", createdAt: "not-a-time" }
    ]
  });
  assert.equal(model.positions[0].protection.state, "verified");
  assert.deepEqual(model.positions[0].riskIncidents.map((row) => row.id), ["incident-1"]);
  assert.deepEqual(model.availability.riskIncidents, { state: "loaded", count: 1 });
});

test("risk incident presentation preserves lifecycle and severity without overstating resolved or low risk", () => {
  const model = modelFixture({
    riskIncidents: [
      { id: "incident-open-critical", executionOrderId: "execution-1", status: "open", severity: "critical", title: "保护缺失", createdAt: "2026-08-30T06:01:00Z" },
      { id: "incident-open-low", executionOrderId: "execution-1", status: "open", severity: "low", title: "低优先级观察", createdAt: "2026-08-30T06:02:00Z" },
      { id: "incident-open-info", executionOrderId: "execution-1", status: "open", severity: "info", title: "信息记录", createdAt: "2026-08-30T06:03:00Z" },
      { id: "incident-resolved-critical", executionOrderId: "execution-1", status: "resolved", severity: "critical", title: "历史高风险已解决", createdAt: "2026-08-30T06:04:00Z" }
    ]
  });
  assert.deepEqual(model.positions[0].riskIncidents.map(({ id, status, severity }) => ({ id, status, severity })), [
    { id: "incident-open-critical", status: "open", severity: "critical" },
    { id: "incident-open-low", status: "open", severity: "low" },
    { id: "incident-open-info", status: "open", severity: "info" },
    { id: "incident-resolved-critical", status: "resolved", severity: "critical" }
  ]);
  const html = renderToStaticMarkup(React.createElement(PositionInspector, { position: model.positions[0] }));
  assert.match(html, /data-risk-incident-id="incident-open-critical" data-incident-tone="critical"/);
  assert.match(html, /data-risk-incident-id="incident-open-low" data-incident-tone="neutral"/);
  assert.match(html, /data-risk-incident-id="incident-open-info" data-incident-tone="neutral"/);
  assert.match(html, /data-risk-incident-id="incident-resolved-critical" data-incident-tone="resolved"/);
  assert.match(html, />open · critical · 2026-08-30T06:01:00Z</);
  assert.match(html, />resolved · critical · 2026-08-30T06:04:00Z</);
});

test("related execution linkage requires a unique explicit identity and never falls back to symbol", () => {
  const explicit = modelFixture();
  assert.equal(explicit.positions[0].relatedExecution.id, "execution-1");
  assert.equal(explicit.positions[0].relatedExecution.exitAction.intent, "close_position");
  const symbolOnly = modelFixture({ positions: [validPosition({ executionOrderId: undefined })], executionOrders: [validExecution({ id: "symbol-only", positionId: undefined })] });
  assert.equal(symbolOnly.positions[0].relatedExecution, null);
  const ambiguous = modelFixture({
    positions: [validPosition({ executionOrderId: undefined })],
    executionOrders: [validExecution({ id: "execution-a", positionId: "position-1" }), validExecution({ id: "execution-b", positionId: "position-1" })]
  });
  assert.equal(ambiguous.positions[0].relatedExecution, null);
  const duplicateId = modelFixture({ executionOrders: [validExecution(), validExecution({ status: "entry_filled" })] });
  assert.equal(duplicateId.positions[0].relatedExecution, null);
});

test("real Root selection keeps Position and related Execution Object Context and Trace identities aligned", () => {
  const data = {
    resourceState, positions: [validPosition()], executionOrders: [validExecution()],
    traces: [
      { id: "trace-position", workspaceId: "live", objectType: "Position", objectId: "position-1", stage: "Monitor", status: "complete" },
      { id: "trace-execution", workspaceId: "live", objectType: "Execution", objectId: "execution-1", stage: "Execute", status: "complete" }
    ]
  };
  for (const candidate of [positionSelectionCandidate({ id: "position-1" }), executionSelectionCandidate(validExecution())]) {
    const selection = createV2Selection({ data, candidate });
    assert.equal(selection.object.id, candidate.id);
    assert.equal(selection.object.type, candidate.type);
    assert.equal(selection.context.objectId, candidate.id);
    assert.equal(selection.trace.objectId, candidate.id);
  }
});

test("Desktop registry and inspector emit only complete canonical object attributes", () => {
  const model = modelFixture();
  const html = renderToStaticMarkup(React.createElement(PositionWorkspace, {
    model, truth: { mode: "full" }, state: { kind: "ready", source: "OKX", lastValidAt: "2026-08-30T06:00:00Z" },
    selection: { object: { id: "position-1", type: "Position" } }
  }));
  assert.match(html, /data-kordyn-v2-position-desktop="true"/);
  assert.match(html, /data-kordyn-v2-object-id="position-1"[^>]*data-kordyn-v2-object-type="Position"/);
  assert.match(html, /data-kordyn-v2-object-id="execution-1"[^>]*data-kordyn-v2-object-type="Execution"/);
  assert.match(html, /data-kordyn-v2-position-ledger="true"/);
  assert.match(html, /相关执行与保护记录/);
  assert.match(html, /持仓数量/);
  assert.match(html, /保护证据/);
  assert.doesNotMatch(html, /data-kordyn-v2-object-id="Unavailable"/);
  assert.doesNotMatch(html, /调整保护/);
});

test("an Execution selection keeps Position as related context without impersonating the Root canonical object", () => {
  const model = modelFixture();
  const selection = createV2Selection({
    data: {
      resourceState,
      positions: [validPosition()],
      executionOrders: [validExecution()],
      traces: [{ id: "trace-execution", workspaceId: "live", objectType: "Execution", objectId: "execution-1", stage: "Execute", status: "complete" }]
    },
    candidate: executionSelectionCandidate(validExecution())
  });
  assert.equal(selection.object.type, "Execution");
  assert.equal(selection.context.objectId, "execution-1");
  assert.equal(selection.trace.objectId, "execution-1");
  const html = renderToStaticMarkup(React.createElement(PositionWorkspace, { model, selection }));
  assert.match(html, /data-kordyn-v2-related-position-id="position-1"/);
  assert.doesNotMatch(html, /<main[^>]*data-kordyn-v2-object-id="position-1"[^>]*data-kordyn-v2-object-type="Position"/);
  assert.match(html, /data-kordyn-v2-object-type="Position"[^>]*data-selected="context"[^>]*aria-pressed="false"/);
  assert.match(html, /data-kordyn-v2-object-id="execution-1"[^>]*data-kordyn-v2-object-type="Execution"/);
});

test("duplicate presenter rows never expose partial or ambiguous Position attributes", () => {
  const duplicate = validPosition({ id: "duplicate", positionId: "duplicate", protection: { state: "unavailable" }, relatedExecution: null, riskIncidents: [] });
  const html = renderToStaticMarkup(React.createElement(PositionRegistry, { model: { positions: [duplicate, { ...duplicate, symbol: "BTC/USDT" }] } }));
  assert.doesNotMatch(html, /data-kordyn-v2-object-id=/);
  assert.doesNotMatch(html, /data-kordyn-v2-object-type=/);
  assert.match(html, /对象身份不可用/);
});

test("Position presenter events carry the exact Position and Execution candidates", () => {
  const model = modelFixture();
  const selections = [];
  const registry = PositionRegistry({ model, selection: null, onSelect: (candidate, event) => selections.push([candidate, event.currentTarget]) });
  const row = findElement(registry, (node) => node.type === "button" && node.props?.["data-kordyn-v2-object-type"] === "Position");
  row.props.onClick({ currentTarget: "position-trigger" });
  const exits = [];
  const inspector = PositionInspector({ position: model.positions[0], onSelect: (candidate) => selections.push([candidate, "execution"]), onExit: (order, surface) => exits.push([order, surface]) });
  const execution = findElement(inspector, (node) => node.type === "button" && node.props?.["data-kordyn-v2-object-type"] === "Execution");
  execution.props.onClick();
  const exit = findElement(inspector, (node) => node.type === "button" && node.props?.["data-kordyn-v2-position-exit"] === "close_position");
  exit.props.onClick();
  assert.deepEqual(selections.map(([candidate, trigger]) => [candidate.id, candidate.type, trigger]), [
    ["position-1", "Position", "position-trigger"], ["execution-1", "Execution", "execution"]
  ]);
  assert.equal(exits[0][0].id, "execution-1");
  assert.equal(exits[0][1], "desktop");
});

test("position exit reuses bounded settlement for disabled sync throw rejection pending and resolved outcomes", async () => {
  let calls = 0;
  assert.deepEqual(await requestPositionExit({ exitExecutionOrder: async () => { calls += 1; } }, validExecution(), true, "desktop"), { ok: false, error: "action_disabled" });
  assert.equal(calls, 0);
  for (const run of [
    () => { throw new Error("POSITION_SECRET_NEVER_RENDER"); },
    async () => { throw new Error("POSITION_REJECTION_NEVER_RENDER"); }
  ]) {
    const transitions = [];
    const result = await runAccountAction({ action: "exitExecutionOrder", run, onTransition: (next) => transitions.push(next) });
    assert.deepEqual(result, { ok: false, error: "action_failed" });
    assert.deepEqual(transitions.map((next) => next.kind), ["processing", "result"]);
    assert.doesNotMatch(JSON.stringify(transitions), /POSITION_SECRET|POSITION_REJECTION/);
  }
  let settle;
  const raw = Object.freeze({ ok: true, accepted: true, state: "close_pending" });
  const transitions = [];
  const pending = runAccountAction({ action: "exitExecutionOrder", run: () => new Promise((resolve) => { settle = resolve; }), onTransition: (next) => transitions.push(next) });
  assert.equal(transitions[0].kind, "processing");
  settle(raw);
  assert.equal(await pending, raw);
  assert.equal(transitions[1].raw, raw);
  assert.match(transitions[1].presentation.message, /最新事实/);
  assert.doesNotMatch(transitions[1].presentation.message, /已平仓|成功/);
});

test("position UI exposes no direct position mutation endpoint and only invokes exitExecutionOrder", () => {
  const inspectorSource = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account/PositionInspector.jsx"), "utf8");
  const domainSource = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account/index.jsx"), "utf8");
  assert.doesNotMatch(inspectorSource, /\/api\/positions\//);
  assert.doesNotMatch(domainSource, /\/api\/positions\//);
  assert.match(domainSource, /exitExecutionOrder/);
});

test("APP uses list and full-screen detail markup with focusable heading and Back restoration contract", () => {
  const model = modelFixture();
  const returnFocusRef = { current: null };
  const detailHeadingRef = { current: null };
  const selections = [];
  const list = MobilePositionScreen({ model, view: "list", returnFocusRef, onSelect: (candidate, event) => selections.push([candidate, event.currentTarget]) });
  const trigger = findElement(list, (node) => node.type === "button" && node.props?.["data-kordyn-v2-object-type"] === "Position");
  assert.equal(trigger.ref, returnFocusRef);
  trigger.props.onClick({ currentTarget: "mobile-position-trigger" });
  const backs = [];
  const detail = MobilePositionScreen({
    model, view: "detail", selection: { object: { id: "position-1", type: "Position" } }, detailHeadingRef,
    onOpenList: (event) => backs.push(event.currentTarget)
  });
  const heading = findElement(detail, (node) => node.type === "h2" && node.props?.tabIndex === -1);
  const back = findElement(detail, (node) => node.type === "button" && node.props?.["data-kordyn-v2-position-back"] === "true");
  assert.equal(heading.ref, detailHeadingRef);
  back.props.onClick({ currentTarget: "mobile-position-back" });
  assert.deepEqual(selections.map(([candidate, currentTarget]) => [candidate.id, currentTarget]), [["position-1", "mobile-position-trigger"]]);
  assert.deepEqual(backs, ["mobile-position-back"]);
  const listHtml = renderToStaticMarkup(list);
  const detailHtml = renderToStaticMarkup(detail);
  assert.match(listHtml, /data-kordyn-v2-position-mobile-view="list"/);
  assert.match(detailHtml, /data-kordyn-v2-position-mobile-view="detail"/);
  assert.doesNotMatch(listHtml + detailHtml, /data-kordyn-v2-position-desktop=/);
});

test("Position APP touch targets are at least 44px and the domain CSS remains Account-scoped", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account/account.css"), "utf8");
  assert.match(css, /\.kordynV2PositionMobile[\s\S]*min-height:\s*44px/);
  assert.doesNotMatch(css, /!important/);
  const sharedCss = fs.readFileSync(path.join(rootDir, "src/kordynV2/styles/shell.css"), "utf8");
  assert.doesNotMatch(sharedCss, /kordynV2Position/);
});
