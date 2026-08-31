import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { createGovernanceActions } from "../src/kordynV2/domains/governance/governanceActions.js";
import { classifyGovernanceActionResult } from "../src/kordynV2/domains/governance/governanceActionOutcome.js";
import { buildGovernancePermissions, configurationTargetAllowed } from "../src/kordynV2/domains/governance/governancePermissions.js";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "node_modules", ".cache", `kordyn-v2-governance-finish-${process.pid}.cjs`);
require("esbuild").buildSync({
  stdin: { contents: `
    export { ConfigurationEditorFor, ConfigurationWorkspace } from "./src/kordynV2/domains/governance/ConfigurationWorkspace.jsx";
    export { OperationsWorkspace } from "./src/kordynV2/domains/governance/OperationsWorkspace.jsx";
    export { MobileOperationsScreen } from "./src/kordynV2/domains/governance/MobileOperationsScreen.jsx";
    export { MobileRecoveryScreen } from "./src/kordynV2/domains/governance/MobileRecoveryScreen.jsx";
    export { buildChangedConfigurationPayload } from "./src/kordynV2/domains/governance/configuration/editorShared.jsx";
    export { createElement } from "react";
    export { renderToStaticMarkup } from "react-dom/server";
  `, resolveDir: rootDir, loader: "jsx" },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});
const { ConfigurationEditorFor, ConfigurationWorkspace, OperationsWorkspace, MobileOperationsScreen, MobileRecoveryScreen, buildChangedConfigurationPayload, createElement, renderToStaticMarkup } = require(outFile);

const ownerData = { user: { id: "owner-1", isOwner: true }, permissions: ["*"] };
const viewerData = { user: { id: "viewer-1", isOwner: false }, permissions: ["account.read", "audit.read"] };

test("governance permissions fail closed per deployed action class", () => {
  const owner = buildGovernancePermissions(ownerData);
  const viewer = buildGovernancePermissions(viewerData);
  assert.equal(owner.writeTask, true);
  assert.equal(owner.writeEvent, true);
  assert.equal(owner.writeRisk, true);
  assert.equal(owner.reconcile, true);
  assert.equal(owner.configureSecurity, true);
  assert.equal(viewer.readNotifications, true);
  assert.equal(viewer.updateOwnProfile, true);
  for (const key of ["writeTask", "writeEvent", "writeRisk", "stopTrading", "flattenAll", "clearKillSwitch", "reconcile", "configureSecurity", "adminSystem"]) assert.equal(viewer[key], false, key);
  assert.equal(buildGovernancePermissions({ user: { id: "unknown" } }).writeTask, false);
  assert.equal(buildGovernancePermissions({ user: { id: "unknown" } }).readNotifications, false);
  assert.equal(buildGovernancePermissions({ user: { id: "operator" }, permissions: ["risk.kill_switch"] }).reconcile, false);
  assert.equal(buildGovernancePermissions({ user: { id: "operator" }, permissions: ["write:exchange"] }).reconcile, true);
  assert.equal(configurationTargetAllowed(buildGovernancePermissions({ user: { id: "operator" }, permissions: ["approve:live_config", "write:mandate"] }), "trading"), false);
  assert.equal(configurationTargetAllowed(buildGovernancePermissions({ user: { id: "operator" }, permissions: ["admin:security", "write:mandate"] }), "trading"), true);
});

test("governance uses the deployed live-trading and self-profile endpoints", async () => {
  const calls = [];
  const actions = createGovernanceActions({ action: async (...args) => { calls.push(args); return { message: "saved", applied: ["mode"] }; }, confirm: async () => true });
  await actions.saveLiveTrading({ requestedMode: "full_auto", acknowledged: true, maxNotionalUsdt: 80 });
  await actions.updateAccountProfile({ name: "K0" });
  assert.deepEqual(calls, [
    ["/api/config/live-trading", { requestedMode: "full_auto", acknowledged: true, maxNotionalUsdt: 80 }],
    ["/api/account/profile", { name: "K0" }, "PATCH"]
  ]);
});

