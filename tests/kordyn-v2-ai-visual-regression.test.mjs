import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-visual-regression");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AiApprovalSheet } from "./src/kordynV2/domains/ai/AiApprovalSheet.jsx";
      export { AiMissionWorkspace } from "./src/kordynV2/domains/ai/AiMissionWorkspace.jsx";
      export { AiSignalsWorkspace } from "./src/kordynV2/domains/ai/AiSignalsWorkspace.jsx";
      export { MobileAiMissionScreen } from "./src/kordynV2/domains/ai/MobileAiMissionScreen.jsx";
      export { buildAiDomainModel } from "./src/kordynV2/domains/ai/aiModel.js";
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
  AiApprovalSheet,
  AiMissionWorkspace,
  AiSignalsWorkspace,
  MobileAiMissionScreen,
  buildAiDomainModel
} = require(outFile);

const data = Object.freeze({
  agentRuns: Object.freeze([
    Object.freeze({ id: "run-active", goal: "ETH 突破回踩机会", status: "observing", evidenceCount: 3, presentation: Object.freeze({ nextAction: "继续监控入场条件" }) }),
    Object.freeze({ id: "run-approval", goal: "SOL 白名单外机会", status: "awaiting_approval", tradePlanId: "plan-sol", evidenceCount: 4, presentation: Object.freeze({ nextAction: "等待一次性人工授权" }) }),
    Object.freeze({ id: "run-complete", goal: "BTC 趋势跟踪", status: "completed", evidenceCount: 2, presentation: Object.freeze({ nextAction: "查看复盘" }) })
  ]),
  tradePlans: Object.freeze([Object.freeze({
    id: "plan-sol",
    agentRunId: "run-approval",
    status: "awaiting_approval",
    symbol: "SOL/USDT",
    direction: "long",
    entry: Object.freeze({ range: "142.20–143.10", riskPercent: 0.3 }),
    stopLoss: 138.8,
    takeProfit: Object.freeze([149.5, 154]),
    leverage: 2,
    max_loss_pct: 0.3,
    strategy: "Breakout Retest v3",
    knowledgeSkillIds: Object.freeze(["knowledge-volatility"]),
    evidenceIds: Object.freeze(["market-sol", "account-snapshot"]),
    lastRiskCheck: Object.freeze({ id: "risk-sol", passed: true, summary: "12/12 通过", warnings: Object.freeze(["SOL 不会加入常驻白名单"]) }),
    accountImpact: Object.freeze({ equityUsdt: 28640.72, availableMarginUsdt: 13870.1, openPositionCount: 3, projectedOpenPositionCount: 4, estimatedMaxLossUsdt: 8.6 })
  })]),
  newsFeed: Object.freeze([
    Object.freeze({ id: "signal-news", kind: "news", title: "ETF 资金流更新", sourceName: "Market Intelligence", observedAt: "2026-08-30T08:05:00Z" }),
    Object.freeze({ id: "signal-knowledge", kind: "knowledge", title: "波动环境指南", sourceName: "Knowledge Registry", observedAt: "2026-08-30T07:50:00Z" })
  ]),
  marketCalendarEvents: Object.freeze([Object.freeze({ id: "event-fomc", kind: "event", title: "FOMC 利率决议", sourceName: "Federal Reserve", startAt: "2026-09-17" })]),
  watchTriggers: Object.freeze([Object.freeze({ id: "watch-eth", title: "ETH 回踩", status: "active" })])
});

const model = buildAiDomainModel(data);
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const positions = (html, markers) => markers.map((marker) => html.indexOf(marker));

test("APP Mission follows active mission to attention, account impact, recent-completed, then prompt", () => {
  const html = render(MobileAiMissionScreen, {
    model,
    truth: { risk: "normal", exposure: 8148.4 },
    selection: null,
    onSelect: () => {},
    onOpenProof: () => {},
    onOpenApproval: () => {}
  });
  const markers = [
    "data-kordyn-v2-mobile-mission-hero",
    "data-kordyn-v2-mobile-mission-attention",
    "data-kordyn-v2-mobile-account-impact",
    "data-kordyn-v2-mobile-recent-completed",
    "data-kordyn-v2-dialog-trigger"
  ];
  const order = positions(html, markers);
  assert.ok(order.every((offset) => offset >= 0), `missing APP Mission region: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /账户影响/);
  assert.match(html, /最近完成/);
});

test("APP approval is a task workspace with truthful evidence and guarded sticky decisions", () => {
  const mission = model.missions.find((candidate) => candidate.id === "run-approval");
  const approval = mission.approval;
  const html = render(AiApprovalSheet, { mission, plan: approval, actions: {}, onClose: () => {} });
  const markers = [
    "data-kordyn-v2-approval-lifecycle",
    "data-kordyn-v2-approval-plan",
    "data-kordyn-v2-approval-account-impact",
    "data-kordyn-v2-approval-risk-checklist",
    "data-kordyn-v2-approval-usage",
    "data-kordyn-v2-approval-acknowledgement",
    "data-kordyn-v2-approval-actions"
  ];
  const order = positions(html, markers);
  assert.ok(order.every((offset) => offset >= 0), `missing approval reading-order region: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /AI 这次使用了什么/);
  assert.match(html, /Breakout Retest v3/);
  assert.match(html, /knowledge-volatility/);
  assert.match(html, /<dt>复盘<\/dt><dd>Unavailable<\/dd>/);
  assert.match(html, /<dt>能力<\/dt><dd>Unavailable<\/dd>/);
  assert.match(html, /确认后仍会再次刷新行情、账户和风控/);
  assert.match(html, /data-kordyn-v2-approval-status="awaiting_approval"/);
  assert.match(html, /data-kordyn-v2-approval-mission-progress="run-approval"/);
  assert.equal((html.match(/data-kordyn-v2-approval-mission-progress="run-approval"[\s\S]*?<\/ol>/)?.[0].match(/<li\b/g) || []).length, 5);
  assert.match(html, /data-stage-id="approval"[^>]*aria-current="step"/);
});

test("Desktop Signals exposes only real local filters and read-only source/time/selectability summary", () => {
  const html = render(AiSignalsWorkspace, { model, actions: {}, selection: null, onSelect: () => {}, onOpenProof: () => {} });
  assert.match(html, /data-kordyn-v2-signal-summary/);
  assert.match(html, /已加载事实/);
  assert.match(html, /权威来源/);
  assert.match(html, /可形成对象/);
  assert.match(html, /最新事实/);
  for (const filter of ["all", "news", "market", "event", "knowledge"]) {
    assert.match(html, new RegExp(`data-kordyn-v2-signal-filter="${filter}"`));
  }
  assert.match(html, /data-kordyn-v2-relationship-lens="signal-decision-flow"/);
  assert.match(html, /data-kordyn-v2-signal-operational-context/);
});

test("Desktop Mission keeps the command bar as the final aligned workspace region", () => {
  const html = render(AiMissionWorkspace, { model, selection: null, onSelect: () => {}, onOpenProof: () => {} });
  const workbench = html.indexOf("kordynV2AiMissionWorkbench");
  const command = html.indexOf("data-kordyn-v2-mission-command-bar");
  assert.ok(workbench >= 0 && command > workbench);
});
