import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectOverviewSection } from "../server/overviewView.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-workspace");
const componentBundle = path.join(cacheDir, `components-${process.pid}.cjs`);
const rootContractBundle = path.join(cacheDir, `root-contract-${process.pid}.cjs`);
const graphDir = path.join(cacheDir, `graph-${process.pid}`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(componentBundle, { force: true }); } catch { /* noop */ }
  try { fs.rmSync(rootContractBundle, { force: true }); } catch { /* noop */ }
  try { fs.rmSync(graphDir, { force: true, recursive: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AiMissionWorkspace } from "./src/kordynV2/domains/ai/AiMissionWorkspace.jsx";
      export { MobileAiMissionScreen } from "./src/kordynV2/domains/ai/MobileAiMissionScreen.jsx";
      export { MissionRegistry } from "./src/kordynV2/domains/ai/MissionRegistry.jsx";
      export { MissionInspector } from "./src/kordynV2/domains/ai/MissionInspector.jsx";
      export { MissionProgress } from "./src/kordynV2/domains/ai/MissionProgress.jsx";
      export { buildAiDomainModel } from "./src/kordynV2/domains/ai/aiModel.js";
      export { missionStagePresentation } from "./src/kordynV2/domains/ai/aiModel.js";
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
  AiMissionWorkspace,
  MobileAiMissionScreen,
  MissionInspector,
  MissionProgress,
  MissionRegistry,
  buildAiDomainModel,
  missionStagePresentation
} = require(componentBundle);

const canonicalStages = Object.freeze([
  "intent", "sense", "recall", "plan", "guard", "approval", "execute", "monitor", "review"
]);

function buildMissionFixture() {
  return buildAiDomainModel({
    agentRuns: [
      {
        id: "run-guard",
        goal: "ETH 突破回踩机会",
        status: "running",
        evidenceCount: 3,
        presentation: { nextAction: "等待价格回踩确认" },
        steps: [{ id: "step-guard", phase: "risk_checking", title: "硬风控", summary: "入场边界仍在验证" }]
      },
      {
        id: "run-approval",
        goal: "SOL 白名单外机会",
        status: "awaiting_approval",
        tradePlanId: "plan-sol",
        evidenceCount: 2,
        steps: [{ id: "step-approval", phase: "awaiting_approval", title: "等待人工确认", summary: "一次性授权待确认" }]
      }
    ],
    tradePlans: [{ id: "plan-sol", agentRunId: "run-approval", status: "awaiting_approval" }]
  });
}

function renderWorkspace(Component, props = {}) {
  return renderToStaticMarkup(React.createElement(Component, {
    model: buildMissionFixture(),
    actions: Object.freeze({}),
    selection: { object: { id: "run-guard", type: "Agent run" }, context: {}, trace: { stages: [] } },
    truth: { risk: "normal", exposure: 14770.32 },
    onSelect: () => {},
    onOpenDialog: () => {},
    onOpenProof: () => {},
    ...props
  }));
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.type === "function") return findElement(node.type(node.props), predicate);
  if (predicate(node)) return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("Desktop and APP present the same Mission truth with device-specific composition", () => {
  const desktop = renderWorkspace(AiMissionWorkspace);
  const mobile = renderWorkspace(MobileAiMissionScreen);

  for (const html of [desktop, mobile]) {
    assert.match(html, /data-kordyn-v2-object-id="run-guard"/);
    assert.match(html, /data-kordyn-v2-object-id="run-approval"/);
    assert.match(html, /正在验证风险边界/);
    assert.match(html, /需要你确认/);
  }
  assert.match(desktop, /data-kordyn-v2-layout="mission-registry-inspector"/);
  assert.match(desktop, /data-kordyn-v2-mission-registry/);
  assert.match(desktop, /data-kordyn-v2-mission-inspector/);
  assert.match(mobile, /data-kordyn-v2-layout="mission-task-flow"/);
  assert.doesNotMatch(mobile, /data-kordyn-v2-mission-registry|data-kordyn-v2-layout="mission-registry-inspector"/);
});

test("a real Mission registry row emits the complete canonical callback", () => {
  const model = buildMissionFixture();
  const selected = [];
  const tree = MissionRegistry({ missions: model.missions, selectedId: "run-approval", onSelect: (candidate) => selected.push(candidate) });
  const row = findElement(tree, (node) => node.props?.["data-kordyn-v2-object-id"] === "run-guard");

  assert.ok(row, "expected the real run-guard Mission button");
  assert.equal(typeof row.props.onClick, "function");
  row.props.onClick();
  assert.deepEqual(selected, [{
    id: "run-guard",
    type: "Agent run",
    workspaceId: "ai",
    route: "chat",
    evidence: 3
  }]);
});

test("canonical Mission selection resolves by ID and invalid selection falls back without mutating it", () => {
  const model = buildMissionFixture();
  const nonMissionSelection = { object: { id: "position-1", type: "Position" }, context: {}, trace: { stages: [] } };
  const html = renderWorkspace(AiMissionWorkspace, { model, selection: nonMissionSelection });

  assert.match(html, /data-kordyn-v2-selected-mission="run-guard"/);
  assert.deepEqual(nonMissionSelection, { object: { id: "position-1", type: "Position" }, context: {}, trace: { stages: [] } });
});

test("Desktop and APP Proof buttons request the visible fallback Mission without mutating global selection", () => {
  const model = buildMissionFixture();
  const globalSelection = { object: { id: "position-global", type: "Position" }, context: {}, trace: { stages: [] } };
  const calls = [];
  const trigger = { focus() {} };
  const onOpenProof = (...args) => calls.push(args);

  const desktopTree = MissionInspector({ mission: model.missions[0], selection: globalSelection, onOpenProof });
  const desktopProof = findElement(desktopTree, (node) => node.props?.["data-kordyn-v2-mission-proof"] === "run-guard");
  assert.ok(desktopProof, "Desktop must expose the visible Mission Proof trigger");
  desktopProof.props.onClick({ currentTarget: trigger });

  const mobileTree = MobileAiMissionScreen({
    model,
    actions: Object.freeze({}),
    selection: globalSelection,
    truth: {},
    onOpenProof
  });
  const mobileProof = findElement(mobileTree, (node) => node.props?.["data-kordyn-v2-mission-proof"] === "run-guard");
  assert.ok(mobileProof, "APP must expose the visible Mission Proof trigger");
  mobileProof.props.onClick({ currentTarget: trigger });

  for (const [actualTrigger, request] of calls) {
    assert.equal(actualTrigger, trigger);
    assert.deepEqual(request, {
      panel: "proof",
      candidate: {
        id: "run-guard",
        type: "Agent run",
        workspaceId: "ai",
        route: "chat",
        evidence: 3
      },
      details: [
        ["创建", "Unavailable"],
        ["更新", "Unavailable"],
        ["完成", "Unavailable"]
      ]
    });
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(globalSelection, { object: { id: "position-global", type: "Position" }, context: {}, trace: { stages: [] } });
});

test("Root evidence resolver snapshots an explicit Mission candidate and fails invalid candidates closed", () => {
  require("esbuild").buildSync({
    stdin: {
      contents: `export { resolveEvidenceSelection } from "./src/kordynV2/KordynV2Root.jsx";`,
      resolveDir: rootDir,
      loader: "jsx"
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
    outfile: rootContractBundle,
    logLevel: "silent"
  });
  const { resolveEvidenceSelection } = require(rootContractBundle);
  const data = {
    resourceState: { chat: "loaded", cockpit: "loaded" },
    agentRuns: [{ id: "run-visible", status: "running" }],
    positions: [{ id: "position-global", symbol: "ETH/USDT", status: "open" }]
  };
  const globalSelection = { object: { id: "position-global", type: "Position" } };
  const mission = resolveEvidenceSelection({
    data,
    selection: globalSelection,
    request: { candidate: { id: "run-visible", type: "Agent run", workspaceId: "ai", route: "chat", evidence: 2 } }
  });

  assert.equal(mission.object.id, "run-visible");
  assert.equal(mission.object.type, "Agent run");
  assert.equal(resolveEvidenceSelection({
    data,
    selection: globalSelection,
    request: { candidate: { id: "run-missing", type: "Agent run", workspaceId: "ai" } }
  }), null);
  assert.equal(resolveEvidenceSelection({ data, selection: globalSelection, request: { panel: "proof" } }), globalSelection);
  assert.equal(globalSelection.object.id, "position-global");
});

test("every canonical Mission stage renders one current step inside a deterministic five-node window", () => {
  for (const stageId of canonicalStages) {
    const mission = { id: `run-${stageId}`, stage: missionStagePresentation(stageId) };
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(MissionProgress, { mission, compact }));
      assert.equal((html.match(/<li\b/g) || []).length, 5, `${stageId}: bounded five-node density`);
      assert.equal((html.match(/aria-current="step"/g) || []).length, 1, `${stageId}: one current step`);
      assert.match(html, new RegExp(`data-stage-id="${stageId}"[^>]*aria-current="step"`));
      assert.match(html, new RegExp(mission.stage.label));
    }
  }
  const unknown = renderToStaticMarkup(React.createElement(MissionProgress, {
    mission: { id: "run-unknown", stage: missionStagePresentation("novel-stage") },
    compact: true
  }));
  assert.equal((unknown.match(/<li\b/g) || []).length, 5);
  assert.equal((unknown.match(/aria-current="step"/g) || []).length, 0);
});

test("authenticated overview projection retains only bounded Mission presentation truth end to end", () => {
  const fullRun = {
    id: "run-projected",
    agentRunId: "run-projected",
    goal: `验证 ETH 回踩 ${"G".repeat(260)}`,
    status: "awaiting_approval",
    tradePlanId: "plan-projected",
    evidenceCount: 4,
    presentation: { nextAction: `等待 Owner 确认 ${"N".repeat(260)}`, internalPrompt: "must not project" },
    steps: [{
      id: "step-project",
      phase: "awaiting_approval",
      title: "正在验证风险边界",
      summary: `账户与风险边界已核对 ${"S".repeat(260)}`,
      toolOutput: { secret: "must not project" }
    }],
    toolTrace: [{ raw: "must not project" }],
    prompt: "must not project"
  };
  const projected = projectOverviewSection({
    agentRuns: [fullRun],
    tradePlans: [{ id: "plan-projected", agentRunId: "run-projected", status: "awaiting_approval" }]
  }, "chat");
  const run = projected.agentRuns[0];

  assert.equal(run.goal.length, 240);
  assert.equal(run.tradePlanId, "plan-projected");
  assert.equal(run.evidenceCount, 4);
  assert.equal(run.presentation.nextAction.length, 240);
  assert.equal(run.steps[0].summary.length, 240);
  assert.equal(run.toolTrace, undefined);
  assert.equal(run.prompt, undefined);
  assert.equal(run.steps[0].toolOutput, undefined);
  assert.equal(run.presentation.internalPrompt, undefined);

  const model = buildAiDomainModel(projected);
  assert.equal(model.missions[0].approval.planId, "plan-projected");
  assert.equal(model.missions[0].evidenceCount, 4);
  assert.notEqual(model.missions[0].title, "Unavailable");
  assert.notEqual(model.missions[0].summary, "Unavailable");
  assert.notEqual(model.missions[0].nextAction, "Unavailable");
  for (const Component of [AiMissionWorkspace, MobileAiMissionScreen]) {
    const html = renderWorkspace(Component, { model, selection: { object: { id: "run-projected", type: "Agent run" } } });
    assert.match(html, /验证 ETH 回踩/);
    assert.match(html, /账户与风险边界已核对/);
    assert.match(html, /等待 Owner 确认/);
    assert.match(html, /plan-projected/);
  }
});

test("empty and partial Mission models stay usable without invented rows or protected actions", () => {
  for (const Component of [AiMissionWorkspace, MobileAiMissionScreen]) {
    const html = renderWorkspace(Component, {
      model: Object.freeze({ missions: Object.freeze([]) }),
      selection: { object: { id: "missing-run", type: "Agent run" }, context: {}, trace: { stages: [] } }
    });
    assert.match(html, /Unavailable/);
    assert.doesNotMatch(html, /data-kordyn-v2-object-id=/);
    assert.doesNotMatch(html, /批准|拒绝|approve|reject/i);
  }
});

test("approval-required Missions disclose authoritative status without Task 2 write controls", () => {
  const desktop = renderWorkspace(AiMissionWorkspace, {
    selection: { object: { id: "run-approval", type: "Agent run" }, context: {}, trace: { stages: [] } }
  });
  const mobile = renderWorkspace(MobileAiMissionScreen, {
    selection: { object: { id: "run-approval", type: "Agent run" }, context: {}, trace: { stages: [] } }
  });

  for (const html of [desktop, mobile]) {
    assert.match(html, /需要你确认/);
    assert.match(html, /plan-sol/);
    assert.doesNotMatch(html, /data-kordyn-v2-(?:approve|reject)-action/);
  }
});

test("KordynV2Root keeps AI in one lazy domain chunk with CSS isolated from Account and the shared shell", () => {
  fs.rmSync(graphDir, { force: true, recursive: true });
  const result = require("esbuild").buildSync({
    entryPoints: [path.join(rootDir, "src/kordynV2/KordynV2Root.jsx")],
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    splitting: true,
    outdir: graphDir,
    metafile: true,
    loader: { ".css": "css" },
    logLevel: "silent"
  });
  const outputs = Object.values(result.metafile.outputs);
  const dynamicImports = outputs.flatMap((output) => output.imports || []).filter((item) => item.kind === "dynamic-import");
  const aiCssInput = "src/kordynV2/domains/ai/ai.css";
  const accountCssInput = "src/kordynV2/domains/account/account.css";
  const aiEntryOutputs = outputs.filter((output) => Object.hasOwn(output.inputs || {}, "src/kordynV2/domains/ai/index.jsx"));
  const accountEntryOutputs = outputs.filter((output) => Object.hasOwn(output.inputs || {}, "src/kordynV2/domains/account/index.jsx"));
  const shellCss = fs.readFileSync(path.join(rootDir, "src/kordynV2/styles/shell.css"), "utf8");
  const mobileCss = fs.readFileSync(path.join(rootDir, "src/kordynV2/styles/mobile-shell.css"), "utf8");
  const rootSource = fs.readFileSync(path.join(rootDir, "src/kordynV2/KordynV2Root.jsx"), "utf8");

  assert.equal(dynamicImports.length, 2);
  assert.equal(aiEntryOutputs.length, 1);
  assert.equal(accountEntryOutputs.length, 1);
  assert.notEqual(aiEntryOutputs[0], accountEntryOutputs[0]);
  assert.ok(Object.keys(result.metafile.inputs).some((input) => input.endsWith(aiCssInput)));
  assert.ok(Object.hasOwn(aiEntryOutputs[0].inputs, aiCssInput));
  assert.equal(Object.hasOwn(aiEntryOutputs[0].inputs, accountCssInput), false);
  assert.match(rootSource, /const destination = location\.domainId === "ai"/);
  assert.doesNotMatch(rootSource, /DialogSurface/);
  assert.match(rootSource, /workspaceId=\{location\.workspaceId\}/);
  assert.match(rootSource, /actionsDisabled=\{state\.kind !== "ready"\}/);
  assert.doesNotMatch(`${shellCss}\n${mobileCss}`, /kordynV2(?:Mission|Queue|Attention|Decision|MobileTrader|MobileActive|MobileNeeds|MobileAccountImpact|MobileRecent)/);
});

test("APP Mission CSS keeps touch targets at 44px and introduces no overflow escape", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/ai/ai.css"), "utf8");
  assert.match(css, /\.kordynV2AiMobile[^{}]*(?:button|Action)[^{}]*\{[^}]*min-(?:block-size|height):\s*44px/s);
  assert.doesNotMatch(css, /(?:^|[;{])\s*min-width\s*:\s*(?:[4-9]\d\d|\d{4,})px|overflow-x\s*:\s*(?:auto|scroll)/m);
  assert.match(css, /@media\s*\([^)]*max-width:\s*430px\)/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*390px\)/);
});
