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
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-actions-ui");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AiApprovalSheet, canApprovePlan, classifyApprovalOutcome, runAuthoritativePlanAction } from "./src/kordynV2/domains/ai/AiApprovalSheet.jsx";
      export { AiOutputSheet, exportPosterPng, translationTextFromResult } from "./src/kordynV2/domains/ai/AiOutputSheet.jsx";
      export { PosterCanvas } from "./src/kordynV2/domains/ai/PosterCanvas.jsx";
      export { AiDialogWorkspace, runDialogSend } from "./src/kordynV2/domains/ai/AiDialogWorkspace.jsx";
      export { MobileAiDialogScreen } from "./src/kordynV2/domains/ai/MobileAiDialogScreen.jsx";
      export { buildAiDomainModel } from "./src/kordynV2/domains/ai/aiModel.js";
      export { createAiActions } from "./src/kordynV2/domains/ai/aiActions.js";
      export { aiPresenterForWorkspace } from "./src/kordynV2/domains/ai/presenters.js";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "html-to-image"],
  outfile: outFile,
  logLevel: "silent"
});

const {
  AiApprovalSheet,
  AiDialogWorkspace,
  AiOutputSheet,
  MobileAiDialogScreen,
  PosterCanvas,
  aiPresenterForWorkspace,
  buildAiDomainModel,
  canApprovePlan,
  classifyApprovalOutcome,
  createAiActions,
  exportPosterPng,
  runAuthoritativePlanAction,
  runDialogSend,
  translationTextFromResult
} = require(outFile);

const approvalPlan = Object.freeze({
  id: "plan-sol-1",
  status: "awaiting_approval",
  symbol: "SOL/USDT",
  direction: "long",
  entry: Object.freeze({ range: "142.20–143.10", riskPercent: 0.3 }),
  stopLoss: 138.8,
  takeProfit: Object.freeze([149.5, 154]),
  leverage: 2,
  max_loss_pct: 0.3,
  strategy: "Breakout Retest v3",
  evidenceIds: Object.freeze(["market-sol", "risk-sol"]),
  lastRiskCheck: Object.freeze({ id: "risk-sol", passed: true, summary: "12/12 通过" }),
  accountImpact: Object.freeze({
    equityUsdt: 28640.72,
    availableMarginUsdt: 13870.1,
    openPositionCount: 3,
    projectedOpenPositionCount: 4,
    estimatedMaxLossUsdt: 8.6
  })
});

const message = Object.freeze({
  id: "message-sol-1",
  role: "agent",
  content: "### SOL 结构复核\n等待人工确认，当前尚未下单。",
  createdAt: "2026-08-29T08:00:00.000Z"
});

const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));

test("AI output UI exposes only deployed output capabilities", () => {
  const html = render(AiOutputSheet, { message, actions: {}, onClose: () => {} });
  const visibleText = html.replace(/<[^>]+>/g, " ");
  assert.match(html, /中文/);
  assert.match(html, /English/);
  assert.match(html, /PNG/);
  assert.doesNotMatch(visibleText, /模板库|风格选择|Telegram.*发送|PDF|SVG/i);
});

test("approval UI does not claim success before the server result", () => {
  const html = render(AiApprovalSheet, { plan: approvalPlan, outcome: null, actions: {}, onClose: () => {} });
  assert.match(html, /需要你确认/);
  assert.match(html, /尚未下单/);
  assert.doesNotMatch(html, /已执行|Success/);
});

test("approval projection carries bounded plan, evidence, risk, and account-impact truth", () => {
  const model = buildAiDomainModel({
    agentRuns: [{ id: "run-sol-1", goal: "SOL 白名单外机会", status: "awaiting_approval", tradePlanId: approvalPlan.id }],
    tradePlans: [approvalPlan],
    chatMessages: [message],
    portfolio: { totalEquityUsdt: 28640.72, availableMarginUsdt: 13870.1 },
    positions: [{ id: "position-1" }, { id: "position-2" }, { id: "position-3" }]
  });
  const projected = model.missions[0].approval;
  assert.equal(projected.planId, approvalPlan.id);
  assert.equal(projected.symbol, "SOL/USDT");
  assert.equal(projected.entry, "142.20–143.10");
  assert.deepEqual(projected.takeProfit, [149.5, 154]);
  assert.equal(projected.risk.passed, true);
  assert.equal(projected.risk.summary, "12/12 通过");
  assert.deepEqual(projected.evidence.ids, ["market-sol", "risk-sol"]);
  assert.equal(projected.accountImpact.equityUsdt, 28640.72);
  assert.equal(projected.accountImpact.openPositionCount, 3);
  assert.equal(projected.valid, true);
});

test("approval fails closed for missing, ambiguous, non-approvable, or invalid facts", () => {
  assert.equal(canApprovePlan(null), false);
  assert.equal(canApprovePlan({ ...approvalPlan, status: "approved" }), false);
  assert.equal(canApprovePlan({ ...approvalPlan, lastRiskCheck: { passed: false, summary: "blocked" } }), false);
  assert.equal(canApprovePlan({ ...approvalPlan, stopLoss: null }), false);

  const ambiguous = buildAiDomainModel({
    agentRuns: [{ id: "run-ambiguous", status: "awaiting_approval" }],
    tradePlans: [approvalPlan, { ...approvalPlan, id: "plan-sol-2" }]
  });
  assert.equal(ambiguous.missions[0].approval, null);
});

