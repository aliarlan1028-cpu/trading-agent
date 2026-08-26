# KORDYN V2 AI Trader Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the AI 交易员 domain as the primary Desktop and APP operating console using real missions, patrols, intelligence, watches, events, conversations, approvals, and supported output/export behavior.

**Architecture:** A pure `buildAiDomainModel()` projects existing production data and `buildPatrolView()` into mission-oriented UI language without changing object or stage truth. `createV2Actions().ai` owns the existing AI endpoints. Desktop and APP presenters share models/actions/selection but use separate workbench and full-screen/sheet compositions.

**Tech Stack:** React 18, Vite lazy domain chunk, plain scoped CSS, `html-to-image`, Node `node:test`, CDP Chrome runner.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- Preserve the program constraints in `2026-08-26-kordyn-v2-rebuild-program.md` and the stable interfaces from Plan 01.
- This plan owns exactly `ai.dialog`, `ai.autonomous-patrol`, `ai.intelligence`, `ai.watch`, `ai.events`, `ai.poster-current`, `ai.poster-translate`, and `ai.poster-png`.
- Primary UI uses product language; `Sense / Recall / Plan / Guard / Execute / Monitor / Review` appear only in Proof/Trace disclosure.
- A watch trigger causes re-analysis, not automatic order placement.
- Poster capability remains one current style, Chinese/English, and PNG export; no arbitrary style gallery or arbitrary Telegram send.
- Desktop and APP are implemented and reviewed in every task.

---

### Task 1: AI domain model and real action adapter

**Files:**
- Create: `src/kordynV2/domains/ai/aiModel.js`
- Create: `src/kordynV2/domains/ai/aiActions.js`
- Modify: `src/kordynV2/actions/createV2Actions.js`
- Create: `tests/kordyn-v2-ai-model.test.mjs`
- Create: `tests/kordyn-v2-ai-actions.test.mjs`

**Interfaces:**
- Consumes: `buildPatrolView()` from `src/patrolView.js`, `buildEventRows()` from `src/viewData.js`, production `data`, and the base `{ action, confirm, notify, download, navigate }` dependencies.
- Produces: `buildAiDomainModel(data)`, `missionStagePresentation(stage)`, and `createAiActions(deps)` under `createV2Actions().ai`.

- [ ] **Step 1: Write the failing model test**

```js
test("AI model preserves mission identity and uses product-language stages", () => {
  const model = buildAiDomainModel({
    agentRuns: [{ id: "run-1", status: "waiting_approval", stage: "guard", title: "BTC 计划复核" }],
    tradePlans: [{ id: "plan-1", agentRunId: "run-1", status: "awaiting_approval", symbol: "BTC/USDT" }]
  });
  assert.equal(model.missions[0].id, "run-1");
  assert.equal(model.missions[0].stage.label, "正在验证风险边界");
  assert.equal(model.missions[0].approval.planId, "plan-1");
  assert.doesNotMatch(model.missions[0].stage.label, /Guard|Sense|Recall/);
});

test("missing evidence remains unavailable", () => {
  const model = buildAiDomainModel({ agentRuns: [{ id: "run-1" }] });
  assert.equal(model.missions[0].evidenceCount, "Unavailable");
  assert.equal(model.missions[0].nextAction, "Unavailable");
});
```

- [ ] **Step 2: Write the failing action test**

```js
test("AI approval and rejection retain deployed endpoints", async () => {
  const calls = [];
  const ai = createAiActions({ action: async (...args) => { calls.push(args); return { ok: true }; }, confirm: async () => true });
  await ai.approvePlan("plan-1");
  await ai.rejectPlan("plan-1");
  await ai.cancelWatch("watch-1", "BTC/USDT");
  assert.deepEqual(calls, [
    ["/api/trade-plans/plan-1/approve", {}],
    ["/api/trade-plans/plan-1/cancel", { reason: "user_rejected" }],
    ["/api/watch-triggers/watch-1/cancel", {}]
  ]);
});
```

