import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize as normalizePath } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";

import { performanceReport } from "../server/accounting.mjs";
import { buildClosedTrades, computeBehaviorProfile } from "../server/behaviorProfile.mjs";
import { buildChatPresentation } from "../server/chatPresentation.mjs";
import { buildCoreOverview } from "../server/coreOverview.mjs";
import { buildDecisionCalibrationReport } from "../server/decisionCalibration.mjs";
import { backfillStructuredTradeReviews, refreshOwnerImprovementRegistry, transitionReviewLesson } from "../server/ownerReviewLoop.mjs";
import { buildExecutionQuality } from "../server/professionalAnalytics.mjs";
import { runTradeReflection } from "../server/reviewEngine.mjs";
import { strategyProductMetrics } from "../server/strategyProducts.mjs";
import { groupSystemClosedTradeLifecycles } from "../server/systemTradeProjection.mjs";
import { queueClosedTradeProfitPosters } from "../server/telegramNotifier.mjs";
import { consecutiveLossCooldown, drawdownLockout } from "../server/tradeProtections.mjs";
import { syncTradeReviewQueue } from "../server/tradeReviewQueue.mjs";
import { retrieveRelevantReviewMemories } from "../server/reviewLearning.mjs";
import { projectOverviewSection } from "../server/overviewView.mjs";
import { seedDatabase } from "../server/store.mjs";
import { addSystemExecution, stampFixtureSystemAttribution } from "./helpers/system-trade-fixtures.mjs";

const SYSTEM_CONSUMERS = [
  "accounting.mjs", "behaviorProfile.mjs", "coreOverview.mjs", "decisionCalibration.mjs",
  "knowledgeSkills.mjs", "missedOpportunity.mjs", "ownerReviewLoop.mjs", "professionalAnalytics.mjs", "reviewEngine.mjs",
  "reviewLearning.mjs", "strategyBoard.mjs", "strategyContracts.mjs", "strategyProducts.mjs",
  "telegramNotifier.mjs", "tradeProtections.mjs", "tradeReviewQueue.mjs"
];

function serverSource(fileName) {
  return readFileSync(new URL(`../server/${fileName}`, import.meta.url), "utf8");
}

function importDeclarations(source, fileName = "fixture.mjs") {
  const declarations = [];
  const linter = new Linter();
  const messages = linter.verify(source, [{
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: {
      boundary: {
        rules: {
          collectImports: {
            create() {
              return {
                ImportDeclaration(node) {
                  declarations.push({
                    source: String(node.source.value),
                    specifiers: node.specifiers.map((specifier) => ({
                      type: specifier.type,
                      imported: specifier.type === "ImportSpecifier"
                        ? String(specifier.imported.name ?? specifier.imported.value)
                        : specifier.type === "ImportNamespaceSpecifier" ? "*" : "default",
                      local: specifier.local.name
                    }))
                  });
                }
              };
            }
          }
        }
      }
    },
    rules: { "boundary/collectImports": "error" }
  }], { filename: fileName });
  const fatalMessages = messages.filter((message) => message.fatal);
  if (fatalMessages.length) {
    throw new Error(`Unable to parse ${fileName}: ${fatalMessages.map((message) => message.message).join("; ")}`);
  }
  return declarations;
}

const SERVER_DIRECTORY_URL = new URL("../server/", import.meta.url);
const MALFORMED_MODULE_TARGET = Symbol("malformed_module_target");

function serverFileUrl(fileName) {
  const relativeName = fileName.startsWith("server/") ? fileName.slice("server/".length) : fileName;
  return new URL(relativeName, SERVER_DIRECTORY_URL);
}

function canonicalServerTarget(dependency, fileName = "fixture.mjs") {
  if (!dependency.startsWith(".")) return dependency;
  try {
    const resolved = new URL(dependency, serverFileUrl(fileName));
    resolved.search = "";
    resolved.hash = "";
    if (resolved.protocol !== "file:") return resolved.href;
    return normalizePath(fileURLToPath(resolved));
  } catch {
    return MALFORMED_MODULE_TARGET;
  }
}

const RAW_LIFECYCLE_TARGETS = new Set([
  fileURLToPath(new URL("tradeLifecycle.mjs", SERVER_DIRECTORY_URL)),
  fileURLToPath(new URL("tradeReviewQueue.mjs", SERVER_DIRECTORY_URL))
]);

