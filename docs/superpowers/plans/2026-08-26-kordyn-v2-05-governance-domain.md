# KORDYN V2 System Governance Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement one governed Desktop and APP domain for effective boundaries, runtime health, tasks/runs, event inputs, notifications, audit, recovery, and all durable configuration.

**Architecture:** Governance composes existing risk/control, operations, and configuration data into one domain while keeping runtime truth and editable intent separate. Current/effective workspaces are read-only except deployed operational actions; durable mutations live only in Configuration and retain current RBAC, validation, confirmation, audit, and authoritative outcomes.

**Tech Stack:** React 18, Vite lazy domain chunk, plain scoped CSS, Node `node:test`, CDP Chrome runner.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- Preserve program constraints and Plan 01 interfaces.
- This plan owns `control.*` (6), `operations.*` (8), and `configuration.*` (15): exactly 29 capabilities.
- `运行总览` shows effective state; it does not edit durable mode, mandate, or rules.
- `配置` is the only home for durable edits and always distinguishes selected/desired from effective/current.
- System-managed task definitions remain read-only; only deployed run/pause/resume behavior is exposed.
- Kill Switch, Flatten, reconcile, scheduler recovery, mandate/rule/security changes, and other protected actions remain authoritative and fail closed.
- Desktop and APP are implemented together in each task.

---

### Task 1: Governance model, selected/effective truth, and action adapter

**Files:**
- Create: `src/kordynV2/domains/governance/governanceModel.js`
- Create: `src/kordynV2/domains/governance/configurationModel.js`
- Create: `src/kordynV2/domains/governance/governanceActions.js`
- Modify: `src/kordynV2/actions/createV2Actions.js`
- Create: `tests/kordyn-v2-governance-model.test.mjs`
- Create: `tests/kordyn-v2-governance-actions.test.mjs`

**Interfaces:**
- Consumes: `buildControlConfigurationView()`, `buildOperationsView()`, event-risk helpers, production `data`, and base action dependencies.
- Produces: `buildGovernanceDomainModel(data)`, `buildConfigurationModel(data)`, and `createGovernanceActions(deps)` under `createV2Actions().governance`.

- [ ] **Step 1: Write failing selected/effective tests**

```js
test("governance never collapses desired and effective mode", () => {
  const model = buildGovernanceDomainModel({ system: { executionMode: "auto", effectiveMode: "observe", killSwitch: true } });
  assert.equal(model.boundary.selectedMode, "auto");
  assert.equal(model.boundary.effectiveMode, "observe");
  assert.equal(model.boundary.killSwitch, true);
});

test("missing supplemental operations facts remain unavailable", () => {
  const model = buildConfigurationModel({ resourceState: { operationsCenter: "not_loaded" } });
  assert.equal(model.audit.kind, "not_loaded");
  assert.equal(model.audit.total, "Unavailable");
});
```

- [ ] **Step 2: Write failing action tests**

```js
test("operational actions retain deployed endpoints", async () => {
  const calls = [];
  const governance = createGovernanceActions({ action: async (...args) => { calls.push(args); return { ok: true }; }, confirm: async () => true });
  await governance.runTask("task-1");
  await governance.pauseTask("task-1");
  await governance.markNotificationsRead();
  assert.deepEqual(calls, [
    ["/api/tasks/task-1/run", {}],
    ["/api/tasks/task-1/pause", { reason: "manual_ui" }],
    ["/api/notifications/read", {}]
  ]);
});
```

- [ ] **Step 3: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-governance-model.test.mjs tests/kordyn-v2-governance-actions.test.mjs`

Expected: FAIL with missing governance modules.

- [ ] **Step 4: Implement models and explicit actions**

Expose task run/pause/resume, notification read, reconcile, scheduler recover, risk-incident resolve, event-source refresh/test/enable/delete, config save, mandate save/activate, risk-rule create/update, backup, secret clear, exchange metadata confirmation, notification tests, agent profile update, user/RBAC update, subscription grant, and registration actions using the endpoints already present in `src/conceptPages.jsx` and `src/panels.jsx`. Every destructive or protected action calls `confirm` first and returns the server result unchanged.

- [ ] **Step 5: Run GREEN and risk/operations/config regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-governance-model.test.mjs tests/kordyn-v2-governance-actions.test.mjs tests/control-configuration-view.test.mjs tests/operations-view.test.mjs tests/action-authorization.test.mjs tests/permissions.test.mjs tests/rbac-route-matrix.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/domains/governance/governanceModel.js src/kordynV2/domains/governance/configurationModel.js src/kordynV2/domains/governance/governanceActions.js src/kordynV2/actions/createV2Actions.js tests/kordyn-v2-governance-model.test.mjs tests/kordyn-v2-governance-actions.test.mjs
git commit -m "feat: model V2 system governance"
```