- [ ] **Step 3: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-model.test.mjs tests/kordyn-v2-ai-actions.test.mjs`

Expected: FAIL because the AI V2 modules do not exist.

- [ ] **Step 4: Implement model and actions**

Use this exact product-language map:

```js
const stagePresentation = Object.freeze({
  intent: ["正在理解任务", "working"],
  sense: ["正在检查市场", "working"],
  recall: ["正在核对相关证据", "working"],
  plan: ["正在形成下一步计划", "working"],
  guard: ["正在验证风险边界", "attention"],
  approval: ["需要你确认", "approval"],
  execute: ["正在等待权威执行结果", "working"],
  monitor: ["正在监控结果", "monitoring"],
  review: ["正在整理复盘证据", "reviewing"]
});
```

Implement actions for plan approve/reject, watch cancel, intelligence-to-memory (`/api/agent/memory`), event refresh (`/api/event-sources/refresh`), poster translation (`/api/posters/translate`), and navigation. Return raw server results.

- [ ] **Step 5: Run GREEN and existing safety regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-model.test.mjs tests/kordyn-v2-ai-actions.test.mjs tests/agent-safety.test.mjs tests/action-authorization.test.mjs tests/patrol-view.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/domains/ai/aiModel.js src/kordynV2/domains/ai/aiActions.js src/kordynV2/actions/createV2Actions.js tests/kordyn-v2-ai-model.test.mjs tests/kordyn-v2-ai-actions.test.mjs
git commit -m "feat: model KORDYN V2 AI missions"
```

### Task 2: Desktop and APP Mission Workspace

**Files:**
- Create: `src/kordynV2/domains/ai/index.jsx`
- Create: `src/kordynV2/domains/ai/AiMissionWorkspace.jsx`
- Create: `src/kordynV2/domains/ai/MobileAiMissionScreen.jsx`
- Create: `src/kordynV2/domains/ai/MissionRegistry.jsx`
- Create: `src/kordynV2/domains/ai/MissionInspector.jsx`
- Create: `src/kordynV2/domains/ai/MissionProgress.jsx`
- Create: `src/kordynV2/domains/ai/ai.css`
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Create: `tests/kordyn-v2-ai-workspace.test.mjs`

**Interfaces:**
- Consumes: `buildAiDomainModel()`, `actions.ai`, shell selection, `device`, and `location.workspaceId === "missions"`.
- Produces: a lazy AI domain module and canonical Mission/Plan selection callbacks.

- [ ] **Step 1: Write the failing workbench contract**

```js
test("mission workspaces expose the same objects with device-specific composition", () => {
  const desktop = renderToStaticMarkup(<AiMissionWorkspace model={model} actions={actions} selection={selection} onSelect={() => {}} />);
  const mobile = renderToStaticMarkup(<MobileAiMissionScreen model={model} actions={actions} selection={selection} onSelect={() => {}} />);
  for (const html of [desktop, mobile]) {
    assert.match(html, /data-kordyn-v2-object-id="run-1"/);
    assert.match(html, /正在验证风险边界/);
    assert.match(html, /需要你确认/);
  }
  assert.match(desktop, /data-kordyn-v2-layout="mission-registry-inspector"/);
  assert.match(mobile, /data-kordyn-v2-layout="mission-task-flow"/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-workspace.test.mjs`

Expected: FAIL because the mission presenters do not exist.

- [ ] **Step 3: Implement the approved compositions**

Desktop matches `desktop-ai-mission-control.png`: mission registry, dominant active mission, evidence/progress relationship, bounded action area, Full Truth Bar, and restrained auxiliary information. APP matches `mobile-ai-mission-home.png`: current mission first, concise truth, attention queue, then drill-down; it must not stack the Desktop registry and inspector.

Every mission row calls:

```js
onSelect({ id: mission.id, type: "Agent run", workspaceId: "ai", route: "chat", evidence: mission.evidenceLabel });
```

- [ ] **Step 4: Run GREEN and route chunk check**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-workspace.test.mjs tests/kordyn-v2-shell.test.mjs && npm run build`

Expected: PASS; the AI domain is a lazy chunk and `ai.css` is not in the public/auth entry.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/ai src/kordynV2/KordynV2Root.jsx tests/kordyn-v2-ai-workspace.test.mjs
git commit -m "feat: build V2 AI mission workspaces"
```

### Task 3: Intelligence, Watch, and Event Calendar workspaces