function rawLifecycleImports(source, fileName = "fixture.mjs") {
  return importDeclarations(source, fileName).flatMap((declaration) => {
    const target = canonicalServerTarget(declaration.source, fileName);
    if (target === MALFORMED_MODULE_TARGET) return [{ imported: "*", source: declaration.source }];
    if (!RAW_LIFECYCLE_TARGETS.has(target)) return [];
    return declaration.specifiers
      .filter((specifier) => specifier.imported === "groupClosedTradeLifecycles" || specifier.type === "ImportNamespaceSpecifier")
      .map((specifier) => ({ imported: specifier.imported, source: declaration.source }));
  });
}

const PROJECTION_LEAF_IMPORT_TARGETS = new Set([
  fileURLToPath(new URL("tradeLifecycle.mjs", SERVER_DIRECTORY_URL)),
  fileURLToPath(new URL("positionIdentity.mjs", SERVER_DIRECTORY_URL)),
  fileURLToPath(new URL("executionStates.mjs", SERVER_DIRECTORY_URL))
]);

function projectionLeafImportViolations(source, fileName = "systemTradeProjection.mjs") {
  return importDeclarations(source, fileName)
    .filter((declaration) => !PROJECTION_LEAF_IMPORT_TARGETS.has(canonicalServerTarget(declaration.source, fileName)))
    .map((declaration) => declaration.source);
}

test("static raw-lifecycle guard detects direct and aliased consumer imports", () => {
  assert.deepEqual(rawLifecycleImports('import { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs";'), [
    { imported: "groupClosedTradeLifecycles", source: "./tradeLifecycle.mjs" }
  ]);
  assert.deepEqual(rawLifecycleImports('import { groupClosedTradeLifecycles as groupRaw } from "./tradeReviewQueue.mjs";'), [
    { imported: "groupClosedTradeLifecycles", source: "./tradeReviewQueue.mjs" }
  ]);
});

test("static raw-lifecycle guard catches namespace and normalized-path mutations without matching inert text", () => {
  assert.equal(rawLifecycleImports('import * as lifecycle from "./tradeLifecycle.mjs";').length, 1);
  assert.equal(rawLifecycleImports('import { groupClosedTradeLifecycles as groupRaw } from "./x/../tradeReviewQueue.mjs";').length, 1);
  assert.deepEqual(rawLifecycleImports(`
    // import { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs";
    const example = \`import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";\`;
    export { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs";
  `), []);
});

test("raw-lifecycle guard follows Node ESM URL identity and fails closed on malformed encoding", () => {
  for (const source of [
    'import { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs?raw";',
    'import * as lifecycle from "./tradeReviewQueue.mjs#compat";',
    'import { groupClosedTradeLifecycles as groupRaw } from "./%74radeLifecycle.mjs";',
    'import * as undecodable from "./%E0%A4%A.mjs";'
  ]) {
    assert.equal(rawLifecycleImports(source).length, 1, source);
  }
});

test("system consumers cannot import raw lifecycle grouping", () => {
  const violations = SYSTEM_CONSUMERS.flatMap((fileName) => (
    rawLifecycleImports(serverSource(fileName)).map((dependency) => ({ fileName, dependency }))
  ));
  assert.deepEqual(violations, []);
});

test("execution reconciliation remains the explicit raw lifecycle exception", () => {
  assert.deepEqual(rawLifecycleImports(serverSource("executionEngine.mjs")), [
    { imported: "groupClosedTradeLifecycles", source: "./tradeReviewQueue.mjs" }
  ]);
});

test("system trade projection remains a leaf above lifecycle primitives", () => {
  assert.deepEqual(projectionLeafImportViolations(serverSource("systemTradeProjection.mjs")), []);
});

test("projection leaf guard permits only its exact lower-level imports", () => {
  assert.deepEqual(projectionLeafImportViolations(`
    import { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs";
    import { canonicalSymbol } from "./positionIdentity.mjs";
    import { OPEN_EXECUTION_STATES } from "./executionStates.mjs";
    import * as lifecycle from "./tradeLifecycle.mjs?raw";
    import * as identity from "./positionIdentity.mjs#compat";
    import * as states from "./%65xecutionStates.mjs";
  `), []);

  for (const dependency of [
    "./professionalAnalytics.mjs",
    "./telegramNotifier.mjs?raw",
    "./%63oreOverview.mjs",
    "./reviewEngine.mjs#compat",
    "./routes/../routes/posters.mjs?raw",
    "./x/../systemTradeProjection.mjs",
    "./%73ystemTradeProjection.mjs#self",
    "./%E0%A4%A.mjs"
  ]) {
    assert.equal(projectionLeafImportViolations(`import * as upstream from "${dependency}";`).length, 1, dependency);
  }

  assert.deepEqual(projectionLeafImportViolations(`
    // import "./professionalAnalytics.mjs";
    const example = \`import "./telegramNotifier.mjs";\`;
  `), []);
});

