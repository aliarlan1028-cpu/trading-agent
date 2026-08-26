# KORDYN V2 Intelligent Assets Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement one coherent intelligent-asset system connecting knowledge evidence, strategies, capabilities, validation, trade review, Owner decisions, release, and supported output on Desktop and APP.

**Architecture:** `buildAssetsDomainModel()` composes existing research, strategy, knowledge, capability, and review facts while preserving provenance and lifecycle distinctions. Each registry has its own presenter, but all share relationship identity and a single review/release lifecycle. Knowledge-derived candidates graduate into existing Strategy/Capability registries only through deployed actions.

**Tech Stack:** React 18, Vite lazy domain chunk, plain scoped CSS/SVG relationship lines, Node `node:test`, CDP Chrome runner.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- Preserve program constraints and Plan 01 interfaces.
- This plan owns exactly 18 `lab.*` capabilities from `lab.research-map` through `lab.owner-review`.
- Native strategies/tools enter their registries directly; imported and knowledge-derived assets retain distinct provenance.
- Knowledge ingestion may create only deployed concepts, discipline rules, methods, closed-template strategy drafts, lenses, workflows, and governed imported-skill records.
- No arbitrary executable code generation, unknown tool registration, direct live rewrite, or unvalidated “published” state.
- Desktop and APP are implemented in every task.

---

### Task 1: Intelligent-asset model, provenance, lifecycle, and actions

**Files:**
- Create: `src/kordynV2/domains/assets/assetsModel.js`
- Create: `src/kordynV2/domains/assets/provenance.js`
- Create: `src/kordynV2/domains/assets/lifecycle.js`
- Create: `src/kordynV2/domains/assets/assetsActions.js`
- Modify: `src/kordynV2/actions/createV2Actions.js`
- Create: `tests/kordyn-v2-assets-model.test.mjs`
- Create: `tests/kordyn-v2-assets-actions.test.mjs`

**Interfaces:**
- Consumes: `buildResearchMap()`, `buildStrategyCatalogRows()`, `buildCapabilityCatalogRows()`, `strategyBacktestCoverage()`, and production knowledge/review data.
- Produces: `buildAssetsDomainModel(data)`, `assetProvenance(row)`, `assetLifecycle(row)`, and `createAssetsActions(deps)` under `createV2Actions().assets`.

- [ ] **Step 1: Write the failing provenance/model test**

```js
test("native imported and knowledge-derived products remain distinct", () => {
  const model = buildAssetsDomainModel(fixture);
  assert.deepEqual(model.strategies.map((row) => row.provenance.kind), ["system-native", "imported", "knowledge-derived"]);
  assert.equal(model.strategies.find((row) => row.provenance.kind === "knowledge-derived").provenance.sourceId, "source-1");
});

test("knowledge candidates do not appear published before deployed graduation", () => {
  const model = buildAssetsDomainModel({ knowledge: { candidates: [{ id: "c-1", type: "strategy", status: "candidate" }] } });
  assert.equal(model.strategyRegistry.some((row) => row.id === "c-1"), false);
  assert.equal(model.incubation.candidates[0].lifecycle.stage, "candidate");
});
```

- [ ] **Step 2: Write failing action endpoint tests**

```js
test("knowledge and release actions retain deployed endpoints", async () => {
  const calls = [];
  const assets = createAssetsActions({ action: async (...args) => { calls.push(args); return { ok: true }; }, confirm: async () => true });
  await assets.parseSource("s-1");
  await assets.convertSource("s-1", "Book");
  await assets.adoptCandidate("c-1");
  await assets.enableCapability("skill-1");
  assert.deepEqual(calls, [
    ["/api/knowledge/sources/s-1/parse-real", {}],
    ["/api/knowledge/convert", { sourceId: "s-1" }],
    ["/api/knowledge/candidates/c-1/adopt", {}],
    ["/api/skills/skill-1/enable", {}]
  ]);
});
```

- [ ] **Step 3: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-assets-model.test.mjs tests/kordyn-v2-assets-actions.test.mjs`

Expected: FAIL with missing assets V2 modules.

- [ ] **Step 4: Implement the model and action facade**

Actions include deployed source parse/convert, candidate ignore/adopt/approve-prompt, method compile, skill validate/paper/sync/approve, strategy draft/test/backtest/publish, strategy market enable/disable, capability enable/disable, review lesson/improvement actions, and pure-forward session start. Confirmation text must identify the selected object/version and preserve Owner evidence requirements.

- [ ] **Step 5: Run GREEN and production lifecycle regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-assets-model.test.mjs tests/kordyn-v2-assets-actions.test.mjs tests/research-map.test.mjs tests/view-data-parity.test.mjs tests/knowledge-source-lifecycle.test.mjs tests/strategy-products.test.mjs tests/owner-review-loop.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/domains/assets/assetsModel.js src/kordynV2/domains/assets/provenance.js src/kordynV2/domains/assets/lifecycle.js src/kordynV2/domains/assets/assetsActions.js src/kordynV2/actions/createV2Actions.js tests/kordyn-v2-assets-model.test.mjs tests/kordyn-v2-assets-actions.test.mjs
git commit -m "feat: model V2 intelligent asset lifecycle"
```