**Files:**
- Create: `src/kordynV2/domains/ai/AiSignalsWorkspace.jsx`
- Create: `src/kordynV2/domains/ai/AiWatchWorkspace.jsx`
- Create: `src/kordynV2/domains/ai/AiEventsWorkspace.jsx`
- Create: `src/kordynV2/domains/ai/MobileAiSignalsScreen.jsx`
- Create: `src/kordynV2/domains/ai/MobileAiWatchScreen.jsx`
- Create: `src/kordynV2/domains/ai/MobileAiEventsScreen.jsx`
- Modify: `src/kordynV2/domains/ai/index.jsx`
- Modify: `src/kordynV2/domains/ai/ai.css`
- Create: `tests/kordyn-v2-ai-context-workspaces.test.mjs`

**Interfaces:**
- Consumes: `model.intelligence`, `model.watches`, `model.events`, `actions.ai.rememberIntelligence()`, `actions.ai.cancelWatch()`, and `actions.ai.refreshEvents()`.
- Produces: canonical Signal, Watch, and Event selection in both device layouts.

- [ ] **Step 1: Write failing object and behavior tests**

```js
test("AI context workspaces preserve object identity and boundaries", () => {
  const signals = renderToStaticMarkup(<AiSignalsWorkspace model={model} actions={actions} onSelect={select} />);
  const watch = renderToStaticMarkup(<AiWatchWorkspace model={model} actions={actions} onSelect={select} />);
  const events = renderToStaticMarkup(<AiEventsWorkspace model={model} actions={actions} onSelect={select} />);
  assert.match(signals, /data-kordyn-v2-object-type="Signal"/);
  assert.match(watch, /命中后重新分析|re-analyze/i);
  assert.doesNotMatch(watch, /命中后自动下单|auto.?order/i);
  assert.match(events, /data-kordyn-v2-object-type="Event"/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-context-workspaces.test.mjs`

Expected: FAIL on missing components.

- [ ] **Step 3: Implement Desktop signal depth and mobile task-led drill-down**

Desktop matches `desktop-ai-signals.png`: signal/evidence hierarchy, selected-object inspector, watch state, and calendar relationship within the same visual grammar. Mobile uses a list/detail flow with source/freshness disclosure and explicit “加入 AI 上下文” or “撤销观察哨” actions where production permits them.

- [ ] **Step 4: Run GREEN and focused source/watch tests**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-context-workspaces.test.mjs tests/market-intelligence.test.mjs tests/watch-sentinel.test.mjs tests/official-calendar.test.mjs tests/event-source-config.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/ai tests/kordyn-v2-ai-context-workspaces.test.mjs
git commit -m "feat: add V2 AI signals watches and events"
```

### Task 4: Conversation, approval, and supported output flow

**Files:**
- Create: `src/kordynV2/domains/ai/AiDialogWorkspace.jsx`
- Create: `src/kordynV2/domains/ai/AiApprovalSheet.jsx`
- Create: `src/kordynV2/domains/ai/AiOutputSheet.jsx`
- Create: `src/kordynV2/domains/ai/PosterCanvas.jsx`
- Create: `src/kordynV2/domains/ai/MobileAiDialogScreen.jsx`
- Modify: `src/kordynV2/domains/ai/index.jsx`
- Modify: `src/kordynV2/domains/ai/ai.css`
- Create: `tests/kordyn-v2-ai-actions-ui.test.mjs`

**Interfaces:**
- Consumes: real chat messages/sessions, plan approval state, `actions.ai.approvePlan()`, `rejectPlan()`, `translatePoster()`, and the existing `html-to-image` dependency.
- Produces: one conversation workspace, one protected one-shot approval flow, and one current-style bilingual PNG output flow.

- [ ] **Step 1: Write the failing reality-boundary test**

```js
test("AI output UI exposes only deployed output capabilities", () => {
  const html = renderToStaticMarkup(<AiOutputSheet message={message} actions={actions} onClose={() => {}} />);
  assert.match(html, /中文/);
  assert.match(html, /English/);
  assert.match(html, /PNG/);
  assert.doesNotMatch(html, /模板库|风格选择|Telegram.*发送|PDF|SVG/i);
});

