# Kordyn Interactive Operating System Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file, directly openable, interactive Kordyn operating-system prototype that preserves the full product capability set while replacing the legacy page/card structure with task workspaces, object dossiers, a shared Context Dock, and a shared Trace Rail.

**Architecture:** `prototypes/kordyn-operating-system.html` contains semantic HTML, a centralized CSS design system, static demo datasets, render functions, and delegated interaction handlers. `tests/kordynPrototype.test.mjs` uses Node Test and Cheerio to enforce the information-architecture contract, required business surfaces, action wiring, safety copy, responsive rules, and the absence of dead controls; visual and runtime behavior are then verified in the in-app browser.

**Tech Stack:** HTML5, CSS3, inline SVG, vanilla JavaScript, Node.js Test Runner, Cheerio, in-app browser inspection.

**Spec:** `docs/superpowers/specs/2026-08-21-kordyn-interactive-operating-system-prototype-design.md`

## Global Constraints

- Deliver one directly openable file at `prototypes/kordyn-operating-system.html`; do not add runtime dependencies.
- Do not connect to a backend, exchange, model, account, authentication service, or real configuration store.
- Label every simulated mutation and dangerous action with `DEMO / NO LIVE ACTION`.
- Preserve all functions assigned to Command, Live Desk, Lab, Control, Run Control, and Administration in the spec.
- Use `#F4F1E9`, `#111311`, `#111511`, `#CCFF3D`, `#4FB78B`, and `#E25645` for the defined semantic roles.
- Do not copy the reference site's brand assets, logo, marketing copy, or page composition.
- Do not use ordinary rounded SaaS cards, decorative gradients, or pervasive shadows.
- Desktop acceptance viewport is 1440×900; narrow-screen acceptance viewport is 390×844.
- Status must use text or symbols in addition to color.
- Owner-only functions remain visible to Trader with a lock and permission explanation.
- Keep all demo datasets centralized in JavaScript and update surfaces through render functions rather than action-specific HTML strings.

---

### Task 1: Establish the prototype contract and global shell

**Files:**
- Create: `tests/kordynPrototype.test.mjs`
- Create: `prototypes/kordyn-operating-system.html`

**Interfaces:**
- Consumes: The six workspace names and shared-surface requirements from the spec.
- Produces: `state`, `demoData`, `renderApp()`, `[data-workspace]`, `#context-dock`, `#trace-rail`, `#object-switcher`, `#modal-root`, and a delegated `[data-action]` interaction contract.

- [ ] **Step 1: Write the failing shell contract test**

```js
// tests/kordynPrototype.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';

const prototypePath = new URL('../prototypes/kordyn-operating-system.html', import.meta.url);
const readPrototype = () => readFileSync(prototypePath, 'utf8');
const parsePrototype = () => load(readPrototype());

test('global shell exposes every task workspace and shared surface', () => {
  const $ = parsePrototype();
  const workspaces = $('[data-workspace]').map((_, el) => $(el).attr('data-workspace')).get();
  assert.deepEqual(workspaces, ['command', 'live', 'lab', 'control', 'run', 'admin']);
  assert.equal($('#context-dock').length, 1);
  assert.equal($('#trace-rail').length, 1);
  assert.equal($('#object-switcher').length, 1);
  assert.equal($('#modal-root').length, 1);
  assert.match($('body').text(), /DEMO \/ NO LIVE ACTION/);
});
```

- [ ] **Step 2: Run the test to verify it fails because the prototype is absent**

Run: `node --test tests/kordynPrototype.test.mjs`

Expected: FAIL with `ENOENT` for `prototypes/kordyn-operating-system.html`.

- [ ] **Step 3: Implement the semantic shell, base tokens, and persistent regions**

Create the HTML with this top-level contract:

```html
<body data-role="owner" data-mode="demo">
  <div class="demo-ribbon">DEMO / NO LIVE ACTION</div>
  <header class="command-rail">...</header>
  <div class="operating-shell">
    <nav class="workspace-rail" aria-label="任务空间">
      <button data-workspace="command" data-action="switch-workspace">...</button>
      <button data-workspace="live" data-action="switch-workspace">...</button>
      <button data-workspace="lab" data-action="switch-workspace">...</button>
      <button data-workspace="control" data-action="switch-workspace">...</button>
      <button data-workspace="run" data-action="switch-workspace">...</button>
      <button data-workspace="admin" data-action="switch-workspace">...</button>
    </nav>
    <main id="workspace" tabindex="-1"></main>
    <aside id="context-dock" aria-label="上下文检查器"></aside>
  </div>
  <section id="trace-rail" aria-label="交易事实链"></section>
  <dialog id="object-switcher"></dialog>
  <div id="modal-root"></div>
</body>
```