function reconciledLeg(fill) {
  return {
    feeUsdt: 0,
    feeSchemaVersion: 2,
    feeSource: "fixture_exchange_fill",
    estimatedFee: false,
    ...(fill.kind === "close" ? { fundingFeeUsdt: 0, fundingReconciled: true } : {}),
    ...fill
  };
}

function manualLifecycle(id, closedAt) {
  return [
    reconciledLeg({ id: `${id}-entry`, kind: "entry", positionId: id, symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: new Date(closedAt - 60_000).toISOString() }),
    reconciledLeg({ id: `${id}-close`, kind: "close", positionId: id, symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -10, createdAt: new Date(closedAt).toISOString() })
  ];
}

test("system history, chat, and Telegram posters exclude manual closed fills while retaining manual account positions", () => {
  const originalTelegram = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chat: process.env.TELEGRAM_CHAT_ID,
    enabled: process.env.TELEGRAM_PROFIT_POSTER_ENABLED,
    minimum: process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  process.env.TELEGRAM_PROFIT_POSTER_ENABLED = "true";
  process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT = "0";
  try {
    const now = Date.now();
    const db = seedDatabase();
    Object.assign(db, {
      portfolio: { totalEquityUsdt: 100 },
      executionOrders: [], tradePlans: [], fills: [], positions: [{
        id: "manual-open", source: "exchange_rest", exchange: "OKX", accountId: "manual-account",
        symbol: "ETH/USDT", direction: "long", quantity: 0.5, markPrice: 3000, marginUsdt: 100
      }],
      meta: { telegramClosedTradePosterStartedAt: new Date(now - 60_000).toISOString() },
      telegramPosterOutbox: []
    });
    const normal = addSystemExecution(db, { executionOrderId: "system-normal", planId: "plan-normal", quantity: 1 });
    const manualExit = addSystemExecution(db, { executionOrderId: "system-manual-exit", planId: "plan-manual-exit", quantity: 1 });
    const systemLeg = (id, kind, execution, realizedPnl, createdAt) => stampFixtureSystemAttribution(reconciledLeg({
      id, kind, accountId: "account-a", environment: "production", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
      quantity: 1, price: 100, realizedPnl, exchangeFilledAt: createdAt, createdAt
    }), execution);
    const manualExitClose = systemLeg("manual-exit-close", "close", manualExit, 4, new Date(now - 2_000).toISOString());
    manualExitClose.tradeAttribution = {
      ...manualExitClose.tradeAttribution,
      origin: "external_exchange", exitMode: "manual_exit", method: "deterministic_manual_exit",
      evidence: { ...manualExitClose.tradeAttribution.evidence, exchangeTradeId: "manual-exit-trade" }
    };
    db.fills.push(
      systemLeg("normal-entry", "entry", normal, undefined, new Date(now - 9_000).toISOString()),
      systemLeg("normal-close", "close", normal, 3, new Date(now - 8_000).toISOString()),
      systemLeg("manual-exit-entry", "entry", manualExit, undefined, new Date(now - 3_000).toISOString()),
      manualExitClose,
      ...manualLifecycle("manual-closed", now - 1_000).map((fill) => ({ ...fill, realizedPnl: fill.kind === "close" ? 50 : undefined, tradePlanId: normal.planId })),
      ...manualLifecycle("pending-closed", now - 500).map((fill) => ({
        ...fill,
        realizedPnl: fill.kind === "close" ? 75 : undefined,
        tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" }
      }))
    );

    const core = buildCoreOverview(db);
    assert.deepEqual(core.fills.map((fill) => fill.id).sort(), ["manual-exit-close", "manual-exit-entry", "normal-close", "normal-entry"]);
    assert.deepEqual(core.closedTradeLifecycles.map((row) => row.tradeLifecycleKey).sort(), ["system-manual-exit", "system-normal"]);
    assert.equal(core.tradeDataStatus.closedLifecycleTotal, 2);
    assert.equal(core.positions.some((row) => row.id === "manual-open"), true);
    assert.deepEqual(projectOverviewSection(core, "cockpit").closedTradeLifecycles.map((row) => row.tradeLifecycleKey).sort(), ["system-manual-exit", "system-normal"]);

    const chat = buildChatPresentation({ db, run: { tradePlanId: normal.planId }, content: "交易已平仓。" });
    assert.equal(chat.execution.grossRealizedPnl, 3);
    assert.equal(chat.execution.netRealizedPnl, 3);

    assert.equal(queueClosedTradeProfitPosters(db).queued, 2);
    assert.deepEqual(db.telegramPosterOutbox.map((item) => item.tradeLifecycleKey).sort(), ["system-manual-exit", "system-normal"]);
  } finally {
    for (const [key, value] of Object.entries(originalTelegram)) {
      const envKey = key === "token" ? "TELEGRAM_BOT_TOKEN" : key === "chat" ? "TELEGRAM_CHAT_ID" : key === "enabled" ? "TELEGRAM_PROFIT_POSTER_ENABLED" : "TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT";
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});

test("performance, review, and protections exclude manual losses while retaining one attributed manual exit", () => {
  const now = Date.now();
  const execution = {
    id: "system-exec", planId: "system-plan", exchange: "OKX", accountId: "account-a",
    environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed"
  };
  const attributed = (fill, exitMode = null) => reconciledLeg({
    ...fill,
    executionOrderId: execution.id,
    planId: execution.planId,
    tradePlanId: execution.planId,
    tradeAttribution: {
      schemaVersion: 1,
      scope: "system",
      origin: exitMode ? "external_exchange" : "execution_engine",
      exitMode,
      executionOrderId: execution.id,
      planId: execution.planId,
      method: exitMode ? "deterministic_manual_exit" : "execution_writer",
      reason: null,
      evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 },
      attributedAt: fill.createdAt
    }
  });
  const db = {
    portfolio: { totalEquityUsdt: 100 },
    executionOrders: [execution],
    tradePlans: [{ id: execution.planId, symbol: execution.symbol, direction: execution.direction }],
    reviews: [],
    fills: [
      attributed({ id: "system-entry", kind: "entry", symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: new Date(now - 4 * 3_600_000 - 60_000).toISOString() }),
      attributed({ id: "system-manual-exit", kind: "close", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -10, createdAt: new Date(now - 4 * 3_600_000).toISOString() }, "manual_exit"),
      ...manualLifecycle("manual-1", now - 3 * 3_600_000),
      ...manualLifecycle("manual-2", now - 2 * 3_600_000),
      ...manualLifecycle("manual-3", now - 3_600_000)
    ]
  };

  assert.equal(groupSystemClosedTradeLifecycles(db).length, 1, "the attributed manual exit belongs to exactly one system lifecycle");
  assert.equal(performanceReport(db).trades, 1);
  assert.equal(syncTradeReviewQueue(db).queued, 1);
  assert.equal(db.reviews.length, 1);
  assert.equal(consecutiveLossCooldown(db).streak, 1);
  assert.equal(drawdownLockout(db).active, false);
});

test("reflection persists derived fields only on the raw system manual-exit close and ignores pending attribution", async () => {
  const now = Date.now();
  const entryAt = new Date(now - 2 * 3_600_000).toISOString();
  const closeAt = new Date(now - 3_600_000).toISOString();
  const execution = {
    id: "reflection-exec", planId: "reflection-plan", exchange: "OKX", accountId: "account-a",
    environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed"
  };
  const systemAttribution = (exitMode) => ({
    schemaVersion: 1, scope: "system", origin: "external_exchange", exitMode,
    executionOrderId: execution.id, planId: execution.planId, method: "deterministic_manual_exit", reason: null,
    evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 }, attributedAt: closeAt
  });
  const pendingAttribution = {
    schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", exitMode: null,
    executionOrderId: "pending-exec", planId: "pending-plan", method: "unresolved", reason: "mixed_position_attribution",
    evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: "pending-trade", matchedEntryFillIds: [], attributedQuantity: 1 }, attributedAt: closeAt
  };
  const db = {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true },
    system: { ownerReviewProvenanceMigrationVersion: 1 },
    portfolio: { totalEquityUsdt: 100 }, reviews: [], memoryItems: [], auditLogs: [], traces: [],
    executionOrders: [execution, { id: "pending-exec", planId: "pending-plan", symbol: "BTC/USDT", direction: "long", status: "closed" }],
    tradePlans: [{ id: execution.planId, symbol: "BTC/USDT", direction: "long" }, { id: "pending-plan", symbol: "BTC/USDT", direction: "long" }],
    marketIntelligenceFacts: [{
      id: "verified-shock", type: "news", category: "news", affectedSymbols: ["BTC/USDT"], publishedAt: new Date(now - 90 * 60_000).toISOString(),
      verifiedOrigin: true, trustTier: "verified_official", fakeRisk: "low", impactHorizon: "immediate", values: { impact: 90 }
    }],
    fills: [
      reconciledLeg({ id: "reflection-entry", kind: "entry", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, tenantId: "tenant-owner", ownerUserId: "owner-1", createdAt: entryAt, tradeAttribution: systemAttribution(null) }),
      reconciledLeg({ id: "reflection-close", kind: "close", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -10, tenantId: "tenant-owner", ownerUserId: "owner-1", createdAt: closeAt, tradeAttribution: systemAttribution("manual_exit") }),
      reconciledLeg({ id: "pending-entry", kind: "entry", executionOrderId: "pending-exec", planId: "pending-plan", tradePlanId: "pending-plan", symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: entryAt, tradeAttribution: pendingAttribution }),
      reconciledLeg({ id: "pending-close", kind: "close", executionOrderId: "pending-exec", planId: "pending-plan", tradePlanId: "pending-plan", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -50, createdAt: closeAt, tradeAttribution: pendingAttribution })
    ]
  };

  const first = await runTradeReflection(db);
  const rawClose = db.fills.find((fill) => fill.id === "reflection-close");
  const pendingClose = db.fills.find((fill) => fill.id === "pending-close");

  assert.equal(first.reflected, 1);
  assert.ok(rawClose.newsContext);
  assert.ok(rawClose.lossAttribution);
  assert.ok(rawClose.reflectedAt);
  assert.equal(pendingClose.reflectedAt, undefined);
  assert.equal(performanceReport(db).trades, 1);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.memoryItems.length, 1);
  assert.equal(consecutiveLossCooldown(db).streak, 1);
  assert.equal(drawdownLockout(db).active, false);
  assert.equal(computeBehaviorProfile(db).lossAttribution[rawClose.lossAttribution], 1);

  delete db.reviews[0].structuredAssessment;
  assert.equal(backfillStructuredTradeReviews(db).updated, 1);
  assert.ok(db.reviews[0].structuredAssessment.rootCauses.some((root) => root.code === "market_shock"));
  const second = await runTradeReflection(db);
  assert.equal(second.reflected, 0);
  assert.equal(db.memoryItems.length, 1);
});