### Task 2: Relationship overview on Desktop and APP

**Files:**
- Create: `src/kordynV2/domains/assets/index.jsx`
- Create: `src/kordynV2/domains/assets/RelationshipWorkspace.jsx`
- Create: `src/kordynV2/domains/assets/RelationshipGraph.jsx`
- Create: `src/kordynV2/domains/assets/RelationshipInspector.jsx`
- Create: `src/kordynV2/domains/assets/MobileRelationshipScreen.jsx`
- Create: `src/kordynV2/domains/assets/assets.css`
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Create: `tests/kordyn-v2-relationship-workspace.test.mjs`

**Interfaces:**
- Consumes: `model.relationships`, canonical asset objects, and navigation to each authoritative registry.
- Produces: relationship-node selection and device-specific graph/thread presentation.

- [ ] **Step 1: Write the failing relationship test**

```js
test("relationship overview links canonical objects without inventing edges", () => {
  const html = renderToStaticMarkup(<RelationshipWorkspace model={model} onSelect={() => {}} onNavigate={() => {}} />);
  for (const type of ["Mission", "Strategy", "Knowledge source", "Capability", "Review"]) assert.match(html, new RegExp(`data-kordyn-v2-object-type="${type}"`));
  assert.equal((html.match(/data-kordyn-v2-relation=/g) || []).length, model.relationships.edges.length);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-relationship-workspace.test.mjs`

Expected: FAIL on missing relationship components.

- [ ] **Step 3: Reproduce the approved Desktop topology and APP relationship thread**

Desktop matches `desktop-assets-relationship.png`: meaningful topology, selected node inspector, provenance/status, and clear routes into registries. APP matches `mobile-intelligent-assets.png`: a vertical relationship thread and object drill-down, not a squeezed graph. Use Compact Truth Bar.

- [ ] **Step 4: Run GREEN and relationship regression**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-relationship-workspace.test.mjs tests/research-map.test.mjs && npm run build`

Expected: PASS; assets chunk remains lazy.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/assets src/kordynV2/KordynV2Root.jsx tests/kordyn-v2-relationship-workspace.test.mjs
git commit -m "feat: build V2 intelligent asset relationships"
```

### Task 3: Strategy Registry and Studio

**Files:**
- Create: `src/kordynV2/domains/assets/StrategyWorkspace.jsx`
- Create: `src/kordynV2/domains/assets/StrategyRegistry.jsx`
- Create: `src/kordynV2/domains/assets/StrategyInspector.jsx`
- Create: `src/kordynV2/domains/assets/StrategyStudio.jsx`
- Create: `src/kordynV2/domains/assets/MobileStrategyScreen.jsx`
- Modify: `src/kordynV2/domains/assets/index.jsx`
- Modify: `src/kordynV2/domains/assets/assets.css`
- Create: `tests/kordyn-v2-strategy-workspace.test.mjs`

**Interfaces:**
- Consumes: strategy registry rows, drafts, generated tests, OOS coverage, pure-forward state, release state, provenance, and strategy actions.
- Produces: Strategy product/draft/validation canonical selection and controlled Studio flow.

- [ ] **Step 1: Write the failing validation gate test**

```js
test("strategy publish stays disabled until generated tests and all-symbol OOS pass", () => {
  const html = renderToStaticMarkup(<StrategyStudio model={draftModel({ tests: "passed", oosComplete: false })} actions={actions} />);
  assert.match(html, /data-kordyn-v2-action="publish"[^>]*disabled/);
});

test("registry labels provenance explicitly", () => {
  const html = renderToStaticMarkup(<StrategyRegistry rows={model.strategies} onSelect={() => {}} />);
  for (const kind of ["system-native", "imported", "knowledge-derived"]) assert.match(html, new RegExp(`data-provenance="${kind}"`));
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-strategy-workspace.test.mjs`

Expected: FAIL on missing strategy components.

- [ ] **Step 3: Reproduce the approved registry/studio composition**

Match `desktop-strategy-registry.png`: dense registry, selected strategy truth, lineage, validation evidence, version/action state, and Studio flow in one coherent system. APP uses registry → detail → validation/release full-screen flow with every field preserved through disclosure.