test("successful deployed response shapes are not rejected by the governance outcome model", () => {
  for (const response of [
    { message: "saved", applied: ["LIVE_TRADING_MODE"] },
    { incident: { id: "incident-1" }, message: "resolved" },
    { user: { id: "user-1" } },
    { notification: { deliveryStatus: "delivered" }, message: "sent" },
    { account: { id: "okx-1" }, message: "updated" }
  ]) assert.equal(classifyGovernanceActionResult(response), "success");
  assert.equal(classifyGovernanceActionResult({ ok: false, error: "denied" }), "failed");
  assert.equal(classifyGovernanceActionResult({ status: "partial", completed: ["snapshot"], failed: ["orders"] }), "partial");
  assert.equal(classifyGovernanceActionResult({ message: "无变更", applied: [] }), "failed");
  assert.equal(classifyGovernanceActionResult({ message: "ambiguous" }), "failed");
});

test("all durable configuration groups expose their deployed actions", () => {
  const model = {
    trading: { mode: { selected: "full_auto", effective: "observe" }, maxNotionalUsdt: { selected: 80, effective: 50 }, mandate: { id: "mandate-1", allowedSymbols: ["BTC-USDT-SWAP"], maxLeverage: 3 } },
    risk: { rules: [{ id: "rule-1", name: "Risk", enabled: true }] },
    environment: {}, network: {}, backup: {},
    security: { secrets: [{ key: "OPENROUTER_API_KEY", label: "OpenRouter", configured: true }] },
    exchange: { accounts: [{ id: "okx-1", exchange: "OKX", ipWhitelist: "1.2.3.4", status: "configured" }] },
    eventSources: [{ id: "source-1", name: "Fed", type: "rss", url: "https://example.com/rss", enabled: true }],
    notifications: { telegram: { configured: true } }, models: { providers: [{ id: "model-1" }], selected: { model: "model-1" } },
    agents: [{ id: "agent-1", name: "Agent", enabled: true }], users: [{ id: "user-1", name: "User", roleId: "role_trader" }], subscriptions: [], account: { id: "owner-1", name: "Owner" }
  };
  const actions = Object.fromEntries(["saveLiveTrading", "saveMandate", "activateMandate", "createRiskRule", "updateRiskRule", "runBackup", "clearSecret", "confirmNoWithdraw", "updateExchangeAccount", "createEventSource", "setEventSourceEnabled", "deleteEventSource", "refreshEventSources", "testEventSource", "saveConfig", "testNotification", "updateAgentProfile", "createUser", "updateUser", "grantSubscription", "updateAccountProfile"].map((key) => [key, () => {}]));
  const expectations = {
    trading: ["save-live-trading", "save-mandate", "activate-mandate"], risk: ["create-risk-rule", "update-risk-rule"],
    backup: ["run-backup"], security: ["clear-secret"], exchange: ["update-exchange", "confirm-no-withdraw"],
    "event-sources": ["create-event-source", "refresh-event-sources", "toggle-event-source", "delete-event-source", "test-event-source"],
    notifications: ["save-config", "test-notification"], models: ["save-config"], agents: ["update-agent"],
    users: ["create-user", "update-user", "grant-subscription"], account: ["update-account-profile"]
  };
  for (const [target, actionIds] of Object.entries(expectations)) {
    const html = renderToStaticMarkup(createElement(ConfigurationEditorFor, { target, model, actions, actionsDisabled: false }));
    for (const id of actionIds) assert.match(html, new RegExp(`data-kordyn-v2-config-action="${id}"`), `${target}:${id}`);
  }
});

test("APP runs expose Task and Agent run while Recovery exposes report truth and identity", () => {
  const model = { operations: {
    overall: { label: "degraded", tone: "warning" }, services: [], attention: [],
    tasks: { items: [{ id: "task-1", name: "Patrol", enabled: true, runtime: { code: "healthy" } }], recentRuns: [{ id: "run-1", taskName: "Patrol", status: "success" }] },
    recovery: { latestReconciliation: { id: "recovery-1", status: "partial", createdAt: "2026-08-31T10:00:00Z" }, differences: [{ id: "difference-1" }], unknownOrders: [], openIncidents: [] }
  }, permissions: buildGovernancePermissions(ownerData) };
  const actions = { runTask: () => {}, pauseTask: () => {}, reconcile: () => {} };
  const operations = renderToStaticMarkup(createElement(MobileOperationsScreen, { model, actions }));
  const recovery = renderToStaticMarkup(createElement(MobileRecoveryScreen, { model, actions }));
  assert.match(operations, /data-kordyn-v2-object-type="Task"/);
  assert.match(operations, /data-kordyn-v2-object-type="Agent run"/);
  assert.match(recovery, /data-kordyn-v2-object-type="Recovery"/);
  assert.match(recovery, /partial/);
  assert.match(recovery, /1 项差异/);
});

