import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-desktop-material");
const bundle = path.join(cacheDir, `components-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(bundle, { force: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AiMissionWorkspace } from "./src/kordynV2/domains/ai/AiMissionWorkspace.jsx";
      export { AiSignalsWorkspace, filterIntelligenceRows } from "./src/kordynV2/domains/ai/AiSignalsWorkspace.jsx";
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
  outfile: bundle,
  logLevel: "silent"
});

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AiMissionWorkspace, AiSignalsWorkspace, buildAiDomainModel, filterIntelligenceRows } = require(bundle);

const model = buildAiDomainModel({
  agentRuns: [
    {
      id: "run-approval",
      goal: "SOL 一次性授权",
      status: "awaiting_approval",
      tradePlanId: "plan-approval",
      evidenceCount: 3,
      presentation: { nextAction: "等待人工确认" },
      createdAt: "2026-08-30T07:00:00Z",
      steps: [{ phase: "awaiting_approval", summary: "已核对账户与风险" }]
    },
    {
      id: "run-monitor",
      goal: "ETH 突破回踩机会",
      status: "observing",
      evidenceCount: 5,
      presentation: { nextAction: "继续监控入场条件" },
      strategyName: "Breakout Retest v3",
      knowledgeSource: "波动环境指南",
      capabilities: ["行情", "市场结构", "风控", "执行"],
      eventWindow: "FOMC · 6h",
      positionId: "position-eth",
      createdAt: "2026-08-30T06:42:00Z",
      updatedAt: "2026-08-30T07:12:00Z",
      steps: [{ phase: "watch", summary: "正在监控入场条件，尚未下单" }]
    },
    {
      id: "run-execute",
      goal: "BTC 趋势跟踪执行",
      status: "approved",
      evidenceCount: 4,
      presentation: { nextAction: "等待权威执行结果" },
      steps: [{ phase: "approved", summary: "计划已获授权" }]
    },
    {
      id: "run-review",
      goal: "BTC 实盘复盘",
      status: "completed",
      evidenceCount: 2,
      presentation: { nextAction: "查看复盘证据" },
      steps: [{ phase: "decision", summary: "结果已进入复盘" }]
    }
  ],
  tradePlans: [{
    id: "plan-approval",
    agentRunId: "run-approval",
    status: "awaiting_approval",
    symbol: "SOL/USDT",
    direction: "long",
    entry: { range: "142.20–143.10", riskPercent: 0.3 },
    stopLoss: 138.8,
    takeProfit: [149.5],
    leverage: 2,
    max_loss_pct: 0.3,
    strategy: "Breakout Retest v3",
    evidenceIds: ["market-sol"],
    lastRiskCheck: { id: "risk-sol", passed: true, summary: "12/12 通过" },
    accountImpact: { equityUsdt: 28640.72, availableMarginUsdt: 13870.1, openPositionCount: 3, projectedOpenPositionCount: 4, estimatedMaxLossUsdt: 85.92 }
  }],
  newsFeed: [
    { id: "signal-recent", title: "CPI 前资金流重定价", summary: "只进入 AI 分析上下文。", sourceName: "Market Intelligence", observedAt: "2026-08-30T07:00:00Z", symbols: ["BTC/USDT"] },
    { id: "signal-old", title: "七日前结构事实", sourceName: "Market Intelligence", observedAt: "2026-08-20T07:00:00Z", symbols: ["ETH/USDT"] },
    { id: "signal-no-time", title: "时间不可用事实", sourceName: "Official feed" },
    { title: "只读事实", sourceName: "Unidentified source", observedAt: "2026-08-30T06:59:00Z" }
  ],
  watchTriggers: [
    { id: "watch-eth", title: "ETH 回踩观察哨", symbol: "ETH/USDT", status: "active", updatedAt: "2026-08-30T07:01:00Z" },
    { title: "只读观察哨", symbol: "ARB/USDT", status: "active" }
  ],
  marketCalendarEvents: [
    { id: "event-fomc", title: "FOMC 利率决议", startAt: "2026-09-17", sourceName: "Federal Reserve", symbols: ["BTC/USDT", "ETH/USDT"], importance: "high" },
    { title: "只读事件", sourceName: "Unknown calendar", startAt: "2026-09-21" }
  ]
});

const render = (Component, extra = {}) => renderToStaticMarkup(React.createElement(Component, {
  model,
  actions: Object.freeze({}),
  selection: null,
  onSelect: () => {},
  onOpenDialog: () => {},
  onOpenProof: () => {},
  ...extra
}));

test("Desktop Mission prefers active monitoring or execution and exposes the five truthful queue groups", () => {
  const html = render(AiMissionWorkspace);
  assert.match(html, /data-kordyn-v2-selected-mission="run-monitor"/);
  for (const group of ["analysis", "monitoring", "approval", "executing", "completed"]) {
    assert.match(html, new RegExp(`data-mission-group="${group}"`));
  }
  assert.match(html, /data-mission-group="analysis"[^>]*data-mission-count="0"/);
});

test("Desktop Mission keeps lifecycle, real decision context, related Context Proof, and runtime receipt in the dominant inspector", () => {
  const html = render(AiMissionWorkspace);
  assert.match(html, /data-kordyn-v2-mission-stage="monitor"/);
  assert.match(html, /data-kordyn-v2-mission-lifecycle="run-monitor"/);
  assert.match(html, /data-kordyn-v2-mission-decision-summary="run-monitor"/);
  assert.match(html, /Breakout Retest v3/);
  assert.match(html, /波动环境指南/);
  assert.match(html, /行情 · 市场结构 · 风控/);
  assert.match(html, /FOMC · 6h/);
  assert.match(html, /position-eth/);
  assert.match(html, /data-kordyn-v2-mission-related-context="run-monitor"/);
  assert.match(html, /data-kordyn-v2-mission-receipt="run-monitor"/);
  const heroStart = html.indexOf('data-kordyn-v2-mission-stage="monitor"');
  const heroEnd = html.indexOf('</header>', heroStart);
  assert.match(html.slice(heroStart, heroEnd), /继续监控入场条件/);
  const contextStart = html.indexOf('class="kordynV2AiAttentionPanel is-context"');
  const contextEnd = html.indexOf('</section>', contextStart);
  assert.match(html.slice(contextStart, contextEnd), /Evidence<\/dt><dd[^>]*>5<\/dd>/);
  const contextMarkup = html.slice(contextStart, contextEnd);
  assert.match(contextMarkup, /data-kordyn-v2-mission-context-fact="Capability"[^>]*><dt>Capability<\/dt><dd[^>]*title="行情 · 市场结构 · 风控 · 执行"[^>]*aria-label="Capability 行情 · 市场结构 · 风控 · 执行"/);
  const receiptStart = html.indexOf('data-kordyn-v2-mission-receipt="run-monitor"');
  const receiptEnd = html.indexOf('</section>', receiptStart);
  const receiptMarkup = html.slice(receiptStart, receiptEnd);
  assert.match(receiptMarkup, /data-kordyn-v2-mission-receipt-fact="createdAt"[^>]*><dt>创建<\/dt><dd[^>]*title="2026-08-30T06:42:00Z"[^>]*aria-label="创建 2026-08-30T06:42:00Z"[^>]*>08-30 06:42:00<\/dd>/);
  assert.match(receiptMarkup, /data-kordyn-v2-mission-receipt-fact="updatedAt"[^>]*><dt>更新<\/dt><dd[^>]*title="2026-08-30T07:12:00Z"[^>]*aria-label="更新 2026-08-30T07:12:00Z"[^>]*>08-30 07:12:00<\/dd>/);
  const decisionStart = html.indexOf('data-kordyn-v2-mission-decision-summary="run-monitor"');
  const decisionEnd = html.indexOf("</section>", decisionStart);
  const decision = html.slice(decisionStart, decisionEnd);
  for (const label of ["Strategy", "Knowledge", "Capability", "Event", "Position"]) assert.match(decision, new RegExp(label));
  assert.doesNotMatch(decision, /当前摘要|证据 \/ 下一步/);
  assert.doesNotMatch(html, /data-kordyn-v2-mission-evidence-receipt="run-monitor"/);
  assert.match(html, /data-kordyn-v2-mission-context="run-monitor"/);
  assert.match(html, /data-kordyn-v2-mission-proof="run-monitor"/);
  const footerStart = html.indexOf('class="kordynV2AiMissionInspectorFooter"');
  const footerEnd = html.indexOf('</footer>', footerStart);
  const activeFooter = html.slice(footerStart, footerEnd);
  assert.equal((activeFooter.match(/<button/g) || []).length, 2);
  assert.doesNotMatch(activeFooter, /证据|下一步/);
});

test("Desktop Mission reserves the protected approval row without displacing the active Mission footer", () => {
  const approvalHtml = render(AiMissionWorkspace, { selection: { object: { id: "run-approval", type: "Agent run" } } });
  assert.match(approvalHtml, /data-kordyn-v2-mission-stage="approval"/);
  assert.match(approvalHtml, /data-kordyn-v2-open-approval="run-approval"/);
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/ai/ai.css"), "utf8");
  assert.match(css, /\.kordynV2AiMissionInspector\s*\{[^}]*grid-template-rows:\s*auto 126px 44px minmax\(0, 1fr\) auto 76px\s*;/s);
  assert.match(css, /\.kordynV2AiMissionInspectorFooter\s*\{[^}]*grid-row:\s*6\s*;/s);
  assert.match(css, /\.kordynV2AiMissionInspector:not\(\[data-kordyn-v2-mission-stage="approval"\]\) \.kordynV2AiMissionDecision dl\s*\{[^}]*height:\s*calc\(100% - 40px\)[^}]*grid-auto-rows:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.kordynV2AiMissionInspector\s*\{[^}]*grid-template-rows:\s*auto 126px 44px minmax\(0, 1fr\) auto 52px\s*;/s);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.kordynV2AiMissionInspector:not\(\[data-kordyn-v2-mission-stage="approval"\]\) \.kordynV2AiMissionInspectorFooter\s*\{[^}]*align-items:\s*flex-start[^}]*padding-right:\s*27px/s);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.kordynV2AiMissionInspector:not\(\[data-kordyn-v2-mission-stage="approval"\]\) \[data-kordyn-v2-mission-context\]\s*\{[^}]*flex:\s*0 0 116px/s);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.kordynV2AiMissionInspector:not\(\[data-kordyn-v2-mission-stage="approval"\]\) \[data-kordyn-v2-mission-proof\]\s*\{[^}]*flex:\s*0 0 140px/s);
  assert.match(css, /\[data-kordyn-v2-mission-context-fact="Capability"\] dd\s*\{[^}]*white-space:\s*normal[^}]*text-overflow:\s*clip/s);
  assert.match(css, /\[data-kordyn-v2-mission-receipt-fact\] dd\s*\{[^}]*text-overflow:\s*clip/s);
});

test("local Signal filters combine category, time range, and canonical object availability without inventing confidence", () => {
  const rows = model.intelligence;
  assert.deepEqual(filterIntelligenceRows(rows, { category: "all", time: "24h", availability: "all", now: "2026-08-30T08:00:00Z" }).map((row) => row.title), ["CPI 前资金流重定价", "只读事实"]);
  assert.deepEqual(filterIntelligenceRows(rows, { category: "all", time: "unavailable", availability: "all", now: "2026-08-30T08:00:00Z" }).map((row) => row.title), ["时间不可用事实", "FOMC 利率决议", "只读事件"]);
  assert.deepEqual(filterIntelligenceRows(rows, { category: "all", time: "all", availability: "readonly", now: "2026-08-30T08:00:00Z" }).map((row) => row.title), ["只读事实", "只读事件"]);
});

test("Desktop Signals renders three local filter groups and dense real registry metadata", () => {
  const html = render(AiSignalsWorkspace);
  for (const scope of ["category", "time", "availability"]) {
    assert.match(html, new RegExp(`data-kordyn-v2-signal-filter-group="${scope}"`));
  }
  assert.match(html, /data-kordyn-v2-signal-time="unavailable"/);
  assert.match(html, /data-kordyn-v2-signal-availability="readonly"/);
  assert.match(html, /data-kordyn-v2-signal-row-meta/);
  assert.match(html, /可形成对象|只读事实/);
  assert.doesNotMatch(html, /置信度|confidence/i);
});

test("Desktop Signals lower operations are real interactive Watch Event and Intelligence registries", () => {
  const html = render(AiSignalsWorkspace);
  for (const surface of ["watch", "event", "intelligence"]) {
    assert.match(html, new RegExp(`data-kordyn-v2-signal-operation="${surface}"`));
  }
  assert.match(html, /data-kordyn-v2-object-id="watch-eth"[^>]*data-kordyn-v2-object-type="Watch"/);
  assert.match(html, /data-kordyn-v2-object-id="event-fomc"[^>]*data-kordyn-v2-object-type="Event"/);
  assert.match(html, /data-kordyn-v2-object-id="signal-recent"[^>]*data-kordyn-v2-object-type="Signal"/);
  assert.match(html, /data-kordyn-v2-readonly-fact="true"/);
  const intelligenceStart = html.indexOf('data-kordyn-v2-signal-operation="intelligence"');
  const intelligenceEnd = html.indexOf('</section>', intelligenceStart);
  const intelligence = html.slice(intelligenceStart, intelligenceEnd);
  assert.match(intelligence, /data-kordyn-v2-object-id="signal-recent"[^>]*data-kordyn-v2-object-type="Signal"/);
  assert.match(intelligence, /data-kordyn-v2-readonly-fact="true"/);
  assert.match(intelligence, /data-kordyn-v2-readonly-fact="true"[^>]*aria-description="只读事实，可查看详情，不会改变当前对象"/);
  assert.doesNotMatch(intelligence, /data-kordyn-v2-readonly-fact="true"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(intelligence, /data-kordyn-v2-signal-overview-id/);
});
