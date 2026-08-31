import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-shell");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { DesktopShell } from "./src/kordynV2/shell/DesktopShell.jsx";
      export { MobileShell } from "./src/kordynV2/shell/MobileShell.jsx";
      export { MobileSheet } from "./src/kordynV2/shell/MobileSheet.jsx";
      export { buildShellTrace } from "./src/productShell.jsx";
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

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { DesktopShell, MobileShell, MobileSheet, buildShellTrace } = require(outFile);

const readyTruth = Object.freeze({
  mode: "compact",
  equity: 28640.72,
  available: 13870.1,
  exposure: 6102.4,
  freshness: "2026-08-27T14:32:00+08:00",
  freshnessState: "fresh",
  runtime: "full_auto_small",
  risk: "normal"
});

const canonicalSelection = Object.freeze({
  object: { id: "mission-eth-retest", type: "Mission", label: "ETH 突破回踩机会" },
  context: { objectId: "mission-eth-retest", title: "ETH 突破回踩机会" },
  trace: { objectId: "mission-eth-retest", stages: [] }
});

test("Desktop shell follows the approved four-domain composition", () => {
  const truth = {
    mode: "full",
    equity: 28640.72,
    available: 13870.1,
    exposure: 6102.4,
    freshness: "2026-08-27T14:32:00+08:00",
    freshnessState: "fresh",
    runtime: "full_auto_small",
    risk: "normal"
  };
  const selection = {
    object: { id: "mission-eth-retest", type: "Mission", label: "ETH 突破回踩机会" },
    context: { objectId: "mission-eth-retest", title: "ETH 突破回踩机会" },
    trace: { objectId: "mission-eth-retest", stages: [] }
  };
  const html = renderToStaticMarkup(
    React.createElement(
      DesktopShell,
      {
        location: { domainId: "ai", workspaceId: "missions" },
        truth,
        state: { kind: "ready" },
        selection,
        onNavigate: () => {},
        onSelect: () => {}
      },
      React.createElement("main")
    )
  );
  assert.match(html, /data-kordyn-v2-shell="desktop"/);
  assert.match(html, /data-kordyn-v2-shell="desktop"[^>]*data-kordyn-v2-selected-id="mission-eth-retest"[^>]*data-kordyn-v2-selected-type="Mission"/);
  assert.equal((html.match(/data-kordyn-v2-domain-target=/g) || []).length, 4);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
  for (const label of ["AI 交易员", "账户交易", "智能资产", "系统治理", "任务", "情报", "观察哨", "事件日历", "对话"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /今日|更多/);
});

test("APP shell exposes exactly four full-label roots without a catch-all destination", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MobileShell,
      {
        location: { domainId: "ai", workspaceId: "missions" },
        truth: readyTruth,
        state: { kind: "ready" },
        selection: canonicalSelection,
        identity: { name: "K0", notificationCount: 1 },
        onNavigate: () => {},
        onSelect: () => {}
      },
      React.createElement("main")
    )
  );

  assert.match(html, /data-kordyn-v2-shell="mobile"/);
  assert.match(html, /data-kordyn-v2-shell="mobile"[^>]*data-kordyn-v2-selected-id="mission-eth-retest"[^>]*data-kordyn-v2-selected-type="Mission"/);
  assert.equal((html.match(/data-kordyn-v2-domain-target=/g) || []).length, 4);
  assert.equal((html.match(/data-kordyn-v2-workspace-target=/g) || []).length, 5);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
  for (const label of ["AI 交易员", "账户交易", "智能资产", "系统治理", "任务", "情报", "观察哨", "事件日历", "对话"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /今日|更多/);
});

