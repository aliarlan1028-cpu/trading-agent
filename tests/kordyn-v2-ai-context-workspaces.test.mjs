import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectOverviewSection } from "../server/overviewView.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-context-workspaces");
const componentBundle = path.join(cacheDir, `components-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(componentBundle, { force: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AiSignalsWorkspace } from "./src/kordynV2/domains/ai/AiSignalsWorkspace.jsx";
      export { AiWatchWorkspace } from "./src/kordynV2/domains/ai/AiWatchWorkspace.jsx";
      export { AiEventsWorkspace } from "./src/kordynV2/domains/ai/AiEventsWorkspace.jsx";
      export { MobileAiSignalsScreen } from "./src/kordynV2/domains/ai/MobileAiSignalsScreen.jsx";
      export { MobileAiWatchScreen } from "./src/kordynV2/domains/ai/MobileAiWatchScreen.jsx";
      export { MobileAiEventsScreen } from "./src/kordynV2/domains/ai/MobileAiEventsScreen.jsx";
      export { buildAiDomainModel } from "./src/kordynV2/domains/ai/aiModel.js";
      export { canonicalContextAttributes, runAiContextRowInteraction } from "./src/kordynV2/domains/ai/contextInteraction.js";
      export { aiPresenterForWorkspace } from "./src/kordynV2/domains/ai/presenters.js";
      export { memoryPayloadForFact, canRememberIntelligence, canCancelWatch, canRefreshEvents, classifyAiContextActionResult, runAuthoritativeAiContextAction, aiContextActionDetail } from "./src/kordynV2/domains/ai/contextActions.js";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
  outfile: componentBundle,
  logLevel: "silent"
});

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  AiSignalsWorkspace,
  AiWatchWorkspace,
  AiEventsWorkspace,
  MobileAiSignalsScreen,
  MobileAiWatchScreen,
  MobileAiEventsScreen,
  buildAiDomainModel,
  canonicalContextAttributes,
  runAiContextRowInteraction,
  aiPresenterForWorkspace,
  memoryPayloadForFact,
  canRememberIntelligence,
  canCancelWatch,
  canRefreshEvents,
  classifyAiContextActionResult,
  runAuthoritativeAiContextAction,
  aiContextActionDetail
} = require(componentBundle);

const model = buildAiDomainModel({
  agentRuns: [{ id: "mission-context-1", goal: "重新分析 ETF 资金流", status: "observing", steps: [] }],
  newsFeed: [{ id: "signal-news-1", title: "ETF 资金流更新", sourceName: "MacroMicro", observedAt: "2026-08-29T08:05:00Z" }],
  watchTriggers: [{ id: "watch-eth-1", title: "ETH 突破回踩", symbol: "ETH/USDT", status: "active" }],
  marketCalendarEvents: [{
    id: "event-fomc-1",
    title: "FOMC 利率决议",
    startAt: "2026-09-17",
    timePrecision: "date",
    importance: "high",
    sourceName: "Federal Reserve",
    symbols: ["BTC/USDT", "ETH/USDT"]
  }]
});

const render = (Component) => renderToStaticMarkup(React.createElement(Component, {
  model,
  actions: Object.freeze({}),
  selection: null,
  onSelect: () => {},
  onOpenProof: () => {}
}));

test("Desktop and APP expose the same Signal Watch and Event identities with device-specific layouts", () => {
  const pairs = [
    [AiSignalsWorkspace, MobileAiSignalsScreen, "signal-news-1", "Signal", "signals-registry-inspector", "signals-task-flow"],
    [AiWatchWorkspace, MobileAiWatchScreen, "watch-eth-1", "Watch", "watch-registry-inspector", "watch-task-flow"],
    [AiEventsWorkspace, MobileAiEventsScreen, "event-fomc-1", "Event", "events-calendar-inspector", "events-task-flow"]
  ];

  for (const [Desktop, Mobile, id, type, desktopLayout, mobileLayout] of pairs) {
    const desktop = render(Desktop);
    const mobile = render(Mobile);
    for (const html of [desktop, mobile]) {
      assert.match(html, new RegExp(`data-kordyn-v2-object-id="${id}"`));
      assert.match(html, new RegExp(`data-kordyn-v2-object-type="${type}"`));
      assert.match(html, new RegExp(`data-kordyn-v2-context-proof="${id}"`));
    }
    assert.match(desktop, new RegExp(`data-kordyn-v2-layout="${desktopLayout}"`));
    assert.match(mobile, new RegExp(`data-kordyn-v2-layout="${mobileLayout}"`));
    assert.doesNotMatch(mobile, new RegExp(`data-kordyn-v2-layout="${desktopLayout}"`));
  }
});

test("Watch surfaces state that hits re-analyze and never auto-order", () => {
  for (const Component of [AiWatchWorkspace, MobileAiWatchScreen]) {
    const html = render(Component);
    assert.match(html, /命中后重新分析/);
    assert.match(html, /不会自动下单/);
    assert.doesNotMatch(html, /命中后自动下单|auto.?order/i);
  }
});

test("unidentified and ambiguous rows remain locally inspectable without a partial canonical identity", () => {
  const unidentified = Object.freeze({ kind: "news", title: "只有展示事实", source: "official", selectable: false });
  const ambiguous = Object.freeze({ id: "signal-duplicate", kind: "news", title: "重复来源事实", source: "official", selectable: false });

  for (const row of [unidentified, ambiguous]) {
    const inspected = [];
    const selected = [];
    assert.deepEqual(canonicalContextAttributes(row, "Signal"), {});
    assert.equal(runAiContextRowInteraction({
      row,
      type: "Signal",
      onInspect: (value) => inspected.push(value),
      onSelect: (value) => selected.push(value),
      candidateFor: (value) => ({ id: value.id, type: "Signal" })
    }), null);
    assert.deepEqual(inspected, [row]);
    assert.deepEqual(selected, []);
  }

  const selectable = Object.freeze({ id: "signal-safe", kind: "news", title: "唯一事实", selectable: true });
  const selected = [];
  assert.deepEqual(canonicalContextAttributes(selectable, "Signal"), {
    "data-kordyn-v2-object-id": "signal-safe",
    "data-kordyn-v2-object-type": "Signal"
  });
  assert.deepEqual(runAiContextRowInteraction({
    row: selectable,
    type: "Signal",
    onInspect: () => {},
    onSelect: (value) => selected.push(value),
    candidateFor: (value) => ({ id: value.id, type: "Signal" })
  }), { id: "signal-safe", type: "Signal" });
  assert.deepEqual(selected, [{ id: "signal-safe", type: "Signal" }]);
});

test("read-only Signal Watch and Event surfaces expose detail without canonical DOM identity or Proof", () => {
  const cases = [
    [AiSignalsWorkspace, MobileAiSignalsScreen, "intelligence", { kind: "news", title: "只读情报事实", source: "official", selectable: false }],
    [AiWatchWorkspace, MobileAiWatchScreen, "watches", { title: "只读观察哨", symbol: "BTC/USDT", status: "active", selectable: false }],
    [AiEventsWorkspace, MobileAiEventsScreen, "events", { title: "只读事件", startAt: "2026-09-01", timePrecision: "date", selectable: false }]
  ];
  for (const [Desktop, Mobile, collection, rawRow] of cases) {
    const readOnlyModel = { ...model, [collection]: [Object.freeze(rawRow)] };
    for (const Component of [Desktop, Mobile]) {
      const html = renderToStaticMarkup(React.createElement(Component, {
        model: readOnlyModel,
        actions: Object.freeze({}),
        selection: null,
        onSelect: () => {},
        onOpenProof: () => {}
      }));
      assert.match(html, new RegExp(rawRow.title));
      assert.match(html, /data-kordyn-v2-readonly-fact="true"/);
      const readOnlyTag = html.match(/<button[^>]*data-kordyn-v2-readonly-fact="true"[^>]*>/)?.[0] || "";
      assert.doesNotMatch(readOnlyTag, /data-kordyn-v2-object-id=/);
      assert.doesNotMatch(readOnlyTag, /data-kordyn-v2-object-type=/);
      assert.doesNotMatch(html, /data-kordyn-v2-context-proof=/);
      assert.match(html, /disabled=""/);
    }
  }
});

test("one lazy AI domain selects all approved Desktop and APP workspaces by workspace identity", () => {
  const cases = [
    ["missions", "mission-registry-inspector", "mission-task-flow"],
    ["intelligence", "signals-registry-inspector", "signals-task-flow"],
    ["watch", "watch-registry-inspector", "watch-task-flow"],
    ["events", "events-calendar-inspector", "events-task-flow"]
  ];
  for (const [workspaceId, desktopLayout, mobileLayout] of cases) {
    const Desktop = aiPresenterForWorkspace(workspaceId, "desktop");
    const Mobile = aiPresenterForWorkspace(workspaceId, "mobile");
    assert.equal(typeof Desktop, "function");
    assert.equal(typeof Mobile, "function");
    assert.match(render(Desktop), new RegExp(`data-kordyn-v2-layout="${desktopLayout}"`));
    assert.match(render(Mobile), new RegExp(`data-kordyn-v2-layout="${mobileLayout}"`));
  }
});

test("direct operationsCenter and chat projections carry only bounded facts consumed by AI context workspaces", () => {
  const marketMovers = {
    scannedAt: "2026-08-29T09:00:00Z",
    updatedAt: "2026-08-29T09:01:00Z",
    secret: "must-not-project",
    movers: Array.from({ length: 15 }, (_, index) => ({
      id: `mover-${index}`,
      instId: `ASSET-${index}-USDT-SWAP`,
      symbol: `ASSET${index}/USDT`,
      last: 100 + index,
      changePct: index + 1,
      quoteVolUsdt: 1_000_000 + index,
      high24h: 110 + index,
      low24h: 90 + index,
      observedAt: "2026-08-29T09:00:00Z",
      secret: "must-not-project",
      narrative: { untrustedDisplay: { narrative: "must-not-project" } }
    }))
  };
  const operations = projectOverviewSection({
    marketMovers,
    newsFeed: [{ id: "news-direct", title: "直接情报" }],
    marketCalendarEvents: [{ id: "event-direct", title: "直接事件", startAt: "2026-09-01", timePrecision: "date" }]
  }, "operationsCenter");
  const chat = projectOverviewSection({
    watchTriggers: [{ id: "watch-direct", title: "直接观察哨", status: "active" }]
  }, "chat");

  assert.equal(operations.marketMovers.movers.length, 12);
  assert.deepEqual(Object.keys(operations.marketMovers).sort(), ["movers", "scannedAt", "updatedAt"]);
  assert.deepEqual(Object.keys(operations.marketMovers.movers[0]).sort(), [
    "changePct", "high24h", "id", "instId", "last", "low24h", "observedAt", "quoteVolUsdt", "symbol"
  ]);
  assert.equal(JSON.stringify(operations).includes("must-not-project"), false);

  const operationsModel = buildAiDomainModel(operations);
  const chatModel = buildAiDomainModel(chat);
  assert.deepEqual(operationsModel.intelligence.map((row) => row.id), ["news-direct", "event-direct", ...Array.from({ length: 12 }, (_, index) => `mover-${index}`)]);
  assert.deepEqual(operationsModel.events.map((row) => row.id), ["event-direct"]);
  assert.deepEqual(chatModel.watches.map((row) => row.id), ["watch-direct"]);
});

test("context actions derive bounded visible payloads and classify only authoritative results as success", () => {
  const longSummary = `确定性事实 ${"证".repeat(900)}`;
  const row = Object.freeze({
    id: "signal-memory",
    kind: "news",
    title: `CPI 快讯 ${"题".repeat(200)}`,
    summary: longSummary,
    source: "newsFeed",
    selectable: true,
    secret: "must-not-write"
  });
  const payload = memoryPayloadForFact(row);
  assert.deepEqual(Object.keys(payload), ["layer", "title", "content", "tags", "source"]);
  assert.equal(payload.layer, "episodic");
  assert.equal(payload.title.length, 160);
  assert.equal(payload.content.length, 800);
  assert.deepEqual(payload.tags, ["情报", "news"]);
  assert.equal(payload.source, "v2_ai_intelligence");
  assert.equal(JSON.stringify(payload).includes("must-not-write"), false);
  assert.equal(memoryPayloadForFact({ ...row, selectable: false }), null);

  assert.equal(classifyAiContextActionResult("memory", { id: "memory-1" }), "succeeded");
  assert.equal(classifyAiContextActionResult("memory", { ok: true }), "failed");
  assert.equal(classifyAiContextActionResult("watch", { watch: { id: "watch-1", status: "cancelled" } }, "watch-1"), "succeeded");
  assert.equal(classifyAiContextActionResult("watch", { ok: true }, "watch-1"), "failed");
  assert.equal(classifyAiContextActionResult("events", { status: "ok", attempted: 2 }), "succeeded");
  assert.equal(classifyAiContextActionResult("events", { status: "partial", attempted: 2 }), "partial");
  assert.equal(classifyAiContextActionResult("events", { status: "skipped", reason: "no_enabled_sources" }), "partial");
  assert.equal(classifyAiContextActionResult("events", { status: "failed" }), "failed");
});

test("memory write requires the current canonical Signal and never treats an Event as Signal memory", () => {
  const row = Object.freeze({ id: "signal-memory", kind: "news", title: "CPI 快讯", summary: "确定性事实", selectable: true });
  const actions = Object.freeze({ rememberIntelligence: async () => ({ id: "memory-1" }) });
  const signalSelection = Object.freeze({ object: Object.freeze({ id: row.id, type: "Signal" }), context: Object.freeze({ actionsDisabled: false }) });
  assert.equal(canRememberIntelligence({ row, type: "Signal", selection: signalSelection, actions, actionsDisabled: false }), true);
  assert.equal(canRememberIntelligence({ row, type: "Event", selection: { ...signalSelection, object: { id: row.id, type: "Event" } }, actions, actionsDisabled: false }), false);
  assert.equal(canRememberIntelligence({ row, type: "Signal", selection: { ...signalSelection, object: { id: "other", type: "Signal" } }, actions, actionsDisabled: false }), false);
  assert.equal(canRememberIntelligence({ row: { ...row, selectable: false }, type: "Signal", selection: signalSelection, actions, actionsDisabled: false }), false);
  assert.equal(canRememberIntelligence({ row, type: "Signal", selection: signalSelection, actions, actionsDisabled: true }), false);
});

test("Watch cancellation requires the active canonical current object and ready action boundary", () => {
  const row = Object.freeze({ id: "watch-active", symbol: "ETH/USDT", status: "active", selectable: true });
  const actions = Object.freeze({ cancelWatch: async () => ({ watch: { id: row.id, status: "cancelled" } }) });
  const selection = Object.freeze({ object: Object.freeze({ id: row.id, type: "Watch" }), context: Object.freeze({ actionsDisabled: false }) });
  assert.equal(canCancelWatch({ row, selection, actions, actionsDisabled: false }), true);
  assert.equal(canCancelWatch({ row, selection: { object: { id: "other", type: "Watch" } }, actions, actionsDisabled: false }), false);
  assert.equal(canCancelWatch({ row: { ...row, status: "triggered" }, selection, actions, actionsDisabled: false }), false);
  assert.equal(canCancelWatch({ row: { ...row, selectable: false }, selection, actions, actionsDisabled: false }), false);
  assert.equal(canCancelWatch({ row, selection, actions, actionsDisabled: true }), false);
  assert.equal(canCancelWatch({ row, selection: { ...selection, context: { actionsDisabled: true } }, actions, actionsDisabled: false }), false);
  assert.equal(canCancelWatch({ row, selection, actions: {}, actionsDisabled: false }), false);
});

test("Event refresh respects the selected Context action gate on Desktop and APP", () => {
  const actions = Object.freeze({ refreshEvents: async () => ({ status: "ok" }) });
  const openSelection = Object.freeze({ object: Object.freeze({ id: "event-fomc-1", type: "Event" }), context: Object.freeze({ actionsDisabled: false }) });
  const gatedSelection = Object.freeze({ ...openSelection, context: Object.freeze({ actionsDisabled: true }) });
  assert.equal(canRefreshEvents({ selection: openSelection, actions, actionsDisabled: false }), true);
  assert.equal(canRefreshEvents({ selection: gatedSelection, actions, actionsDisabled: false }), false);
  for (const Component of [AiEventsWorkspace, MobileAiEventsScreen]) {
    const open = renderToStaticMarkup(React.createElement(Component, { model, actions, actionsDisabled: false, selection: openSelection }));
    const gated = renderToStaticMarkup(React.createElement(Component, { model, actions, actionsDisabled: false, selection: gatedSelection }));
    assert.doesNotMatch(open, /data-kordyn-v2-context-action="refresh-events"[^>]*disabled/);
    assert.match(gated, /data-kordyn-v2-context-action="refresh-events"[^>]*disabled/);
  }
});

test("every Task 3 context workspace preserves the shared low AI prompt entry", () => {
  for (const Component of [AiSignalsWorkspace, MobileAiSignalsScreen, AiWatchWorkspace, MobileAiWatchScreen, AiEventsWorkspace, MobileAiEventsScreen]) {
    const html = renderToStaticMarkup(React.createElement(Component, { model, actions: {}, actionsDisabled: false, selection: null }));
    assert.match(html, /data-kordyn-v2-dialog-trigger="true"/);
  }
});

test("context actions enter processing before awaiting and return raw truth without optimistic mutation", async () => {
  let resolveAction;
  const raw = Object.freeze({ watch: Object.freeze({ id: "watch-active", status: "cancelled" }) });
  const rows = Object.freeze([Object.freeze({ id: "watch-active", status: "active" })]);
  const states = [];
  const pending = runAuthoritativeAiContextAction({
    kind: "watch",
    expectedId: "watch-active",
    action: () => new Promise((resolve) => { resolveAction = resolve; }),
    onState: (state) => states.push(state)
  });
  assert.deepEqual(states.map((state) => state.kind), ["processing"]);
  assert.equal(rows[0].status, "active");
  resolveAction(raw);
  assert.equal(await pending, raw);
  assert.deepEqual(states.map((state) => state.kind), ["processing", "succeeded"]);
  assert.equal(states[1].result, raw);
  assert.equal(rows[0].status, "active");

  const failures = [];
  const error = new Error("network down");
  assert.equal(await runAuthoritativeAiContextAction({
    kind: "events",
    action: async () => { throw error; },
    onState: (state) => failures.push(state)
  }), null);
  assert.deepEqual(failures.map((state) => state.kind), ["processing", "failed"]);
  assert.equal(failures[1].error, error);
});

test("a late authoritative result is not attributed to a newly selected object", async () => {
  let currentId = "watch-old";
  let release;
  const states = [];
  const pending = runAuthoritativeAiContextAction({
    kind: "watch",
    expectedId: "watch-old",
    action: () => new Promise((resolve) => { release = resolve; }),
    isCurrent: () => currentId === "watch-old",
    onState: (state) => states.push(state)
  });
  assert.deepEqual(states.map((state) => state.kind), ["processing"]);
  currentId = "watch-new";
  const raw = Object.freeze({ watch: Object.freeze({ id: "watch-old", status: "cancelled" }) });
  release(raw);
  assert.equal(await pending, raw);
  assert.deepEqual(states.map((state) => state.kind), ["processing"]);
});

test("authoritative outcome details expose only bounded whitelisted server facts", () => {
  assert.equal(aiContextActionDetail("memory", { id: `memory-${"x".repeat(180)}`, secret: "no" }), `记忆 ID memory-${"x".repeat(113)}`);
  assert.equal(aiContextActionDetail("watch", { watch: { id: "watch-1", status: "cancelled", secret: "no" } }), "watch-1 · cancelled");
  assert.equal(aiContextActionDetail("events", { status: "partial", attempted: 3, succeeded: 2, failed: 1, ingested: 4, reason: "one_source_failed", secret: "no" }), "partial · 成功 2/3 · 失败 1 · 新增 4 · one_source_failed");
  assert.equal(aiContextActionDetail("events", { status: "ok", attempted: "many", reason: { secret: "no" } }), "ok");
  assert.equal(aiContextActionDetail("events", { status: "failed", reason: "r".repeat(200) }).length <= 160, true);
  assert.equal(aiContextActionDetail("unknown", { secret: "no" }), "Unavailable");
});

test("Desktop Signal workbench keeps AI task boundary Watch status and Event timing visible in one context lens", () => {
  const html = render(AiSignalsWorkspace);
  assert.match(html, /data-kordyn-v2-relationship-lens="signal-context"/);
  assert.match(html, /重新分析 ETF 资金流/);
  assert.match(html, /Signal 不等于 Plan/);
  assert.match(html, /ETH 突破回踩/);
  assert.match(html, /active/);
  assert.match(html, /FOMC 利率决议/);
  assert.match(html, /2026-09-17/);
  assert.match(html, /未建立对象级关联/);
});

test("empty long-content and large-list context workspaces remain truthful and complete", () => {
  const emptyModel = Object.freeze({ intelligence: Object.freeze([]), watches: Object.freeze([]), events: Object.freeze([]), missions: Object.freeze([]) });
  for (const Component of [AiSignalsWorkspace, MobileAiSignalsScreen, AiWatchWorkspace, MobileAiWatchScreen, AiEventsWorkspace, MobileAiEventsScreen]) {
    const html = renderToStaticMarkup(React.createElement(Component, { model: emptyModel, actions: {}, actionsDisabled: false, selection: null }));
    assert.doesNotMatch(html, /data-kordyn-v2-object-id=/);
    assert.match(html, /(?:没有|暂无|Unavailable)/);
  }

  const longTail = "长内容尾部";
  const longRow = Object.freeze({ id: "signal-long", kind: "news", title: `长标题${"题".repeat(500)}`, summary: `${"证据".repeat(700)}${longTail}`, source: "newsFeed", selectable: true });
  const largeModel = Object.freeze({
    intelligence: Object.freeze([longRow, ...Array.from({ length: 59 }, (_, index) => Object.freeze({ id: `signal-large-${index}`, kind: "news", title: `事实 ${index}`, source: "newsFeed", selectable: true }))]),
    watches: Object.freeze([]), events: Object.freeze([]), missions: Object.freeze([])
  });
  for (const [Component, expectedCanonicalPresentations] of [[AiSignalsWorkspace, 120], [MobileAiSignalsScreen, 60]]) {
    const html = renderToStaticMarkup(React.createElement(Component, { model: largeModel, actions: {}, actionsDisabled: false, selection: null }));
    assert.equal((html.match(/data-kordyn-v2-object-type="Signal"/g) || []).length, expectedCanonicalPresentations);
    assert.match(html, new RegExp(longTail));
  }
});

test("AI context CSS owns responsive workbenches focus and touch targets without overflow escapes", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/ai/ai.css"), "utf8");
  assert.match(css, /\.kordynV2AiSignalWorkbench\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.kordynV2AiSignalRelations\s*\{/);
  assert.match(css, /\.kordynV2AiMobileContextFlow\s*\{/);
  assert.match(css, /\.kordynV2AiContextWorkspace[^{}]*:focus-visible|\.kordynV2AiContextWorkspace[^{}]*button:focus-visible/s);
  assert.match(css, /\.kordynV2AiMobile(?:Action|Context)[^{}]*\{[^}]*min-(?:block-size|height):\s*44px/s);
  assert.match(css, /@media\s*\([^)]*max-width:\s*1180px\)/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*430px\)/);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /overflow-x\s*:\s*(?:auto|scroll)|(?:^|[;{])\s*min-width\s*:\s*(?:[4-9]\d\d|\d{4,})px/m);
});

test("stale degraded and forbidden boundaries disable every context write while ready facts enable exact actions", () => {
  const actions = Object.freeze({
    rememberIntelligence: async () => ({ id: "memory-1" }),
    cancelWatch: async () => ({ watch: { id: "watch-eth-1", status: "cancelled" } }),
    refreshEvents: async () => ({ status: "ok" })
  });
  const cases = [
    [AiSignalsWorkspace, MobileAiSignalsScreen, { object: { id: "signal-news-1", type: "Signal" }, context: { actionsDisabled: false } }, "remember"],
    [AiWatchWorkspace, MobileAiWatchScreen, { object: { id: "watch-eth-1", type: "Watch" }, context: { actionsDisabled: false } }, "cancel-watch"],
    [AiEventsWorkspace, MobileAiEventsScreen, { object: { id: "event-fomc-1", type: "Event" }, context: { actionsDisabled: false } }, "refresh-events"]
  ];
  for (const [Desktop, Mobile, selection, actionName] of cases) {
    for (const Component of [Desktop, Mobile]) {
      const ready = renderToStaticMarkup(React.createElement(Component, { model, actions, actionsDisabled: false, selection }));
      const blocked = renderToStaticMarkup(React.createElement(Component, { model, actions, actionsDisabled: true, selection }));
      assert.match(ready, new RegExp(`data-kordyn-v2-context-action="${actionName}"`));
      assert.doesNotMatch(ready, new RegExp(`data-kordyn-v2-context-action="${actionName}"[^>]*disabled`));
      assert.match(blocked, new RegExp(`data-kordyn-v2-context-action="${actionName}"[^>]*disabled`));
    }
  }
});

test("Event refresh and date precision copy do not overclaim a market scan or exact release time", () => {
  for (const Component of [AiEventsWorkspace, MobileAiEventsScreen]) {
    const html = render(Component);
    assert.match(html, /刷新事件来源/);
    assert.match(html, /(?:官方仅确认日期|仅日期)/);
    assert.doesNotMatch(html, /刷新市场扫描|(?<!不)保证生成新的情报|情报再生成完成/);
  }
});