Define the visual tokens and hard-edged system rules in one `:root` block. Initialize shared state and data with stable names:

```js
const state = {
  workspace: 'command', localMode: 'feed', role: 'owner', market: 'BTC/USDT',
  timeframe: '1H', selectedId: 'intel-fed', contextTab: 'evidence', traceStage: 'plan',
  contextOpen: true, traceOpen: true, systemMode: 'healthy', modal: null
};

const demoData = { intelligence: [], watches: [], plans: [], positions: [], orders: [], fills: [], knowledge: [], strategies: [], validations: [], reviews: [], optimizations: [], capabilities: [], mandates: [], policies: [], incidents: [], agents: [], runs: [], events: [], audit: [] };
const renderApp = () => {};
```

- [ ] **Step 4: Run the shell test and confirm it passes**

Run: `node --test tests/kordynPrototype.test.mjs`

Expected: PASS for `global shell exposes every task workspace and shared surface`.

- [ ] **Step 5: Commit the shell and contract**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "feat: scaffold Kordyn operating system prototype"
```

### Task 2: Build Command as a queue-driven decision workbench

**Files:**
- Modify: `tests/kordynPrototype.test.mjs`
- Modify: `prototypes/kordyn-operating-system.html`

**Interfaces:**
- Consumes: `state.localMode`, `state.selectedId`, `demoData.intelligence`, `demoData.watches`, and `demoData.plans`.
- Produces: `renderCommand()`, `renderDecisionDossier(object)`, `renderContextDock(object)`, and actions `select-object`, `create-watch`, `review-now`, `qualify-plan`, `approve-plan`, `toggle-watch`, and `send-command`.

- [ ] **Step 1: Add a failing Command completeness test**

```js
test('Command contains feed, watch, decide, dossier, evidence, and action contracts', () => {
  const $ = parsePrototype();
  for (const mode of ['feed', 'watch', 'decide']) {
    assert.equal($(`[data-command-mode="${mode}"]`).length, 1, `missing ${mode}`);
  }
  for (const action of ['create-watch', 'review-now', 'qualify-plan', 'approve-plan', 'send-command']) {
    assert.ok(readPrototype().includes(`data-action="${action}"`), `missing ${action}`);
  }
  assert.match(readPrototype(), /renderCommand/);
  assert.match(readPrototype(), /renderDecisionDossier/);
  assert.match(readPrototype(), /Candidate Signal|候选信号/);
  assert.match(readPrototype(), /数据新鲜度|Freshness/);
});
```

- [ ] **Step 2: Run the test and verify it fails on missing Command modes**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Command"`

Expected: FAIL with `missing feed`.

- [ ] **Step 3: Implement centralized demo objects and Command rendering**

Populate representative intelligence, watch, and plan objects with stable IDs and explicit provenance:

```js
demoData.intelligence = [
  { id:'intel-fed', kind:'MACRO', title:'美联储会议窗口临近', market:'BTC/USDT', impact:'不确定', source:'Official calendar', freshness:'2m', confidence:'verified' },
  { id:'intel-oi', kind:'MARKET', title:'BTC OI 30 分钟上升 7.8%', market:'BTC/USDT', impact:'拥挤风险', source:'OKX market data', freshness:'18s', confidence:'live' }
];
demoData.watches = [
  { id:'watch-btc', title:'BTC 突破回踩确认', market:'BTC/USDT', status:'watching', proximity:82, next:'1H 收线', conditions:['收盘 > 64,920','成交量确认','资金费率 < 0.03%'] }
];
demoData.plans = [
  { id:'plan-btc', title:'BTC/USDT · CONDITIONAL LONG', status:'review', entry:'64,920–65,050', stop:'64,260', targets:['66,200','67,050'], risk:'0.30%', leverage:'≤ 2×', evidence:'12 / 15' }
];
```

Build the Command DOM as a queue column, central dossier, and shared Context Dock. Use a black `decision-dossier` panel with an acid left rule and keep the command input at the bottom. Render facts, inference, recommendation, and pending action as separate labeled blocks.

- [ ] **Step 4: Implement Command state transitions through delegated actions**

Use one document click handler and pure state updates:

