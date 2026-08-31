import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmHost } from "../src/confirm.jsx";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const query = new URLSearchParams(location.search);
const scenario = query.get("scenario") || "ready";
const resultMode = ["success", "partial", "failure"].includes(query.get("result")) ? query.get("result") : "success";
const asOf = "2026-08-31T09:18:00.000Z";

function buildFixture() {
  const base = JSON.parse(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
  const loaded = ["ready", "long-content", "large-list"].includes(scenario);
  const data = {
    ...base,
    revision: 604,
    source: "Plan 04 intelligent assets production-shaped fixture",
    asOf,
    lastValidSource: "Plan 04 intelligent assets production-shaped fixture",
    lastValidAt: asOf,
    user: { ...base.user, isOwner: scenario !== "forbidden" },
    resourceState: { ...base.resourceState, researchCenter: loaded ? "loaded" : scenario },
    fills: [{ id: "fill-review-btc", symbol: "BTC/USDT", kind: "close", realizedPnl: 186.4, feeUsdt: 2.14, createdAt: asOf }],
    strategyCatalog: {
      products: [{
        id: "breakout-retest", version: "3.4", versionId: "breakout@3.4", immutable: true,
        definition: { name: "Breakout Retest v3.4", family: "breakout_retest", direction: "both", timeframes: ["15m", "1h"], summary: "确认突破、回踩与盘口深度。", stages: ["sense", "guard", "monitor"], regimes: ["trend"], roles: ["day_trader"], invalidation: ["low_depth"], exits: ["risk_stop"] },
        deployment: { state: "validated_active", evidenceStatus: "verified", reason: "Owner approved" },
        metrics: { profitFactor: 1.82, winRatePct: 58.3, closedTrades: 42, lastClosedAt: asOf },
        evidence: { backtestId: "backtest-breakout-35" }
      }],
      strategies: [{ id: "mean-reversion", name: "Mean Reversion Core", contract: { direction: "both", timeframes: ["5m"], entryModel: "range reversion", family: "mean_reversion", dataRequirements: [{ source: "market", dataset: "candles" }] }, lifecycle: { stage: "active", executionEligibility: true, reason: "system native", live: { profitFactor: 1.31, winRatePct: 54.2, trades: 29 }, profile: { chosenAt: asOf, oos: { status: "passed" } } } }]
    },
    strategyStudio: {
      drafts: [{ id: "draft-breakout-35", title: "Breakout Retest v3.5 candidate", status: "testing", version: "v3.5", prompt: "提高低深度二次确认阈值", generatedTests: { status: "passed", total: 42, passed: 42 } }],
      backtests: [{ id: "backtest-breakout-35", draftId: "draft-breakout-35", strategyName: "Breakout Retest v3.5", symbol: "BTC/USDT", split: "oos", status: "passed", metrics: { profitFactor: 1.74 } }]
    },
    backtests: [{ id: "backtest-breakout-35", draftId: "draft-breakout-35", strategyName: "Breakout Retest v3.5", symbol: "BTC/USDT", split: "oos", status: "passed" }],
    knowledge: {
      sources: [
        { id: "source-market-microstructure", title: "Market Microstructure Playbook", type: "pdf", status: "parsed", parserVersion: "2.4", updatedAt: asOf },
        { id: "source-event-risk", title: "Event Risk Playbook", type: "web", status: scenario === "failed" ? "parse_failed" : "parsed", parserVersion: "2.4", updatedAt: asOf }
      ],
      chunks: [
        { id: "evidence-depth-84", sourceId: "source-market-microstructure", page: 84, type: "source_excerpt", text: scenario === "long-content" ? "盘口深度变化必须进入执行前确定性检查。".repeat(360) : "盘口深度变化必须进入执行前确定性检查。" },
        { id: "evidence-depth-131", sourceId: "source-market-microstructure", page: 131, type: "source_excerpt", text: "滑点阈值应在执行前验证。" }
      ],
      candidates: [
        { id: "candidate-strategy-35", sourceId: "source-market-microstructure", type: "strategy", status: "candidate", title: "Breakout Retest v3.5 candidate", version: "v3.5" },
        { id: "candidate-lens-depth", sourceId: "source-market-microstructure", type: "lens", status: "adopted", title: "Market Depth Lens" },
        { id: "candidate-workflow-preflight", sourceId: "source-market-microstructure", type: "workflow", status: "candidate", title: "Slippage Preflight Workflow" },
        { id: "candidate-imported-summary", sourceId: "source-market-microstructure", type: "imported_skill", status: "candidate", title: "Research Summary Skill" }
      ],
      tradingMethods: [{ id: "method-depth", sourceId: "source-market-microstructure", name: "Depth-aware retest", status: "candidate" }],
      ruleProposals: [{ id: "rule-slippage", sourceId: "source-market-microstructure", title: "Slippage preflight", status: "candidate" }],
      workflows: [{ id: "workflow-evidence", sourceId: "source-market-microstructure", title: "Evidence Retrieval Workflow", status: "approved", runtimeApproved: true, publishedEligible: true }],
      tradingSkills: [{ id: "knowledge-breakout", methodId: "method-depth", sourceId: "source-market-microstructure", name: "Knowledge Breakout", status: "live_probation", version: "0.8", approval: { approved: true, fingerprint: "fp-08" } }]
    },
    analysisEngine: { tools: [{ id: "native-risk-preflight", name: "风险预检", native: true, status: "ready", version: "3.2", permission: "account.read", runs: 416 }] },
    skills: [{ id: "imported-summary", name: "研究摘要 Skill", kind: "analysis", status: "trusted", version: "0.6", source: "uploaded", approvedBy: "Owner" }],
    tools: [{ id: "tool_okx", name: "OKX Connector", kind: "exchange", type: "exchange", status: "configured", connector: true, version: "2.1" }],
    mcpServers: [{ id: "event-mcp", serverName: "Event MCP", transport: "stdio", status: "registered", version: "1.1", grant: scenario === "disabled" ? null : { status: "granted", scope: "events.read", expiresAt: "2026-09-30T00:00:00Z" }, tools: ["events.read"] }],
    toolCallStats: {
      "风险预检": { calls: 416, success: 410, blocked: 4, error: 2, latencySamples: 416, totalLatencyMs: 39000, lastStatus: scenario === "stale" ? "error" : "success" },
      "events.read": { calls: 24, success: 24, blocked: 0, error: 0, latencySamples: 24, totalLatencyMs: 1200, lastStatus: "success" }
    },
    reviews: [{
      id: "review-btc-assets", type: "trade", status: "completed", symbol: "BTC/USDT", direction: "long", strategyVersionId: "breakout@3.4", strategyName: "Breakout Retest v3.4", completedAt: asOf,
      netRealizedPnl: 186.4, avgSlippagePct: 0.07, holdingMinutes: 138, summary: "突破确认有效，但盘口深度变化提高了滑点。",
      evidence: [{ id: "fill-review-btc", type: "fill", label: "成交与费用对账", status: "verified" }],
      rootCauses: [{ code: "execution_slippage", label: "低深度时二次确认阈值不足", confidence: 0.72 }]
    }],
    ownerReviewLoop: {
      summary: { structuredReviews: 12, candidateLessons: 1, pendingOwner: 1, validating: 1 },
      lessons: [{ id: "lesson-depth", reviewId: "review-btc-assets", status: "candidate", title: "低深度执行模式", lessonText: "只在匹配上下文中复用。" }],
      improvements: [
        { id: "owner-candidate-35", reviewId: "review-btc-assets", state: "pending_owner", destination: "strategy", title: "Breakout Retest v3.5 candidate", problem: "低深度时滑点偏高", proposal: "增加二次确认阈值", evidenceCount: 6, version: "v3.5", validation: { ready: false, stages: [{ name: "tests", status: "pending" }, { name: "oos", status: "pending" }] } },
        { id: "owner-capability-18", reviewId: "review-btc-assets", state: "validating", destination: "capability", title: "Slippage Preflight threshold", problem: "执行前检查不足", proposal: "提高阈值", evidenceCount: 3, version: "v1.8", validation: { ready: true, readyForOwnerVerification: true, stages: [{ name: "tests", status: "passed" }, { name: "paper", status: "passed" }] }, validationEvidence: [{ type: "regression_test", value: "42/42 passed" }] }
      ]
    },
    paperReport: { sessions: [{ id: "paper-owner-18", improvementId: "owner-capability-18", status: "passed", symbol: "BTC/USDT", label: "BTC pure-forward" }] }
  };
  if (scenario === "empty" || scenario === "no-result") {
    data.strategyCatalog = { products: [], strategies: [] };
    data.strategyStudio = { drafts: [], backtests: [] };
    data.backtests = [];
    data.knowledge = { sources: [], chunks: [], candidates: [], tradingMethods: [], ruleProposals: [], workflows: [], tradingSkills: [] };
    data.analysisEngine = { tools: [] };
    data.skills = [];
    data.tools = [];
    data.mcpServers = [];
    data.reviews = [];
    data.ownerReviewLoop = { summary: {}, lessons: [], improvements: [] };
    data.paperReport = { sessions: [] };
  }
  if (scenario === "large-list") {
    data.knowledge.sources = Array.from({ length: 72 }, (_, index) => ({ id: `source-large-${index + 1}`, title: `Research Source ${index + 1}`, type: "pdf", status: "parsed", updatedAt: asOf }));
  }
  return parseJsonResponseText(JSON.stringify(data));
}

const data = buildFixture();
const calls = { actionRequests: [], actionResults: [], authorityWrites: 0 };
window.__plan04AssetCalls = calls;
window.__plan04AssetScenario = scenario;

function resultFor(endpoint) {
  if (resultMode === "failure") return { ok: false, error: endpoint.includes("knowledge") ? "source_conversion_failed" : "owner_transition_rejected" };
  if (resultMode === "partial") return { ok: false, status: "partial", completed: ["candidate_saved"], failed: ["validation_deferred"] };
  return { ok: true, status: "accepted", id: endpoint.includes("knowledge") ? "candidate-server" : "owner-server-transition" };
}

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async (endpoint, payload = {}, method = "POST") => {
      calls.actionRequests.push({ endpoint, payload, method, resultMode });
      if (method !== "GET") calls.authorityWrites += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      const result = resultFor(endpoint);
      calls.actionResults.push({ endpoint, result });
      return result;
    },
    ensureSection: async () => data,
    notify: () => {},
    connectionError: scenario === "failed" ? "Plan 04 intelligent assets source failed" : ""
  }), []);
  return <><KordynV2Root api={api} lang="zh" /><ConfirmHost /></>;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.__plan04AssetsReady = true;