### Task 2: Effective boundary and event-input workspaces

**Files:**
- Create: `src/kordynV2/domains/governance/index.jsx`
- Create: `src/kordynV2/domains/governance/BoundaryWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/ReadinessChain.jsx`
- Create: `src/kordynV2/domains/governance/RuleMonitor.jsx`
- Create: `src/kordynV2/domains/governance/EventInputWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/EventRiskRegistry.jsx`
- Create: `src/kordynV2/domains/governance/MobileBoundaryScreen.jsx`
- Create: `src/kordynV2/domains/governance/MobileEventInputScreen.jsx`
- Create: `src/kordynV2/domains/governance/governance.css`
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Create: `tests/kordyn-v2-boundary-workspaces.test.mjs`

**Interfaces:**
- Consumes: effective runtime/mode/mandate/rules/readiness chain, event-risk windows, source health, and navigation to Configuration.
- Produces: read-only Mandate/Rule/Event risk canonical selection and deep links to authoritative editors.

- [ ] **Step 1: Write the failing read-only boundary test**

```js
test("effective boundary is read-only and links to configuration", () => {
  const html = renderToStaticMarkup(<BoundaryWorkspace model={model} onNavigate={() => {}} onSelect={() => {}} />);
  assert.match(html, /当前生效|Effective now/);
  assert.match(html, /data-kordyn-v2-navigate="governance:configuration"/);
  assert.doesNotMatch(html, /<input|<select|data-kordyn-v2-action="save"/);
});

test("event input keeps source health and event window distinct", () => {
  const html = renderToStaticMarkup(<EventInputWorkspace model={model} onSelect={() => {}} />);
  assert.match(html, /data-kordyn-v2-object-type="Event"/);
  assert.match(html, /data-kordyn-v2-object-type="Event source"/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-boundary-workspaces.test.mjs`

Expected: FAIL on missing governance presenters.

- [ ] **Step 3: Reproduce approved boundary and event-risk compositions**

Desktop matches `desktop-governance-boundary.png`: Critical-only truth, effective mode/risk, readiness chain, permission boundary, deterministic rule monitor, and recovery route. Event input inherits the same grammar and keeps source health, event window, affected assets, and blocking state distinct. APP uses four local governance destinations only where the approved mobile concept shows them; deeper configuration remains a flow, not duplicate bottom navigation.

- [ ] **Step 4: Run GREEN and event/risk regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-boundary-workspaces.test.mjs tests/current-risk-snapshot.test.mjs tests/event-risk-window.test.mjs tests/dynamic-risk-rules.test.mjs tests/mandate-lifecycle.test.mjs tests/risk-reducing-guard.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/governance src/kordynV2/KordynV2Root.jsx tests/kordyn-v2-boundary-workspaces.test.mjs
git commit -m "feat: build V2 operating boundary workspaces"
```

### Task 3: Operations, tasks/runs, notifications, audit, and recovery

**Files:**
- Create: `src/kordynV2/domains/governance/OperationsWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/TaskRunWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/NotificationWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/AuditWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/RecoveryWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/MobileOperationsScreen.jsx`
- Create: `src/kordynV2/domains/governance/MobileTaskRunScreen.jsx`
- Create: `src/kordynV2/domains/governance/MobileNotificationScreen.jsx`
- Create: `src/kordynV2/domains/governance/MobileAuditScreen.jsx`
- Create: `src/kordynV2/domains/governance/MobileRecoveryScreen.jsx`
- Modify: `src/kordynV2/domains/governance/index.jsx`
- Modify: `src/kordynV2/domains/governance/governance.css`
- Create: `tests/kordyn-v2-operations-workspaces.test.mjs`

**Interfaces:**
- Consumes: runtime topology, task/run ledger, notification records, immutable audit, reconciliation/recovery evidence, and operational actions.
- Produces: Task/Agent run/Notification/Audit log/Risk incident/Recovery canonical selection.

- [ ] **Step 1: Write the failing operations-truth test**

```js
test("system-managed ownership is not presented as runtime health", () => {
  const html = renderToStaticMarkup(<TaskRunWorkspace model={{ tasks: [{ id: "t-1", systemManaged: true, runtime: { code: "failed" } }] }} actions={actions} onSelect={() => {}} />);
  assert.match(html, /系统托管|System-managed/);
  assert.match(html, /失败|Failed/);
  assert.doesNotMatch(html, /系统托管[^<]*(正常|Healthy)/);
});