```js
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const { action, id, mode } = trigger.dataset;
  if (action === 'select-object') state.selectedId = id;
  if (action === 'switch-command-mode') state.localMode = mode;
  if (action === 'toggle-watch') {
    const watch = demoData.watches.find(item => item.id === id);
    watch.status = watch.status === 'paused' ? 'watching' : 'paused';
  }
  if (action === 'review-now') state.selectedId = 'plan-btc';
  if (action === 'qualify-plan') demoData.plans[0].status = 'qualified';
  if (action === 'approve-plan') openSafetyModal('approve-plan');
  renderApp();
});
```

The create-watch modal must add a visible demo watch object; the approve-plan modal must show evidence, risk, mandate, and `DEMO / NO LIVE ACTION` before updating the plan to `approved-demo`.

- [ ] **Step 5: Run the Command contract tests**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Command"`

Expected: PASS.

- [ ] **Step 6: Commit the Command workbench**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "feat: add Command decision workbench"
```

### Task 3: Build the integrated Live Desk and execution ledger

**Files:**
- Modify: `tests/kordynPrototype.test.mjs`
- Modify: `prototypes/kordyn-operating-system.html`

**Interfaces:**
- Consumes: `state.market`, `state.timeframe`, `demoData.plans`, `demoData.positions`, `demoData.orders`, and `demoData.fills`.
- Produces: `renderLiveDesk()`, `renderMarketSvg(market, timeframe)`, `renderPlanLadder(plan)`, `renderLedger(mode)`, and actions `select-market`, `select-timeframe`, `switch-ledger`, `edit-order`, `cancel-order`, `open-position`, and `stage-order`.

- [ ] **Step 1: Add a failing Live Desk business-surface test**

```js
test('Live Desk integrates market, plans, exposure, positions, orders, fills, protection, and trace', () => {
  const html = readPrototype();
  const $ = parsePrototype();
  for (const ledger of ['positions', 'orders', 'fills', 'protection', 'trace']) {
    assert.equal($(`[data-ledger-mode="${ledger}"]`).length, 1, `missing ledger ${ledger}`);
  }
  assert.equal($('#market-canvas').length, 1);
  assert.equal($('#plan-ladder').length, 1);
  assert.equal($('#exposure-rail').length, 1);
  assert.match(html, /Risk Preflight/);
  assert.match(html, /停止 Agent 不等于平仓/);
  assert.match(html, /renderMarketSvg/);
});
```

- [ ] **Step 2: Run the Live Desk test and verify it fails**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Live Desk"`

Expected: FAIL on missing ledger elements.

- [ ] **Step 3: Implement market data, inline SVG, Plan Ladder, and Exposure Rail**

Define BTC and ETH demo series as arrays of numeric points. Generate the chart with inline SVG paths plus entry, stop, and target lines:

```js
function renderMarketSvg(market, timeframe) {
  const points = demoData.marketSeries[market][timeframe];
  const path = points.map((value, index) => `${index ? 'L' : 'M'} ${index * 18} ${220 - value}`).join(' ');
  return `<svg viewBox="0 0 720 260" role="img" aria-label="${market} ${timeframe} 模拟价格图">
    <path class="price-path" d="${path}" />
    <line class="plan-line entry" x1="0" x2="720" y1="92" y2="92" />
    <line class="plan-line stop" x1="0" x2="720" y1="174" y2="174" />
    <line class="plan-line target" x1="0" x2="720" y1="48" y2="48" />
  </svg>`;
}
```

Keep exposure visible above the ledger. Plan Ladder must show plan state, order parameters, protection, risk preflight, mandate, and a staged-order action in that order.

- [ ] **Step 4: Implement ledger selection and safe order simulations**

Add representative position, order, fill, and protection records. Selecting a row updates `state.selectedId` and the Context Dock. `cancel-order` opens a modal that explicitly distinguishes cancellation from position closing. `stage-order` creates a demo order with state `staged-demo` and adds an audit event instead of submitting externally.

- [ ] **Step 5: Run the Live Desk tests**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Live Desk"`

Expected: PASS.