test("learning and strategy metrics admit only the evidenced system manual-exit lifecycle", () => {
  const execution = {
    id: "learning-system-exec", planId: "learning-system-plan", exchange: "OKX", accountId: "account-a",
    environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed", strategyVersionId: "trend@1"
  };
  const decisionContext = {
    setupType: "trend_pullback",
    supportingFactors: ["support"],
    conflictingFactors: [],
    deterministicSetupSnapshot: { marketRegime: { label: "uptrend" } }
  };
  const systemAttribution = (fill, exitMode = null) => ({
    schemaVersion: 1, scope: "system", origin: exitMode ? "external_exchange" : "execution_engine", exitMode,
    executionOrderId: execution.id, planId: execution.planId, method: exitMode ? "deterministic_manual_exit" : "execution_writer", reason: null,
    evidence: { accountId: execution.accountId, environment: execution.environment, exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 },
    attributedAt: fill.createdAt
  });
  const db = {
    executionOrders: [execution, { id: "learning-pending-exec", planId: "learning-pending-plan", symbol: "BTC/USDT", direction: "long", status: "closed" }],
    tradePlans: [
      { id: execution.planId, exchange: "OKX", accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", strategyVersionId: "trend@1", decisionContext },
      { id: "learning-manual-plan", symbol: "BTC/USDT", direction: "long", strategyVersionId: "trend@1", decisionContext },
      { id: "learning-pending-plan", symbol: "BTC/USDT", direction: "long", strategyVersionId: "trend@1", decisionContext }
    ],
    fills: []
  };
  const fill = (row) => reconciledLeg(row);
  db.fills.push(
    fill({ id: "learning-system-entry", kind: "entry", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, slippageBps: 2, createdAt: "2026-08-01T00:00:00Z", tradeAttribution: systemAttribution({ createdAt: "2026-08-01T00:00:00Z" }) }),
    fill({ id: "learning-system-manual-exit", kind: "close", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, slippageBps: 2, realizedPnl: -3, createdAt: "2026-08-01T01:00:00Z", tradeAttribution: systemAttribution({ createdAt: "2026-08-01T01:00:00Z" }, "manual_exit") }),
    fill({ id: "learning-manual-entry", kind: "entry", positionId: "manual-like", tradePlanId: "learning-manual-plan", strategyVersionId: "trend@1", symbol: "BTC/USDT", direction: "long", quantity: 1, slippageBps: 100, createdAt: "2026-08-01T02:00:00Z" }),
    fill({ id: "learning-manual-close", kind: "close", positionId: "manual-like", tradePlanId: "learning-manual-plan", strategyVersionId: "trend@1", symbol: "BTC/USDT", direction: "long", quantity: 1, slippageBps: 100, realizedPnl: 100, createdAt: "2026-08-01T03:00:00Z" }),
    fill({ id: "learning-pending-entry", kind: "entry", executionOrderId: "learning-pending-exec", tradePlanId: "learning-pending-plan", symbol: "BTC/USDT", direction: "long", quantity: 1, slippageBps: 200, createdAt: "2026-08-01T04:00:00Z", tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } }),
    fill({ id: "learning-pending-close", kind: "close", executionOrderId: "learning-pending-exec", tradePlanId: "learning-pending-plan", symbol: "BTC/USDT", direction: "long", quantity: 1, slippageBps: 200, realizedPnl: 50, createdAt: "2026-08-01T05:00:00Z", tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } })
  );

  const lifecycles = groupSystemClosedTradeLifecycles(db);
  assert.deepEqual(lifecycles.map((lifecycle) => lifecycle.key), [execution.id]);
  assert.equal(lifecycles[0].representative.tradeAttribution.exitMode, "manual_exit");
  assert.equal(buildClosedTrades(db).length, 1);
  assert.equal(computeBehaviorProfile(db).trades, 1);
  assert.equal(buildDecisionCalibrationReport(db, { minTrades: 1 }).tradesWithDecisionContext, 1);
  assert.equal(strategyProductMetrics(db, "trend@1").closedTrades, 1);
  assert.deepEqual(buildExecutionQuality(db), {
    fills: 2, avgSlippageBps: 2, p95SlippageBps: 2, partialFillRatePct: 0,
    calibrationBySymbol: [{ symbol: "BTC/USDT", samples: 1, ready: false, p50Bps: 2, p75Bps: 2, p95Bps: 2, minSamples: 5 }]
  });
});