test("audit records are immutable in the UI", () => {
  const source = readFileSync(new URL("../src/kordynV2/domains/governance/AuditWorkspace.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /delete|edit|save|\/api\//i);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-operations-workspaces.test.mjs`

Expected: FAIL on missing operations components.

- [ ] **Step 3: Reproduce the approved operations composition**

Desktop matches `desktop-governance-operations.png`: runtime topology/current truth, causally ordered tasks/runs, input health, notification/audit evidence, and recovery actions. APP matches `mobile-system-governance.png` when AI 客服 is open, while the underlying governance screen remains operational and the support sheet remains read-only.

- [ ] **Step 4: Run GREEN and operations/recovery regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-operations-workspaces.test.mjs tests/operations-view.test.mjs tests/task-routes.test.mjs tests/notification-read-state.test.mjs tests/audit-continuity.test.mjs tests/reconciler-stop-coverage.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/governance tests/kordyn-v2-operations-workspaces.test.mjs
git commit -m "feat: build V2 operations and recovery workspaces"
```

### Task 4: Centralized Configuration on Desktop and APP

**Files:**
- Create: `src/kordynV2/domains/governance/ConfigurationWorkspace.jsx`
- Create: `src/kordynV2/domains/governance/ConfigurationRegistry.jsx`
- Create: `src/kordynV2/domains/governance/ConfigurationInspector.jsx`
- Create: `src/kordynV2/domains/governance/configuration/TradingRuntimeEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/RiskRuleEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/EnvironmentEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/NetworkEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/BackupEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/SecurityEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/ExchangeEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/EventSourceEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/NotificationEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/ModelEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/AgentEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/UserSubscriptionEditor.jsx`
- Create: `src/kordynV2/domains/governance/configuration/AccountProfileEditor.jsx`
- Create: `src/kordynV2/domains/governance/MobileConfigurationScreen.jsx`
- Modify: `src/kordynV2/domains/governance/index.jsx`
- Modify: `src/kordynV2/domains/governance/governance.css`
- Create: `tests/kordyn-v2-configuration-workspace.test.mjs`

**Interfaces:**
- Consumes: `buildConfigurationModel()`, Owner/RBAC results, selected/effective values, masked credential facts, preflight results, audit state, and governance actions.
- Produces: one configuration registry and scope-first Desktop/APP editor flows for all 15 configuration capabilities.

- [ ] **Step 1: Write the failing centralized-editor test**

```js
test("all persistent editors live under governance configuration", () => {
  const html = renderToStaticMarkup(<ConfigurationWorkspace model={model} actions={actions} location={{ domainId: "governance", workspaceId: "configuration" }} />);
  for (const id of ["trading", "risk", "environment", "network", "backup", "security", "exchange", "event-sources", "notifications", "models", "agents", "users", "account"]) {
    assert.match(html, new RegExp(`data-kordyn-v2-config-target="${id}"`));
  }
});

test("selected and effective values never share one unlabeled field", () => {
  const html = renderToStaticMarkup(<TradingRuntimeEditor model={{ selectedMode: "auto", effectiveMode: "observe" }} actions={actions} />);
  assert.match(html, /保存目标|Selected target/);
  assert.match(html, /当前生效|Effective now/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-configuration-workspace.test.mjs`

Expected: FAIL on missing configuration components.

- [ ] **Step 3: Reproduce the approved configuration registry and editors**

Match `desktop-governance-configuration.png`: configuration registry, selected scope, current/effective facts, permission, audit, and bounded save/preflight areas. APP uses registry → scope → editor → confirm → authoritative result, never a single endless settings card stack. Secrets remain masked and are never copied into fixtures or DOM attributes.

- [ ] **Step 4: Run GREEN and configuration/security regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-configuration-workspace.test.mjs tests/live-mode-save.test.mjs tests/mandate-routes-safety.test.mjs tests/risk-rule-routes.test.mjs tests/event-source-config.test.mjs tests/secret-redaction.test.mjs tests/subscription-lifecycle.test.mjs tests/totp.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/governance tests/kordyn-v2-configuration-workspace.test.mjs
git commit -m "feat: centralize V2 governed configuration"
```

### Task 5: Governance real-state, browser, capability, and visual gates

**Files:**
- Create: `tests/kordyn-v2-governance-browser.html`
- Create: `tests/kordyn-v2-governance-browser.jsx`
- Create: `tests/run-kordyn-v2-governance-browser.mjs`
- Create: `tests/kordyn-v2-governance-states.test.mjs`
- Create: `src/kordynV2/domains/governance/capabilitySurfaces.js`
- Create: `src/kordynV2/domains/governance/stateSurfaces.js`
- Modify: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: actual governance components, shared fixture, approved governance concepts, and comparison script.
- Produces: `GOVERNANCE_CAPABILITY_SURFACES`, `GOVERNANCE_STATE_SURFACES`, 29/29 capability evidence, real action/selection/state evidence, and four concept comparison sets.

- [ ] **Step 1: Write the failing capability/state gate**

```js
test("governance owns all control operations and configuration capabilities", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => /^(control|operations|configuration)\./.test(row.id)).map((row) => row.id);
  assert.equal(ids.length, 29);
  for (const id of ids) assert.ok(GOVERNANCE_CAPABILITY_SURFACES[id], id);
});
```

Add this explicit 13-state gate. Its fixtures include stale/degraded last-valid runtime facts, failed event sources, forbidden configuration, disabled system-managed task controls, partial recovery, no-result audit filter, long raw context, and large registries.

```js
for (const state of ["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"]) {
  test(`governance renders ${state} truthfully`, () => {
    const renderState = GOVERNANCE_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    assertStateContract(renderState(governanceStateFixture), state);
  });
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-governance-states.test.mjs`

Expected: FAIL because governance capability/state registration is absent.

- [ ] **Step 3: Build real component action and selection coverage**

Click Event, Mandate, Risk incident, Task, Agent run, Notification, Audit log, Recovery, and configuration records. Assert root selection plus Context/Proof identity after each. Click all APP governance local destinations at both widths and assert one active destination, correct content, no duplicate inner navigation, and no overflow. Exercise task run, notification acknowledge, reconcile, scheduler recovery, and a configuration save with pending/failure/partial/success authoritative outcomes.

- [ ] **Step 4: Capture, compare, and run verification**

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-governance-model.test.mjs tests/kordyn-v2-governance-actions.test.mjs tests/kordyn-v2-boundary-workspaces.test.mjs tests/kordyn-v2-operations-workspaces.test.mjs tests/kordyn-v2-configuration-workspace.test.mjs tests/kordyn-v2-governance-states.test.mjs
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/governance node tests/run-kordyn-v2-governance-browser.mjs
node scripts/compare-kordyn-v2-concepts.mjs --screenshots .impeccable/review/kordyn-v2/governance --output .impeccable/review/kordyn-v2/governance-compare --scope governance
node tests/run-kordyn-v2-performance-build.mjs
git diff --check
```

Expected: all commands exit `0`; comparisons cover Desktop boundary/operations/configuration and APP governance with open read-only AI support.

- [ ] **Step 5: Review and commit**

Open all governance comparisons and record the 29/29 capability paths, selected/effective evidence, state behavior, and remaining differences in `docs/kordyn-v2-evidence.md`.

```bash
git add src/kordynV2/domains/governance/capabilitySurfaces.js src/kordynV2/domains/governance/stateSurfaces.js tests/kordyn-v2-governance-browser.html tests/kordyn-v2-governance-browser.jsx tests/run-kordyn-v2-governance-browser.mjs tests/kordyn-v2-governance-states.test.mjs docs/kordyn-v2-evidence.md .impeccable/review/kordyn-v2/governance .impeccable/review/kordyn-v2/governance-compare
git commit -m "test: verify KORDYN V2 system governance"
```