- [ ] **Step 6: Commit the integrated Live Desk**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "feat: add integrated live trading desk"
```

### Task 4: Build Lab as a traceable research and learning system

**Files:**
- Modify: `tests/kordynPrototype.test.mjs`
- Modify: `prototypes/kordyn-operating-system.html`

**Interfaces:**
- Consumes: `demoData.knowledge`, `strategies`, `validations`, `reviews`, `optimizations`, and `capabilities`.
- Produces: `renderLab()`, `renderLibrary()`, `renderStrategies()`, `renderValidations()`, `renderLearn()`, `renderCapabilities()`, and actions `select-lab-object`, `import-research`, `create-knowledge-candidate`, `create-optimization-candidate`, `compare-version`, `advance-validation`, and `switch-role`.

- [ ] **Step 1: Add a failing Lab completeness and lifecycle test**

```js
test('Lab includes knowledge, strategy, validation, review, owner optimization, and capabilities', () => {
  const html = readPrototype();
  const $ = parsePrototype();
  for (const mode of ['library', 'strategies', 'validations', 'learn', 'capabilities']) {
    assert.equal($(`[data-lab-mode="${mode}"]`).length, 1, `missing Lab mode ${mode}`);
  }
  for (const phrase of ['Provenance', 'Strategy Spec', 'Validation Run', 'Review Dossier', 'Optimization Candidate', 'Capabilities']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /Candidate.*Reviewing.*Backtesting.*Forward Validation.*Approved.*Released.*Monitoring.*Rolled Back/s);
  assert.match(html, /Owner.*Trader/);
});
```

- [ ] **Step 2: Run the Lab test and verify it fails**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Lab"`

Expected: FAIL with `missing Lab mode library`.

- [ ] **Step 3: Implement Library, Strategies, Validations, and Capabilities registries**

Create centralized objects with IDs, types, source/version/freshness/status fields, and backlink IDs. Use hard-edged rows instead of individual cards. Selecting a knowledge item updates the Context Dock with source, version, citations, related decisions, related trades, and freshness. Selecting a strategy switches the inspector among Spec, Validation Runs, and Release history.

Capabilities rows must show name, scope, permission, health, last use, invocation count, sandbox, and Agent associations.

- [ ] **Step 4: Implement the Review Dossier and Owner optimization queue**

Render each review as a horizontal case timeline:

```js
const reviewStages = ['Plan', 'Approval', 'Risk', 'Orders', 'Position', 'Exit'];
```

The dossier shows P&L, ROI, fees, funding, MAE/MFE, slippage, protection, plan-vs-actual, evidence, and deviation classification. `create-knowledge-candidate` inserts a linked knowledge item and selects it. `create-optimization-candidate` inserts an optimization item with `Candidate` status.

When `state.role === 'trader'`, optimization publishing and user/system configuration remain visible with a lock and permission explanation. Owner can move a demo candidate through the lifecycle one step at a time; no state skips are allowed.

- [ ] **Step 5: Run the Lab tests**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Lab"`

Expected: PASS.

- [ ] **Step 6: Commit Lab**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "feat: add traceable research and learning lab"
```

### Task 5: Build Control, Run Control, and Administration without card-wall duplication

**Files:**
- Modify: `tests/kordynPrototype.test.mjs`
- Modify: `prototypes/kordyn-operating-system.html`

**Interfaces:**
- Consumes: `demoData.mandates`, `policies`, `incidents`, `agents`, `runs`, `events`, `audit`, and administration config records.
- Produces: `renderControl()`, `renderRunControl()`, `renderAdministration()`, `renderSafetyModal(kind)`, and actions `edit-mandate`, `toggle-risk-mode`, `open-safety-modal`, `confirm-demo-safety-action`, `select-run`, `replay-run`, `simulate-stale-data`, `switch-admin-scope`, and `open-secure-session`.

- [ ] **Step 1: Add failing Control/Run/Admin contract tests**

```js
test('Control separates posture, mandates, policy studio, incidents, and emergency semantics', () => {
  const html = readPrototype();
  for (const phrase of ['Control Room', 'Mandate', 'Policy Studio', 'Risk Incidents', '暂停自主', '只减仓', 'Flatten All', 'Kill Switch']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /Flatten All[\s\S]*平仓[\s\S]*Kill Switch[\s\S]*禁止新交易/);
});

test('Run Control and Administration expose all operational and configuration domains', () => {
  const html = readPrototype();
  for (const phrase of ['Market Data', 'Risk Engine', 'Agent Queue', 'Event Stream', 'Notifications', 'Audit', 'Environment', 'Network Proxy', 'Backup', 'OKX', 'Models & Keys', 'Users', 'Subscription']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /simulate-stale-data/);
  assert.match(html, /Secure Session/);
});
```

- [ ] **Step 2: Run the tests and verify the first missing Control phrase fails**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Control|operational"`

Expected: FAIL.

- [ ] **Step 3: Implement Control Room, Mandates, Policy Studio, and Incidents**