test("AI dialog uses the injected action path with exact deployed read and send semantics", async () => {
  const calls = [];
  const read = Object.freeze({ sessions: [], activeSessionId: null, messages: [], provider: null, messageScope: "empty" });
  const sent = Object.freeze({ userMessage: { id: "user-1", sessionId: "chat-manual" }, agentMessage: { id: "agent-1", sessionId: "chat-manual" } });
  const refreshed = Object.freeze({ sessions: [{ id: "chat-manual", title: "SOL" }], activeSessionId: "chat-manual", messages: [message], provider: { name: "production" }, messageScope: "single-session" });
  const responses = [read, sent, refreshed];
  const ai = createAiActions({ action: async (...args) => { calls.push(args); return responses.shift(); } });

  assert.equal(await ai.readChatSession(), read);
  assert.equal(await runDialogSend({ actions: ai, message: "复核 SOL", sessionId: "chat-manual" }), refreshed);
  assert.deepEqual(calls, [
    ["/api/agent/chat", {}, "GET"],
    ["/api/agent/chat", { message: "复核 SOL", sessionId: "chat-manual" }],
    ["/api/agent/chat?sessionId=chat-manual", {}, "GET"]
  ]);
});

test("approval state remains processing until raw authoritative outcome is classified", async () => {
  let release;
  const raw = Object.freeze({
    plan: Object.freeze({ id: approvalPlan.id, status: "approved" }),
    approvalGranted: true,
    executionSubmitted: true,
    execution: Object.freeze({ status: "entry_pending" }),
    message: "计划已批准，入场单已提交到交易所。"
  });
  const states = [];
  const pending = runAuthoritativePlanAction({
    kind: "approve",
    planId: approvalPlan.id,
    action: () => new Promise((resolve) => { release = resolve; }),
    onState: (state) => states.push(state)
  });
  assert.deepEqual(states.map((state) => state.kind), ["processing"]);
  release(raw);
  assert.equal(await pending, raw);
  assert.deepEqual(states.map((state) => state.kind), ["processing", "succeeded"]);
  assert.equal(states[1].result, raw);

  assert.equal(classifyApprovalOutcome("approve", { ok: true }, approvalPlan.id), "failed");
  assert.equal(classifyApprovalOutcome("approve", { ...raw, executionSubmitted: false }, approvalPlan.id), "partial");
  assert.equal(classifyApprovalOutcome("approve", { ...raw, plan: { id: "another-plan", status: "approved" } }, approvalPlan.id), "failed");
  assert.equal(classifyApprovalOutcome("reject", { id: approvalPlan.id, status: "cancelled" }, approvalPlan.id), "succeeded");
});

test("poster translation accepts only the deployed translated field and otherwise returns to Chinese", () => {
  assert.equal(translationTextFromResult({ translated: "SOL review" }), "SOL review");
  assert.equal(translationTextFromResult({ ok: true }), null);
  assert.equal(translationTextFromResult({ translated: "" }), null);
  assert.equal(translationTextFromResult(null), null);
});

test("PNG export waits for fonts and calls the injected downloader only after toPng succeeds", async () => {
  const order = [];
  const fonts = { ready: Promise.resolve().then(() => { order.push("fonts"); }) };
  const download = (...args) => { order.push(["download", ...args]); return "downloaded"; };
  const result = await exportPosterPng({
    node: { id: "poster-node" },
    filename: "kordyn-sol-zh.png",
    fonts,
    toPng: async () => { order.push("toPng"); return "data:image/png;base64,AAAA"; },
    download
  });
  assert.equal(result, "data:image/png;base64,AAAA");
  assert.deepEqual(order, ["fonts", "toPng", ["download", "data:image/png;base64,AAAA", "kordyn-sol-zh.png"]]);

  let failedDownloads = 0;
  await assert.rejects(exportPosterPng({
    node: {},
    filename: "failure.png",
    fonts: { ready: Promise.resolve() },
    toPng: async () => { throw new Error("canvas failed"); },
    download: () => { failedDownloads += 1; }
  }), /canvas failed/);
  assert.equal(failedDownloads, 0);
});

test("Desktop and APP use separate real dialog compositions through the lazy AI domain", () => {
  assert.equal(aiPresenterForWorkspace("dialog", "desktop"), AiDialogWorkspace);
  assert.equal(aiPresenterForWorkspace("dialog", "mobile"), MobileAiDialogScreen);
  const props = { model: { dialog: { messages: [message], sessions: [], activeSessionId: null } }, actions: {}, onClose: () => {} };
  assert.match(render(AiDialogWorkspace, props), /data-kordyn-v2-layout="dialog-workspace"/);
  assert.match(render(MobileAiDialogScreen, props), /data-kordyn-v2-layout="dialog-full-screen"/);
  assert.doesNotMatch(render(MobileAiDialogScreen, props), /data-kordyn-v2-layout="dialog-workspace"/);
  assert.match(render(PosterCanvas, { message, language: "zh", content: message.content }), /data-kordyn-v2-poster-canvas/);
});