- [ ] **Step 4: Run GREEN and strategy regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-strategy-workspace.test.mjs tests/strategy-studio.test.mjs tests/strategy-validation-integration.test.mjs tests/paper-forward-integrity.test.mjs tests/strategy-contracts.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/assets tests/kordyn-v2-strategy-workspace.test.mjs
git commit -m "feat: build V2 strategy registry and studio"
```

### Task 4: Knowledge Incubator and Capability Registry

**Files:**
- Create: `src/kordynV2/domains/assets/KnowledgeWorkspace.jsx`
- Create: `src/kordynV2/domains/assets/KnowledgeSourceRegistry.jsx`
- Create: `src/kordynV2/domains/assets/KnowledgeEvidenceInspector.jsx`
- Create: `src/kordynV2/domains/assets/KnowledgeGraph.jsx`
- Create: `src/kordynV2/domains/assets/IncubationQueue.jsx`
- Create: `src/kordynV2/domains/assets/CapabilityWorkspace.jsx`
- Create: `src/kordynV2/domains/assets/CapabilityRegistry.jsx`
- Create: `src/kordynV2/domains/assets/CapabilityInspector.jsx`
- Create: `src/kordynV2/domains/assets/MobileKnowledgeScreen.jsx`
- Create: `src/kordynV2/domains/assets/MobileCapabilityScreen.jsx`
- Modify: `src/kordynV2/domains/assets/index.jsx`
- Modify: `src/kordynV2/domains/assets/assets.css`
- Create: `tests/kordyn-v2-knowledge-capability.test.mjs`

**Interfaces:**
- Consumes: source processing stages, evidence, concepts/edges, candidate types, skill status, MCP grants, connector health, and capability actions.
- Produces: Source/Evidence/Candidate/Capability canonical selection and real graduation actions.

- [ ] **Step 1: Write the failing reality-boundary test**

```js
test("knowledge and capability UI expose only deployed artifact types", () => {
  const knowledge = renderToStaticMarkup(<KnowledgeWorkspace model={model} actions={actions} onSelect={() => {}} />);
  for (const type of ["strategy_draft", "knowledge_lens", "knowledge_workflow", "imported_skill_record"]) assert.match(knowledge, new RegExp(type));
  assert.doesNotMatch(knowledge, /任意代码|arbitrary executable|generate tool code/i);
});