Use one large posture statement and budget bands, followed by a scope matrix and incident timeline. Do not render risk as equally weighted metric cards. Emergency actions call `openSafetyModal(kind)` with distinct copy:

```js
const safetyCopy = {
  pause: { does:'暂停 Agent 自主开仓', doesNot:'不会撤单或平仓' },
  reduce: { does:'阻止新增风险，只允许减仓', doesNot:'不会自动平仓' },
  flatten: { does:'模拟撤销开仓单并平掉所有持仓', doesNot:'不会关闭系统服务' },
  kill: { does:'模拟禁止新交易并进入熔断保护', doesNot:'不会擅自提取或转移资产' }
};
```

Confirmation adds a visible result object and demo audit ID.

- [ ] **Step 4: Implement Run Control topology, Run viewer, and unified event stream**

Render `Market Data → Agent → Risk Engine → Execution → Audit` as a connected status band. Selecting an Agent Run updates step status, timing, input/output, tools, errors, retries, and versions. Replay advances a visible step marker with short `setTimeout` callbacks. The stale-data simulation changes `state.systemMode` to `stale`, displays a global degradation banner, and changes Plan Ladder Risk Preflight to blocked.

Event Stream, Notifications, and Audit read from the same centralized events array with different predicates.

- [ ] **Step 5: Implement scope-first Administration and secure configuration states**

Render scope selectors `System | Tenant | Trading Account | User`, then compact registry/form rows for every configuration domain. Sensitive domains open a Secure Session overlay. Trader role sees locked Owner settings with the required permission explanation. Save buttons produce a scoped demo result and audit ID.

- [ ] **Step 6: Run the Control/Run/Admin tests**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="Control|operational"`

Expected: PASS.

- [ ] **Step 7: Commit Control, Run Control, and Administration**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "feat: add control operations and administration workspaces"
```

### Task 6: Complete global interactions, responsive behavior, and dead-control enforcement

**Files:**
- Modify: `tests/kordynPrototype.test.mjs`
- Modify: `prototypes/kordyn-operating-system.html`

**Interfaces:**
- Consumes: All renderer and action names from Tasks 1–5.
- Produces: `renderApp()` orchestration, `switchWorkspace(name)`, `openObjectSwitcher()`, `selectGlobalObject(id)`, `openSafetyModal(kind)`, keyboard support, responsive layout rules, and a contract that every visible `button` has `data-action` or is a form submit.

- [ ] **Step 1: Add failing global wiring, safety, and responsive tests**

```js
test('every visible button is wired and global accessibility hooks exist', () => {
  const $ = parsePrototype();
  const unwired = $('button').filter((_, el) => !$(el).attr('data-action') && $(el).attr('type') !== 'submit');
  assert.equal(unwired.length, 0, `unwired buttons: ${unwired.map((_, el) => $(el).text().trim()).get().join(', ')}`);
  assert.equal($('[aria-label]').length > 12, true);
  assert.match(readPrototype(), /Escape/);
  assert.match(readPrototype(), /openObjectSwitcher/);
});

test('prototype contains desktop, medium, and narrow responsive rules without hiding business data', () => {
  const html = readPrototype();
  assert.match(html, /@media\s*\(max-width:\s*1100px\)/);
  assert.match(html, /@media\s*\(max-width:\s*680px\)/);
  assert.doesNotMatch(html, /\.ledger[^}]*display\s*:\s*none/);
  assert.doesNotMatch(html, /#context-dock[^}]*display\s*:\s*none/);
});

test('required safety and degraded states are explicit', () => {
  const html = readPrototype();
  assert.match(html, /DEGRADED|数据已过期/);
  assert.match(html, /BLOCKED|阻断/);
  assert.match(html, /NO LIVE ACTION/);
  assert.match(html, /audit-[a-z0-9]+/i);
});
```

- [ ] **Step 2: Run the global tests and verify they fail on unwired buttons or missing media rules**

Run: `node --test tests/kordynPrototype.test.mjs --test-name-pattern="every visible|responsive|required safety"`

Expected: FAIL.

- [ ] **Step 3: Finish render orchestration and global object navigation**

Implement one renderer map and state-preserving workspace switch:

```js
const workspaceRenderers = {
  command: renderCommand, live: renderLiveDesk, lab: renderLab,
  control: renderControl, run: renderRunControl, admin: renderAdministration
};

function renderApp() {
  document.body.dataset.role = state.role;
  document.body.dataset.systemMode = state.systemMode;
  document.querySelector('#workspace').innerHTML = workspaceRenderers[state.workspace]();
  document.querySelector('#context-dock').innerHTML = renderContextDock(resolveSelectedObject());
  document.querySelector('#trace-rail').innerHTML = renderTraceRail();
  renderGlobalStatus();
}
```