test("legacy manual and pending review artifacts stay auditable but cannot activate or drive owner improvements", () => {
  const execution = { id: "review-system-exec", planId: "review-system-plan", exchange: "OKX", accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed" };
  const systemAttribution = (fill) => ({
    schemaVersion: 1, scope: "system", origin: "execution_engine", exitMode: fill.kind === "close" ? "system_exit" : null,
    executionOrderId: execution.id, planId: execution.planId, method: "execution_writer", reason: null,
    evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 }, attributedAt: fill.createdAt
  });
  const review = (id, key, memoryItemId, fillIds = []) => ({
    id, type: "trade", status: "completed", tradeLifecycleKey: key, memoryItemId, tenantId: "tenant-owner", ownerUserId: "owner-1",
    fillIds,
    improvementScope: { strategyProductId: "trend", timeframe: "1h", regime: "uptrend" },
    structuredAssessment: { outcome: "loss", matrix: { key: "mixed_loss" }, financial: { complete: true, netRealizedPnl: -1 }, rootCauses: [{ code: "entry_timing", label: "entry", destination: "strategy", severity: "medium" }] }
  });
  const db = {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true }, system: { ownerReviewProvenanceMigrationVersion: 1 }, ownerImprovementItems: [], auditLogs: [],
    executionOrders: [execution], tradePlans: [{ id: execution.planId, exchange: "OKX", accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long" }],
    fills: [
      reconciledLeg({ id: "review-system-entry", kind: "entry", executionOrderId: execution.id, tradePlanId: execution.planId, planId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, tenantId: "tenant-owner", ownerUserId: "owner-1", createdAt: "2026-08-01T00:00:00Z", tradeAttribution: systemAttribution({ kind: "entry", createdAt: "2026-08-01T00:00:00Z" }) }),
      reconciledLeg({ id: "review-system-close", kind: "close", executionOrderId: execution.id, tradePlanId: execution.planId, planId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -1, tenantId: "tenant-owner", ownerUserId: "owner-1", createdAt: "2026-08-01T01:00:00Z", tradeAttribution: systemAttribution({ kind: "close", createdAt: "2026-08-01T01:00:00Z" }) }),
      reconciledLeg({ id: "review-manual-close", kind: "close", positionId: "manual", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -1, createdAt: "2026-08-01T02:00:00Z" }),
      reconciledLeg({ id: "review-pending-close", kind: "close", executionOrderId: "pending-exec", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -1, createdAt: "2026-08-01T03:00:00Z", tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } })
    ],
    reviews: [review("review-system", execution.id, "memory-system", ["review-system-close"]), review("review-manual", "manual", "memory-manual", ["review-manual-close"]), review("review-pending", "pending-exec", "memory-pending", ["review-pending-close"])],
    memoryItems: [
      { id: "memory-system", source: "auto_reflection", learningStatus: "active", fillId: "review-system-close", reviewId: "review-system", title: "system", content: "system", tenantId: "tenant-owner", ownerUserId: "owner-1" },
      { id: "memory-manual", source: "auto_reflection", learningStatus: "candidate", fillId: "review-manual-close", reviewId: "review-manual", title: "manual", content: "manual", tenantId: "tenant-owner", ownerUserId: "owner-1" },
      { id: "memory-pending", source: "auto_reflection", learningStatus: "active", fillId: "review-pending-close", reviewId: "review-pending", title: "pending", content: "pending", tenantId: "tenant-owner", ownerUserId: "owner-1" }
    ]
  };
  assert.equal(transitionReviewLesson(db, "memory-manual", "approve", "Owner").ok, false);
  assert.deepEqual(retrieveRelevantReviewMemories(db, { principal: { tenantId: "tenant-owner", userId: "owner-1", isOwner: true }, symbols: ["BTC/USDT"] }).map((row) => row.id), ["memory-system"]);
  refreshOwnerImprovementRegistry(db);
  assert.equal(db.ownerImprovementItems[0].evidenceCount, 1);
  assert.equal(db.reviews.length, 3, "raw legacy artifacts remain auditable");
});