test("MCP grants are explicit and fail closed", () => {
  const capability = renderToStaticMarkup(<CapabilityInspector capability={{ id: "mcp-1", kind: "mcp", grant: null }} />);
  assert.match(capability, /未授权|Not granted/);
  assert.doesNotMatch(capability, /可调用|Available to call/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-knowledge-capability.test.mjs`

Expected: FAIL on missing knowledge/capability presenters.

- [ ] **Step 3: Reproduce both approved registries**

Match `desktop-knowledge-incubator.png` and `desktop-capability-registry.png`: source lifecycle, evidence anatomy, graph relationship, candidate routing, provenance, grants, health, version, and bounded actions. Mobile keeps separate source/candidate and capability/grant flows.

- [ ] **Step 4: Run GREEN and knowledge/capability safety tests**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-knowledge-capability.test.mjs tests/knowledge-converter.test.mjs tests/knowledge-rag-source-scope.test.mjs tests/knowledge-skills.test.mjs tests/capability-router.test.mjs tests/mcp-route-security.test.mjs tests/skill-live-validation.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/assets tests/kordyn-v2-knowledge-capability.test.mjs
git commit -m "feat: build V2 knowledge and capability registries"
```

### Task 5: Trade Review, Owner optimization, release, and output

**Files:**
- Create: `src/kordynV2/domains/assets/ReviewReleaseWorkspace.jsx`
- Create: `src/kordynV2/domains/assets/ReviewRegistry.jsx`
- Create: `src/kordynV2/domains/assets/ReviewInspector.jsx`
- Create: `src/kordynV2/domains/assets/OwnerDecisionQueue.jsx`
- Create: `src/kordynV2/domains/assets/ReleasePipeline.jsx`
- Create: `src/kordynV2/domains/assets/ReviewOutputSheet.jsx`
- Create: `src/kordynV2/domains/assets/MobileReviewReleaseScreen.jsx`
- Modify: `src/kordynV2/domains/assets/index.jsx`
- Modify: `src/kordynV2/domains/assets/assets.css`
- Create: `tests/kordyn-v2-review-release.test.mjs`

**Interfaces:**
- Consumes: completed trade reviews, lesson candidates, Owner improvement candidates, evidence requirements, validation sessions, release destination, and supported output.
- Produces: Review/Owner candidate/Validation run/Release canonical selection and deployed Owner actions.

- [ ] **Step 1: Write the failing governance/lifecycle test**

```js
test("review cannot directly rewrite a live strategy capability or rule", () => {
  const source = readFileSync(new URL("../src/kordynV2/domains/assets/OwnerDecisionQueue.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\/api\/(strategy\/market|skills\/[^/]+\/enable|risk\/rules\/[^/]+)/);
  assert.match(source, /review\/improvements/);
});

test("Owner release requires production evidence", () => {
  const html = renderToStaticMarkup(<ReleasePipeline candidate={{ id: "i-1", validation: { ready: false } }} actions={actions} />);
  assert.match(html, /data-kordyn-v2-action="release"[^>]*disabled/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-review-release.test.mjs`

Expected: FAIL on missing review/release components.

- [ ] **Step 3: Reproduce the approved review and release workbench**

Match `desktop-review-owner-release.png`: review registry, evidence inspector, Owner queue, validation/release path, and supported poster draft without flattening them into parallel tabs. APP uses review → evidence → Owner decision → validation/release flows.

- [ ] **Step 4: Run GREEN and review/release regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-review-release.test.mjs tests/review-learning.test.mjs tests/owner-review-counterexamples.test.mjs tests/owner-review-loop.test.mjs tests/performance-review-integrity.test.mjs tests/closed-trade-poster.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/assets tests/kordyn-v2-review-release.test.mjs
git commit -m "feat: build V2 review and release workspace"
```

### Task 6: Intelligent-assets real-state, browser, capability, and visual gates

**Files:**
- Create: `tests/kordyn-v2-assets-browser.html`
- Create: `tests/kordyn-v2-assets-browser.jsx`
- Create: `tests/run-kordyn-v2-assets-browser.mjs`
- Create: `tests/kordyn-v2-assets-states.test.mjs`
- Create: `src/kordynV2/domains/assets/capabilitySurfaces.js`
- Create: `src/kordynV2/domains/assets/stateSurfaces.js`
- Modify: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: real assets components, shared fixtures, approved concept assets, and comparison script.
- Produces: `ASSET_CAPABILITY_SURFACES`, `ASSET_STATE_SURFACES`, 18/18 capability evidence, relationship/selection evidence, state evidence, and six concept comparison sets.

- [ ] **Step 1: Write the failing capability/state gate**

```js
test("intelligent assets own all eighteen lab capabilities", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => row.id.startsWith("lab.")).map((row) => row.id);
  assert.equal(ids.length, 18);
  for (const id of ids) assert.ok(ASSET_CAPABILITY_SURFACES[id], id);
});
```

Add the explicit state gate below. Its fixtures include a failed source import, stale capability health, forbidden Owner queue, disabled MCP grant, no-result graph, long evidence, and large registries.

```js
for (const state of ["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"]) {
  test(`intelligent assets render ${state} truthfully`, () => {
    const renderState = ASSET_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    assertStateContract(renderState(assetStateFixture), state);
  });
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-assets-states.test.mjs`

Expected: FAIL because capability/state registration is absent.

- [ ] **Step 3: Build the real component click path**

Click one Knowledge source, Evidence, Strategy product, Capability, Validation run, Review, and Owner candidate in actual V2 components. After every click, assert root selected ID/type plus Context/Proof identity. Exercise source conversion and Owner decision with stubbed authoritative failure/partial/success responses.

- [ ] **Step 4: Capture, compare, and run verification**

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-assets-model.test.mjs tests/kordyn-v2-assets-actions.test.mjs tests/kordyn-v2-relationship-workspace.test.mjs tests/kordyn-v2-strategy-workspace.test.mjs tests/kordyn-v2-knowledge-capability.test.mjs tests/kordyn-v2-review-release.test.mjs tests/kordyn-v2-assets-states.test.mjs
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/assets node tests/run-kordyn-v2-assets-browser.mjs
node scripts/compare-kordyn-v2-concepts.mjs --screenshots .impeccable/review/kordyn-v2/assets --output .impeccable/review/kordyn-v2/assets-compare --scope assets
node tests/run-kordyn-v2-performance-build.mjs
git diff --check
```

Expected: all commands exit `0`; comparisons cover Desktop relationship/strategy/knowledge/capability/review and APP intelligent assets at both widths.

- [ ] **Step 5: Review and commit**

Open all six concept comparison sets and record the 18/18 capability paths, provenance/lifecycle evidence, and differences in `docs/kordyn-v2-evidence.md`.

```bash
git add src/kordynV2/domains/assets/capabilitySurfaces.js src/kordynV2/domains/assets/stateSurfaces.js tests/kordyn-v2-assets-browser.html tests/kordyn-v2-assets-browser.jsx tests/run-kordyn-v2-assets-browser.mjs tests/kordyn-v2-assets-states.test.mjs docs/kordyn-v2-evidence.md .impeccable/review/kordyn-v2/assets .impeccable/review/kordyn-v2/assets-compare
git commit -m "test: verify KORDYN V2 intelligent assets"
```
