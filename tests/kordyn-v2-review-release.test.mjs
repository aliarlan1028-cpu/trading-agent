import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-review-release");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { default as React } from "react";
      export { renderToStaticMarkup } from "react-dom/server";
      export { buildAssetsDomainModel } from "./src/kordynV2/domains/assets/assetsModel.js";
      export { ReviewReleaseWorkspace } from "./src/kordynV2/domains/assets/ReviewReleaseWorkspace.jsx";
      export { OwnerDecisionQueue } from "./src/kordynV2/domains/assets/OwnerDecisionQueue.jsx";
      export { ReleasePipeline } from "./src/kordynV2/domains/assets/ReleasePipeline.jsx";
      export { ReviewOutputSheet } from "./src/kordynV2/domains/assets/ReviewOutputSheet.jsx";
      export { MobileReviewReleaseScreen } from "./src/kordynV2/domains/assets/MobileReviewReleaseScreen.jsx";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});
const { React, renderToStaticMarkup, buildAssetsDomainModel, ReviewReleaseWorkspace, OwnerDecisionQueue, ReleasePipeline, ReviewOutputSheet, MobileReviewReleaseScreen } = require(outFile);

const data = {
  reviews: [{
    id: "review-btc-42", type: "trade", status: "completed", symbol: "BTC-USDT-SWAP", direction: "long",
    strategyVersionId: "breakout@3.4", strategyName: "Breakout Retest v3.4", completedAt: "2026-08-30T12:41:33Z",
    netRealizedPnl: 186.4, winRate: 58.3, avgSlippagePct: 0.07, holdingMinutes: 138,
    summary: "突破确认有效，但首次挂单因盘口深度变化产生额外滑点。",
    evidence: [{ id: "fill-42", type: "fill", label: "成交与费用对账", status: "verified" }, { id: "trace-42", type: "trace", label: "AI 决策 Trace", status: "verified" }],
    rootCauses: [{ code: "execution_slippage", label: "低深度时二次确认阈值不足", confidence: 0.72 }]
  }],
  ownerReviewLoop: {
    summary: { structuredReviews: 12, candidateLessons: 1, pendingOwner: 1, validating: 1 },
    lessons: [{ id: "lesson-42", reviewId: "review-btc-42", status: "candidate", title: "低深度执行模式", lessonText: "只在匹配市场深度的上下文复用。" }],
    improvements: [
      { id: "improvement-42", reviewId: "review-btc-42", state: "pending_owner", destination: "strategy", title: "Breakout Retest v3.5 candidate", problem: "低深度时滑点偏高", proposal: "增加二次确认阈值", evidenceCount: 6, version: "v3.5", validation: { ready: false, stages: [{ name: "tests", status: "pending" }, { name: "oos", status: "pending" }] } },
      { id: "improvement-43", reviewId: "review-btc-42", state: "validating", destination: "capability", title: "Slippage Preflight threshold", problem: "执行前检查需要更严格", proposal: "提高阈值", evidenceCount: 3, version: "v1.8", validation: { ready: true, readyForOwnerVerification: true, stages: [{ name: "tests", status: "passed" }, { name: "paper", status: "passed" }] }, validationEvidence: [{ type: "regression_test", value: "42/42 passed" }] }
    ]
  },
  paperReport: { sessions: [{ id: "paper-42", improvementId: "improvement-43", status: "passed", symbol: "BTC-USDT-SWAP" }] }
};
const model = buildAssetsDomainModel(data);
const actions = { decideLesson: () => {}, decideImprovement: () => {}, startPureForwardSession: () => {} };
const noop = () => {};

test("review cannot directly rewrite a live strategy capability or rule", () => {
  const source = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/assets/OwnerDecisionQueue.jsx"), "utf8");
  assert.doesNotMatch(source, /\/api\/(strategy\/market|skills\/[^/]+\/enable|risk\/rules\/[^/]+)/);
  assert.match(source, /review\/improvements/);
  const html = renderToStaticMarkup(React.createElement(OwnerDecisionQueue, { improvements: model.owner.improvements, actions, onSelect: noop }));
  assert.match(html, /优化不会自行生效/);
  assert.match(html, /data-kordyn-v2-owner-candidate="improvement-42"/);
});

test("Owner release requires production evidence", () => {
  const blocked = model.owner.improvements.find((row) => row.id === "improvement-42");
  const ready = model.owner.improvements.find((row) => row.id === "improvement-43");
  const blockedHtml = renderToStaticMarkup(React.createElement(ReleasePipeline, { candidate: blocked, actions }));
  const readyHtml = renderToStaticMarkup(React.createElement(ReleasePipeline, { candidate: ready, actions }));
  assert.match(blockedHtml, /data-kordyn-v2-action="release"[^>]*disabled/);
  assert.match(blockedHtml, /不可发布/);
  assert.doesNotMatch(readyHtml, /data-kordyn-v2-action="release"[^>]*disabled/);
  assert.match(readyHtml, /Owner 明确确认/);
});

test("review workbench preserves review evidence Owner decision release and output as one lifecycle", () => {
  const html = renderToStaticMarkup(React.createElement(ReviewReleaseWorkspace, { model, actions, selectedOwnerId: "improvement-43", onSelectReview: noop, onSelectOwner: noop, onNavigate: noop }));
  assert.match(html, /data-kordyn-v2-assets-workspace="reviews"/);
  assert.match(html, /data-kordyn-v2-review-id="review-btc-42"/);
  assert.match(html, /成交与费用对账/);
  assert.match(html, /data-kordyn-v2-owner-candidate="improvement-42"/);
  assert.match(html, /data-kordyn-v2-release-pipeline/);
  assert.match(html, /data-kordyn-v2-validation-run="paper-42"/);
  assert.match(html, /data-kordyn-v2-output-draft/);
});

test("review poster remains an editable draft and uses the existing AI Trader output path", () => {
  const review = model.reviews[0];
  const html = renderToStaticMarkup(React.createElement(ReviewOutputSheet, { review, onNavigate: noop }));
  assert.match(html, /海报草稿/);
  assert.match(html, /人工审阅后导出/);
  assert.match(html, /进入 AI 交易员生成/);
  assert.doesNotMatch(html, />\s*(?:立即)?自动发布|>\s*auto.?publish/i);
});

test("APP keeps review evidence Owner decision and release as sequential touch flows", () => {
  const html = renderToStaticMarkup(React.createElement(MobileReviewReleaseScreen, { model, actions, onSelectReview: noop, onSelectOwner: noop, onNavigate: noop }));
  for (const flow of ["review", "evidence", "owner", "release"]) assert.match(html, new RegExp(`data-kordyn-v2-mobile-${flow}-flow`));
  assert.doesNotMatch(html, /<table/);
});