test("copied foreign lifecycle metadata cannot activate, retrieve, or improve a manual review", () => {
  const execution = { id: "foreign-exec", planId: "foreign-plan", exchange: "OKX", accountId: "account-other", environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed", tenantId: "tenant-other", ownerUserId: "owner-other" };
  const attribution = (kind) => ({
    schemaVersion: 1, scope: "system", origin: "execution_engine", exitMode: kind === "close" ? "system_exit" : null,
    executionOrderId: execution.id, planId: execution.planId, method: "execution_writer", reason: null,
    evidence: { accountId: execution.accountId, environment: execution.environment, exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 }
  });
  const manualReview = {
    id: "copied-review", type: "trade", status: "completed", memoryItemId: "copied-memory", tenantId: "tenant-owner", ownerUserId: "owner-1",
    symbol: "ETH/USDT", tradeLifecycleKey: execution.id, executionOrderId: execution.id, tradePlanId: execution.planId, fillIds: ["foreign-close"],
    improvementScope: { strategyProductId: "trend", timeframe: "1h", regime: "uptrend" },
    structuredAssessment: { outcome: "loss", matrix: { key: "mixed_loss" }, financial: { complete: true, netRealizedPnl: -1 }, rootCauses: [{ code: "entry_timing", label: "entry", destination: "strategy", severity: "medium" }] }
  };
  const db = {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true }, system: { ownerReviewProvenanceMigrationVersion: 1 }, ownerImprovementItems: [], auditLogs: [],
    executionOrders: [execution], tradePlans: [{ id: execution.planId, tenantId: "tenant-other", ownerUserId: "owner-other", exchange: "OKX", accountId: execution.accountId, environment: "production", symbol: "BTC/USDT", direction: "long" }],
    fills: [
      reconciledLeg({ id: "foreign-entry", kind: "entry", executionOrderId: execution.id, tradePlanId: execution.planId, planId: execution.planId, tenantId: "tenant-other", ownerUserId: "owner-other", accountId: execution.accountId, environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: "2026-08-01T00:00:00Z", tradeAttribution: attribution("entry") }),
      reconciledLeg({ id: "foreign-close", kind: "close", executionOrderId: execution.id, tradePlanId: execution.planId, planId: execution.planId, tenantId: "tenant-other", ownerUserId: "owner-other", accountId: execution.accountId, environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -1, createdAt: "2026-08-01T01:00:00Z", tradeAttribution: attribution("close") })
    ],
    reviews: [manualReview],
    memoryItems: [{ id: "copied-memory", source: "auto_reflection", learningStatus: "candidate", reviewId: manualReview.id, fillId: "foreign-close", tenantId: "tenant-owner", ownerUserId: "owner-1", symbol: "ETH/USDT", title: "copied", content: "copied" }]
  };
  assert.equal(transitionReviewLesson(db, "copied-memory", "approve", "Owner").ok, false);
  db.memoryItems[0].learningStatus = "active";
  assert.deepEqual(retrieveRelevantReviewMemories(db, { principal: { tenantId: "tenant-owner", userId: "owner-1", isOwner: true }, symbols: ["ETH/USDT"] }), []);
  refreshOwnerImprovementRegistry(db);
  assert.equal(db.ownerImprovementItems.length, 0);
  assert.equal(db.reviews.length, 1, "the raw manual review stays available for audit");
});