test("APP shell follows the approved compact identity, title, destinations, and truth order", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MobileShell,
      {
        location: { domainId: "ai", workspaceId: "missions" },
        truth: readyTruth,
        state: { kind: "ready" },
        selection: canonicalSelection,
        identity: { name: "K0", notificationCount: 1 },
        onNavigate: () => {},
        onSelect: () => {}
      },
      React.createElement("main", { "data-kordyn-v2-mobile-mission-home": true }, "Mission")
    )
  );

  const readingOrder = [
    'data-kordyn-v2-mobile-identity',
    'data-kordyn-v2-mobile-title',
    'data-kordyn-v2-workspace-nav',
    'data-kordyn-v2-account-truth-mode',
    'data-kordyn-v2-mobile-mission-home'
  ].map((marker) => html.indexOf(marker));
  assert.ok(readingOrder.every((index) => index >= 0), `missing approved APP marker: ${readingOrder}`);
  assert.deepEqual(readingOrder, [...readingOrder].sort((a, b) => a - b));
  assert.match(html, /data-kordyn-v2-notification-target="governance\/notifications"/);
  assert.match(html, /data-kordyn-v2-account-truth-mode="full"/);
  assert.match(html, /data-kordyn-v2-truth-fact="available"/);
  assert.match(html, /kordynV2MobileEvidenceDock/);
  assert.match(html, /data-kordyn-v2-context-trigger/);
  assert.match(html, /data-kordyn-v2-proof-trigger/);
});

test("APP shell preserves each non-Mission domain canonical truth mode", () => {
  const renderMode = (domainId, workspaceId, mode) => renderToStaticMarkup(
    React.createElement(
      MobileShell,
      {
        location: { domainId, workspaceId },
        truth: { ...readyTruth, mode },
        state: { kind: "ready" },
        selection: canonicalSelection,
        identity: { name: "K0", notificationCount: 1 },
        onNavigate: () => {},
        onSelect: () => {}
      },
      React.createElement("main")
    )
  );

  const assets = renderMode("assets", "relationships", "compact");
  const governance = renderMode("governance", "overview", "critical");
  assert.match(assets, /data-kordyn-v2-account-truth-mode="compact"/);
  assert.doesNotMatch(assets, /data-kordyn-v2-truth-fact="available"/);
  assert.match(governance, /data-kordyn-v2-account-truth-mode="critical"/);
  assert.doesNotMatch(governance, /data-kordyn-v2-truth-fact="equity"/);
});

test("APP governed evidence exposes full decision facts with complete tab relationships", () => {
  const html = renderToStaticMarkup(React.createElement(MobileSheet, {
    panel: "evidence",
    selection: canonicalSelection,
    initialEvidenceTab: "details",
    evidenceDetails: [
      ["策略", "Breakout Retest v3"],
      ["知识来源", "波动环境指南 + 2 条真实复盘"],
      ["能力", "行情 / 市场结构 / 风控 / 执行"],
      ["事件", "FOMC · 6h"],
      ["持仓影响", "long 1.4"]
    ],
    onClose: () => {}
  }));

  for (const [tab, label] of [["details", "详情"], ["context", "Context"], ["proof", "Proof"]]) {
    assert.match(html, new RegExp(`id="kordyn-v2-evidence-tab-${tab}"[^>]*aria-controls="kordyn-v2-evidence-panel"`));
    assert.match(html, new RegExp(`data-kordyn-v2-evidence-tab="${tab}"[^>]*>${label}|data-kordyn-v2-evidence-tab="${tab}"[\\s\\S]*?>${label}`));
  }
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /id="kordyn-v2-evidence-panel"/);
  assert.match(html, /aria-labelledby="kordyn-v2-evidence-tab-details"/);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((html.match(/tabindex="-1"/g) || []).length, 2);
  for (const value of ["Breakout Retest v3", "波动环境指南 + 2 条真实复盘", "行情 / 市场结构 / 风控 / 执行", "FOMC · 6h", "long 1.4"]) {
    assert.ok(html.includes(value), `missing governed decision fact: ${value}`);
  }
});