test("approval UI does not claim success before the server result", () => {
  const html = renderToStaticMarkup(<AiApprovalSheet plan={plan} outcome={null} actions={actions} />);
  assert.match(html, /需要你确认/);
  assert.doesNotMatch(html, /已执行|Success/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-actions-ui.test.mjs`

Expected: FAIL on missing V2 approval/output components.

- [ ] **Step 3: Implement the real flows**

APP approval matches `mobile-ai-task-approval.png`: show plan facts, evidence, risk result, authorization boundary, then approve/reject; the primary action remains disabled whenever the production model says approval is invalid. Poster translation calls `/api/posters/translate`; PNG export waits for `document.fonts.ready`, calls `toPng()` on the V2 `PosterCanvas`, and downloads only after successful image generation.

- [ ] **Step 4: Run GREEN and real authorization/poster regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-actions-ui.test.mjs tests/action-authorization.test.mjs tests/trade-plan-lifecycle.test.mjs tests/closed-trade-poster.test.mjs tests/poster-routes.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/ai tests/kordyn-v2-ai-actions-ui.test.mjs
git commit -m "feat: add V2 AI conversation approval and output"
```

### Task 5: AI real-state, browser, capability, and visual gates

**Files:**
- Create: `tests/kordyn-v2-ai-browser.html`
- Create: `tests/kordyn-v2-ai-browser.jsx`
- Create: `tests/run-kordyn-v2-ai-browser.mjs`
- Create: `tests/kordyn-v2-ai-states.test.mjs`
- Create: `src/kordynV2/domains/ai/capabilitySurfaces.js`
- Create: `src/kordynV2/domains/ai/stateSurfaces.js`
- Modify: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: actual V2 AI components, the shared production-shaped fixture, approved AI concepts, and the shared comparison script.
- Produces: `AI_CAPABILITY_SURFACES`, `AI_STATE_SURFACES`, real-click evidence, state evidence, four-viewport screenshots, overlays, and an 8/8 capability report.

- [ ] **Step 1: Write the failing state and capability gate**

```js
test("AI domain owns and renders all eight registered capabilities", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => row.id.startsWith("ai.")).map((row) => row.id);
  assert.deepEqual(ids, ["ai.dialog", "ai.autonomous-patrol", "ai.intelligence", "ai.watch", "ai.events", "ai.poster-current", "ai.poster-translate", "ai.poster-png"]);
  for (const id of ids) assert.ok(AI_CAPABILITY_SURFACES[id], id);
});

for (const state of ["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"]) {
  test(`AI renders ${state} without falsifying data`, () => {
    const renderState = AI_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    assertStateContract(renderState(aiStateFixture), state);
  });
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-states.test.mjs`

Expected: FAIL because the state/capability registry is absent.

- [ ] **Step 3: Add the browser interaction path**

The runner must click Mission, Signal, Watch, Event, Plan approval, conversation, and output objects through actual rendered components; after each selection, assert root `data-kordyn-v2-selected-id`, Context identity, and Proof identity match. It must execute an approval with a stubbed authoritative response, prove no optimistic success before the response, and prove failure/partial outcomes remain visible.

- [ ] **Step 4: Capture and compare all approved AI concepts**

Run:

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-model.test.mjs tests/kordyn-v2-ai-actions.test.mjs tests/kordyn-v2-ai-workspace.test.mjs tests/kordyn-v2-ai-context-workspaces.test.mjs tests/kordyn-v2-ai-actions-ui.test.mjs tests/kordyn-v2-ai-states.test.mjs
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/ai node tests/run-kordyn-v2-ai-browser.mjs
node scripts/compare-kordyn-v2-concepts.mjs --screenshots .impeccable/review/kordyn-v2/ai --output .impeccable/review/kordyn-v2/ai-compare --scope ai
node tests/run-kordyn-v2-performance-build.mjs
git diff --check
```

Expected: all commands exit `0`; comparisons include Desktop mission/signals and APP mission/approval at both APP widths.

- [ ] **Step 5: Review and commit**

Open all AI screenshots and region comparisons. Record remaining differences and the 8/8 capability paths in `docs/kordyn-v2-evidence.md`. Critical or material comp mismatch blocks the commit.

```bash
git add src/kordynV2/domains/ai/capabilitySurfaces.js src/kordynV2/domains/ai/stateSurfaces.js tests/kordyn-v2-ai-browser.html tests/kordyn-v2-ai-browser.jsx tests/run-kordyn-v2-ai-browser.mjs tests/kordyn-v2-ai-states.test.mjs docs/kordyn-v2-evidence.md .impeccable/review/kordyn-v2/ai .impeccable/review/kordyn-v2/ai-compare
git commit -m "test: verify KORDYN V2 AI domain"
```