test("production editors never invent environment or credential suffix truth", () => {
  const exchange = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/configuration/ExchangeEditor.jsx"), "utf8");
  const environment = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/configuration/EnvironmentEditor.jsx"), "utf8");
  const network = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/configuration/NetworkEditor.jsx"), "utf8");
  const models = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/configuration/ModelEditor.jsx"), "utf8");
  const stateSurfaces = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/stateSurfaces.js"), "utf8");
  assert.doesNotMatch(exchange, /K7Q2/);
  assert.doesNotMatch(environment, /\|\|\s*"production"/);
  assert.doesNotMatch(environment, /NODE_ENV/);
  assert.doesNotMatch(network, /defaultValue=\{value\}|"not configured"/);
  assert.doesNotMatch(models, /name="LLM_MODEL"|••••••••/);
  assert.match(models, /GEMINI_MODEL/);
  assert.match(models, /DEEPSEEK_MODEL/);
  assert.doesNotMatch(stateSurfaces, /Plan 05 governance production-shaped fixture|2026-08-31T10:18:00\.000Z/);
});

test("generic configuration editors submit only deployed runtime keys and disable missing facts", () => {
  const files = ["EnvironmentEditor", "NetworkEditor", "ModelEditor", "NotificationEditor", "SecurityEditor"];
  const deployed = new Set(["OKX_MARKET_TYPE", "PORT", "SKILL_SANDBOX_IMAGE", "HTTP_PROXY", "HTTPS_PROXY", "GEMINI_MODEL", "GEMINI_CLASSIFIER_MODEL", "DEEPSEEK_MODEL", "TELEGRAM_CHAT_ID", "TELEGRAM_PROFIT_POSTER_ENABLED", "TELEGRAM_WATCH_LANGUAGE", "TELEGRAM_BOT_TOKEN", "AUTH_REQUIRED", "ADMIN_PASSWORD"]);
  for (const file of files) {
    const source = readFileSync(path.join(rootDir, `src/kordynV2/domains/governance/configuration/${file}.jsx`), "utf8");
    const keys = [...source.matchAll(/name="([A-Z][A-Z0-9_]*)"/g)].map((match) => match[1]);
    assert.ok(keys.length > 0, file);
    for (const key of keys) assert.equal(deployed.has(key), true, `${file}:${key}`);
  }
  const emptyModel = { trading: {}, risk: {}, environment: {}, network: {}, backup: {}, security: {}, exchange: {}, eventSources: [], notifications: {}, models: {}, agents: [], users: [], subscriptions: [], account: {} };
  for (const target of ["environment", "network", "notifications", "models", "security"]) {
    const html = renderToStaticMarkup(createElement(ConfigurationEditorFor, { target, model: emptyModel, actions: { saveConfig: () => {} }, actionsDisabled: false }));
    assert.match(html, /data-kordyn-v2-config-action="save-config"[^>]*disabled=""/, target);
  }
});

test("configuration changes fail closed for no-change and unavailable placeholder values", () => {
  assert.equal(buildChangedConfigurationPayload([
    { name: "PORT", value: "3000", initialValue: "3000" },
    { name: "OKX_MARKET_TYPE", value: "Unavailable", initialValue: "Unavailable" }
  ]), null);
  assert.deepEqual(buildChangedConfigurationPayload([
    { name: "PORT", value: "3001", initialValue: "3000" },
    { name: "OKX_MARKET_TYPE", value: "Unavailable", initialValue: "Unavailable" },
    { name: "IGNORED", value: "x", initialValue: "", disabled: true }
  ]), { PORT: "3001" });

  const loadedModel = {
    trading: { mode: { selected: "full_auto", effective: "observe" }, maxNotionalUsdt: { selected: 80, effective: 50 }, mandate: {} },
    risk: {}, environment: { port: 3000, skillSandboxImage: "sandbox:current" }, network: {}, backup: {}, security: {}, exchange: {}, eventSources: [], notifications: {}, models: {}, agents: [], users: [], subscriptions: [], account: {},
    scopes: [], permissions: buildGovernancePermissions(ownerData), permission: { owner: true }, audit: {}
  };
  const environment = renderToStaticMarkup(createElement(ConfigurationEditorFor, { target: "environment", model: loadedModel, actions: { saveConfig: () => {} }, actionsDisabled: false }));
  assert.doesNotMatch(environment, /option value="Unavailable"/);
  assert.match(environment, /data-kordyn-v2-config-action="save-config"[^>]*disabled=""/);
});