test("APP Proof keeps bounded scalar details visible with stages and rejects unsafe coercion", () => {
  const html = renderToStaticMarkup(React.createElement(MobileSheet, {
    panel: "evidence",
    selection: {
      ...canonicalSelection,
      trace: { objectId: "mission-eth-retest", stages: [{ id: "review", label: "Review", detail: "Receipt retained", status: "complete" }] }
    },
    initialEvidenceTab: "proof",
    evidenceDetails: [
      ["创建", "2026-08-27T05:20:00Z"],
      ["更新", "Unavailable"],
      ["完成", "2026-08-27T05:43:00Z"],
      ["unsafe", { toString: () => "must-not-coerce" }],
      ["x".repeat(80), "y".repeat(240)]
    ],
    onClose: () => {}
  }));

  for (const value of ["2026-08-27T05:20:00Z", "Unavailable", "2026-08-27T05:43:00Z", "Receipt retained"]) {
    assert.ok(html.includes(value), `Proof keeps safe evidence detail: ${value}`);
  }
  assert.doesNotMatch(html, /must-not-coerce/);
  assert.doesNotMatch(html, new RegExp("x{80}|y{240}"));
});

test("shell selected type fails closed when canonical selection has no trusted type", () => {
  for (const Shell of [DesktopShell, MobileShell]) {
    const html = renderToStaticMarkup(React.createElement(Shell, {
      location: { domainId: "ai", workspaceId: "missions" },
      truth: readyTruth,
      state: { kind: "ready" },
      selection: { object: { id: "mission-unknown" } },
      identity: { name: "K0", notificationCount: 0 },
      onNavigate: () => {}
    }, React.createElement("main")));
    assert.match(html, /data-kordyn-v2-selected-id="mission-unknown"[^>]*data-kordyn-v2-selected-type="none"/);
  }
});

test("APP shell keeps unknown and adverse truth fail-closed", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MobileShell,
      {
        location: { domainId: "governance", workspaceId: "overview" },
        truth: { mode: "critical", runtime: "calibrating", risk: "pending", freshnessState: "novel" },
        state: { kind: "degraded", retainsLastValid: true, message: "部分降级", source: "Unavailable", lastValidAt: "Unavailable" },
        selection: null,
        onNavigate: () => {},
        onSelect: () => {}
      },
      React.createElement("main")
    )
  );

  assert.match(html, /data-kordyn-v2-state="degraded"/);
  assert.match(html, /data-health-tone="unavailable"/);
  assert.match(html, />Unavailable</);
  assert.doesNotMatch(html, /风险正常|运行正常|实时正常/);
  assert.doesNotMatch(html, /kordynV2MobileEvidenceDock/);
  assert.doesNotMatch(html, /data-kordyn-v2-(?:context|proof)-trigger/);
});

test("Trace identity gives explicit object identity precedence over a record id", () => {
  const selected = { id: "watch-target", type: "Watch", workspaceId: "ai" };
  const matched = buildShellTrace({
    resourceState: { chat: "loaded" },
    traces: [{
      id: "trace-record-1",
      objectId: "watch-target",
      objectType: "Watch",
      workspaceId: "ai",
      stage: "Sense",
      status: "complete",
      evidenceId: "explicit-object-match"
    }]
  }, "ai", selected);
  assert.equal(matched.find((stage) => stage.id === "sense")?.evidence, "explicit-object-match");

  const conflict = buildShellTrace({
    resourceState: { chat: "loaded" },
    traces: [{
      id: "watch-target",
      objectId: "watch-other",
      objectType: "Watch",
      workspaceId: "ai",
      stage: "Sense",
      status: "complete",
      evidenceId: "conflicting-object"
    }]
  }, "ai", selected);
  assert.notEqual(conflict.find((stage) => stage.id === "sense")?.evidence, "conflicting-object");
});

test("Trace identity retains id-only legacy row matching", () => {
  const selected = { id: "watch-target", type: "Watch", workspaceId: "ai" };
  const stages = buildShellTrace({
    resourceState: { chat: "loaded" },
    traces: [{
      id: "watch-target",
      objectType: "Watch",
      workspaceId: "ai",
      stage: "Guard",
      status: "complete",
      evidenceId: "legacy-id-match"
    }]
  }, "ai", selected);
  assert.equal(stages.find((stage) => stage.id === "guard")?.evidence, "legacy-id-match");
});
