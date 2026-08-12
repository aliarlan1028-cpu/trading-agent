import assert from "node:assert/strict";
import test from "node:test";
import { buildSupportDiagnostics, searchSupportArticles, supportCatalogSummary } from "../server/supportKnowledge.mjs";

test("客服知识覆盖主要产品页面并按当前页面和问题召回", () => {
  const summary = supportCatalogSummary();
  assert.ok(summary.articles >= 20);
  const articles = searchSupportArticles("条件已武装是什么意思，OKX 下单了吗", { page: "chat:dialog", language: "zh" });
  assert.equal(articles[0].id, "trading.waiting_entry");
  assert.match(articles[0].body, /尚未收到订单/);
});

test("英文客服能召回自然英文产品说明，不依赖中文关键词或模型翻译", () => {
  const articles = searchSupportArticles("What does Waiting for entry mean, and is there already an OKX order?", { page: "chat", language: "en" });
  assert.equal(articles[0].id, "trading.waiting_entry");
  assert.match(articles[0].title, /Waiting for entry/i);
  assert.match(articles[0].body, /no order has been sent to OKX/i);
  assert.match(articles[0].citation, /^Product guide/);
});

test("客服诊断严格区分等待入场、本地计划、在途订单和真实持仓", () => {
  const db = {
    system: { autonomyEnabled: true, liveTradingEnabled: true, killSwitch: false, reduceOnlyMode: false },
    portfolio: { totalEquityUsdt: 100 },
    positions: [],
    accountSnapshots: [{ status: "ok", createdAt: "2026-08-09T00:00:00Z" }],
    armedSetups: [{ status: "ARMED", planId: "p1", symbol: "SUI/USDT", direction: "short", expiresAt: "2026-08-10T00:00:00Z", trigger: { kind: "enter_zone", levelLow: 0.698, levelHigh: 0.702, confirmations: [{ timeframe: "1h", kind: "rejection_wick" }] } }],
    tradePlans: [{ id: "p1", status: "armed" }],
    executionOrders: [], riskIncidents: []
  };
  const result = buildSupportDiagnostics(db, "这条等待入场计划是不是已经挂单", { page: "chat:dialog", language: "zh" });
  assert.ok(result.facts.some((line) => /等待入场明细/.test(line)));
  assert.ok(result.facts.some((line) => /没有在途 OKX/.test(line)));
  assert.ok(result.evidence.includes("support_tool:trade_state"));
});