test("desktop governance workspaces retain the approved configuration and operations topology", () => {
  const model = {
    scopes: [], permissions: buildGovernancePermissions(ownerData), permission: { owner: true }, audit: { total: 1, latest: { action: "config.update", status: "recorded" } },
    trading: { mode: { selected: "full_auto", effective: "observe" }, maxNotionalUsdt: { selected: 80, effective: 50 }, mandate: { id: "mandate-1", status: "active", allowedSymbols: ["BTC-USDT-SWAP"], maxLeverage: 3 } },
    operations: { overall: { label: "degraded", tone: "warning" }, services: [{ id: "market", tone: "healthy", labelZh: "行情输入", value: "240ms" }, { id: "inputs", tone: "warning", labelZh: "事件输入", value: "15/17" }], tasks: { items: [], recentRuns: [{ id: "run-1", taskName: "Auto Trade Cycle", status: "processing", stages: [{ id: "sense", label: "检查市场" }] }] }, attention: [{ id: "event-1", kind: "source", tone: "warning", titleZh: "事件输入部分降级" }], activity: [{ id: "audit-1", type: "audit", title: "risk_preflight", status: "passed" }], recovery: { latestReconciliation: { id: "recovery-1", status: "partial" }, reports: [] } }
  };
  const configuration = renderToStaticMarkup(createElement(ConfigurationWorkspace, { model, actions: {}, actionsDisabled: false }));
  assert.match(configuration, /class="kordynV2ConfigurationGlobalActions"/);
  assert.match(configuration, /data-kordyn-v2-config-search/);
  assert.match(configuration, /class="kordynV2ConfigurationSettingsMatrix"/);
  assert.match(configuration, /class="kordynV2ConfigurationCredentialBar"/);
  const operations = renderToStaticMarkup(createElement(OperationsWorkspace, { model, actions: {}, actionsDisabled: false }));
  assert.match(operations, /class="kordynV2OperationsTaskColumn"/);
  assert.match(operations, /class="kordynV2OperationsAuditStream"/);
  assert.match(operations, /class="kordynV2OperationsRecoveryColumn"/);
  assert.match(operations, /data-kordyn-v2-recovery-comparison/);
});

test("APP governance retains the approved status rail and degraded decision hierarchy", () => {
  const model = { operations: {
    overall: { label: "degraded", tone: "warning" }, services: [{ id: "inputs", tone: "warning", value: "15/17" }, { id: "account", tone: "healthy", value: "320ms" }], attention: [], notifications: { critical: 1 },
    tasks: { items: [], recentRuns: [{ id: "run-1", taskName: "Auto Trade Cycle", status: "processing" }] }
  }, boundary: { killSwitch: false }, permissions: buildGovernancePermissions(ownerData) };
  const html = renderToStaticMarkup(createElement(MobileOperationsScreen, { model, actions: {}, actionsDisabled: false }));
  assert.match(html, /class="kordynV2MobileStatusSummary"/);
  assert.match(html, /class="kordynV2MobileStatusRail"/);
  assert.match(html, /class="kordynV2MobileDegradedDecision"/);
  assert.match(html, /查看详情/);
  assert.match(html, /重试/);
});

test("APP governance deep actions and rows retain 44px touch targets", () => {
  const css = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/governance.css"), "utf8");
  assert.match(css, /@media\s*\([^)]*max-width:\s*760px\)[\s\S]*\.kordynV2ConfigRuleRows[^{}]*button[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*760px\)[\s\S]*\.kordynV2InlineTest[\s\S]*?min-height:\s*44px/);
});