test("a copied memory cannot borrow another review's close evidence or hide a context conflict", () => {
  const execution = { id: "bound-exec", planId: "bound-plan", exchange: "OKX", accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed" };
  const attribution = (kind) => ({
    schemaVersion: 1, scope: "system", origin: "execution_engine", exitMode: kind === "close" ? "system_exit" : null,
    executionOrderId: execution.id, planId: execution.planId, method: "execution_writer", reason: null,
    evidence: { accountId: execution.accountId, environment: execution.environment, exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 }
  });
  const review = {
    id: "bound-review", type: "trade", status: "completed", memoryItemId: "bound-memory-a", tenantId: "tenant-owner", ownerUserId: "owner-1",
    tradeLifecycleKey: execution.id, executionOrderId: execution.id, tradePlanId: execution.planId, fillIds: ["bound-close"], symbol: "BTC/USDT"
  };
  const db = {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true }, system: { ownerReviewProvenanceMigrationVersion: 1 }, auditLogs: [],
    executionOrders: [execution], tradePlans: [{ id: execution.planId, exchange: "OKX", accountId: execution.accountId, environment: "production", symbol: "BTC/USDT", direction: "long", tenantId: "tenant-owner", ownerUserId: "owner-1" }],
    fills: [
      reconciledLeg({ id: "bound-entry", kind: "entry", executionOrderId: execution.id, tradePlanId: execution.planId, planId: execution.planId, accountId: execution.accountId, environment: "production", tenantId: "tenant-owner", ownerUserId: "owner-1", symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: "2026-08-01T00:00:00Z", tradeAttribution: attribution("entry") }),
      reconciledLeg({ id: "bound-close", kind: "close", executionOrderId: execution.id, tradePlanId: execution.planId, planId: execution.planId, accountId: execution.accountId, environment: "production", tenantId: "tenant-owner", ownerUserId: "owner-1", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -1, createdAt: "2026-08-01T01:00:00Z", tradeAttribution: attribution("close") })
    ],
    reviews: [review],
    memoryItems: [
      { id: "bound-memory-a", source: "auto_reflection", learningStatus: "candidate", fillId: "bound-close", tradePlanId: execution.planId, tenantId: "tenant-owner", ownerUserId: "owner-1", title: "bound", content: "bound" },
      { id: "bound-memory-b", source: "auto_reflection", learningStatus: "candidate", fillId: "bound-close", reviewId: review.id, tradePlanId: execution.planId, tenantId: "tenant-owner", ownerUserId: "owner-1", title: "copied", content: "copied" }
    ]
  };
  const principal = { tenantId: "tenant-owner", userId: "owner-1", isOwner: true };
  assert.equal(transitionReviewLesson(db, "bound-memory-a", "approve", "Owner").ok, true, "the established one-sided legacy link remains valid");
  assert.equal(transitionReviewLesson(db, "bound-memory-b", "approve", "Owner").ok, false);
  db.memoryItems[1].learningStatus = "active";
  assert.deepEqual(retrieveRelevantReviewMemories(db, { principal, symbols: ["BTC/USDT"] }).map((row) => row.id), ["bound-memory-a"]);
  db.memoryItems[0].reviewContext = { reviewId: review.id, tradePlanId: "forged-plan" };
  assert.deepEqual(retrieveRelevantReviewMemories(db, { principal, symbols: ["BTC/USDT"] }), [], "top-level and reviewContext claims must agree");
});