Global search uses a curated object index and selects both workspace and object. Keyboard `/` or `Meta+K` opens it; `Escape` closes modal, switcher, Context Dock overlay, or Trace detail in that priority order.

- [ ] **Step 4: Add medium and narrow responsive layouts**

At `max-width: 1100px`, move Context Dock into an overlay while preserving its trigger and content. At `max-width: 680px`, convert the Workspace Rail to bottom navigation, stack the workbench, convert registries into row lists, and open Context Dock/Trace as full-height detail layers. Do not hide fields or safety confirmations.

- [ ] **Step 5: Remove or wire every dead control and add focus management**

Ensure every button has an action. After workspace switch, focus `#workspace`; after modal open, focus the first enabled modal button; after modal close, return focus to its trigger. Add visible `:focus-visible` styles using the acid color.

- [ ] **Step 6: Run the complete structural suite**

Run: `node --test tests/kordynPrototype.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Run project lint without hiding pre-existing failures**

Run: `npm run lint`

Expected: PASS, or record any unrelated pre-existing failure with its exact file and message before continuing.

- [ ] **Step 8: Commit the complete interaction and responsive pass**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "feat: complete prototype interactions and responsive layout"
```

### Task 7: Perform browser runtime and visual verification

**Files:**
- Modify if defects are found: `prototypes/kordyn-operating-system.html`
- Modify if the contract needs correction: `tests/kordynPrototype.test.mjs`

**Interfaces:**
- Consumes: The complete standalone HTML prototype.
- Produces: Browser-verified desktop and narrow-screen behavior with no fatal console errors and screenshots suitable for user review.

- [ ] **Step 1: Open the local prototype in the in-app browser at 1440×900**

Use the Browser plugin to navigate to the absolute `file:///Users/ely/Desktop/Trading%20Agent/prototypes/kordyn-operating-system.html` URL and set a 1440×900 viewport if the browser supports viewport override.

Expected: Command opens by default; Command Rail, Workspace Rail, workbench, Context Dock, and Trace Rail are visible without overlap.

- [ ] **Step 2: Exercise the end-to-end decision flow**

Perform these visible interactions in order:

1. Open an intelligence event.
2. Create an observation.
3. Switch to Watch and run immediate AI review.
4. Qualify the plan.
5. Open approval confirmation and confirm the demo action.
6. Open Live Desk and stage a demo order.
7. Open the resulting Trace stage.

Expected: object selection, statuses, Context Dock, and Trace stay synchronized; every confirmation says `DEMO / NO LIVE ACTION`.

- [ ] **Step 3: Exercise learning, role, safety, and degraded flows**

1. Open a trade review in Lab and create a knowledge candidate.
2. Create an optimization candidate.
3. Switch to Trader and verify release controls stay visible but locked.
4. Return to Owner.
5. Open Flatten All and Kill Switch and verify different impact copy.
6. In Run Control, simulate stale data and return to Live Desk.

Expected: stale data produces a global degradation banner and blocks Risk Preflight; no data or function disappears when switching roles.

- [ ] **Step 4: Inspect console and correct runtime defects**

Read browser console errors. For each prototype-owned error, add or tighten a structural test when possible, patch the HTML, and rerun `node --test tests/kordynPrototype.test.mjs` before refreshing the browser.

Expected: no uncaught exceptions, missing function errors, invalid selector errors, or failed local asset requests.

- [ ] **Step 5: Verify the 390×844 narrow layout**

Set the viewport to 390×844 and verify workspace navigation, queue selection, Context Dock, Trace, Live Desk ledger, Lab registries, safety modals, and locked Owner functions remain reachable.

Expected: no horizontal page overflow; wide registries become structured row lists; no fields, states, confirmations, or audit feedback are removed.

- [ ] **Step 6: Run final verification commands**

Run:

```bash
node --test tests/kordynPrototype.test.mjs
git diff --check
git status --short
```

Expected: tests PASS; `git diff --check` prints nothing; status shows only the intended prototype/test changes if browser verification required fixes.

- [ ] **Step 7: Commit browser-verified fixes if any**

```bash
git add tests/kordynPrototype.test.mjs prototypes/kordyn-operating-system.html
git commit -m "fix: polish browser-verified prototype behavior"
```

