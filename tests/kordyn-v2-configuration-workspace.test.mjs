import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "node_modules", ".cache", `kordyn-v2-configuration-${process.pid}.cjs`);
require("esbuild").buildSync({
  stdin: { contents: `
    export { ConfigurationWorkspace } from "./src/kordynV2/domains/governance/ConfigurationWorkspace.jsx";
    export { TradingRuntimeEditor } from "./src/kordynV2/domains/governance/configuration/TradingRuntimeEditor.jsx";
    export { MobileConfigurationScreen } from "./src/kordynV2/domains/governance/MobileConfigurationScreen.jsx";
    export { buildConfigurationModel } from "./src/kordynV2/domains/governance/configurationModel.js";
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
const { ConfigurationWorkspace, MobileConfigurationScreen, TradingRuntimeEditor, buildConfigurationModel, createElement, renderToStaticMarkup } = require(outFile);

const data = {
  user: { id: "owner-1", name: "Owner", isOwner: true, role: "owner" },
  automationState: { requestedMode: "full_auto", mode: "observe" },
  system: { killSwitch: false },
  config: { liveTrading: { maxNotionalUsdt: 80 }, environment: { NODE_ENV: "production" }, network: { proxy: "configured" } },
  agentStatus: { activeMandate: { id: "mandate-1", maxOrderNotionalUsdt: 50, allowedSymbols: ["BTC-USDT-SWAP"] } },
  riskRules: [{ id: "rule-1", name: "Max leverage", enabled: true, action: "reject_entry" }],
  exchangeAccounts: [{ id: "okx-1", exchange: "OKX", status: "connected", ipWhitelist: "configured" }],
  eventSources: [{ id: "source-1", name: "FOMC", status: "healthy", enabled: true }],
  agentProfiles: [{ id: "agent-1", name: "AI Trader", enabled: true }],
  users: [{ id: "owner-1", name: "Owner", roleId: "role_admin" }],
  subscriptions: [{ id: "sub-1", userId: "owner-1", status: "active" }],
  auditLogs: [{ id: "audit-1", action: "config.update" }],
  resourceState: { operationsCenter: "loaded" }
};
const model = buildConfigurationModel(data);
const actions = { saveConfig: async () => ({ ok: true }), saveMandate: async () => ({ ok: true }), updateRiskRule: async () => ({ ok: true }), runBackup: async () => ({ ok: true }), testEventSource: async () => ({ ok: true }), testNotification: async () => ({ ok: true }), updateAgentProfile: async () => ({ ok: true }), updateUser: async () => ({ ok: true }), grantSubscription: async () => ({ ok: true }) };

test("all persistent editors live under governance configuration", () => {
  const html = renderToStaticMarkup(createElement(ConfigurationWorkspace, { model, actions, location: { domainId: "governance", workspaceId: "configuration" } }));
  for (const id of ["trading", "risk", "environment", "network", "backup", "security", "exchange", "event-sources", "notifications", "models", "agents", "users", "account"]) {
    assert.match(html, new RegExp(`data-kordyn-v2-config-target="${id}"`));
  }
  assert.equal((html.match(/data-kordyn-v2-config-target=/g) || []).length, 13);
});

test("selected and effective values never share one unlabeled field", () => {
  const html = renderToStaticMarkup(createElement(TradingRuntimeEditor, { model: { mode: { selected: "full_auto", effective: "observe" }, maxNotionalUsdt: { selected: 80, effective: 50 }, mandate: {} }, actions }));
  assert.match(html, /保存目标|Selected target/);
  assert.match(html, /当前生效|Effective now/);
  assert.match(html, /data-kordyn-v2-effective-value="observe"/);
});

test("forbidden configuration is explanatory and has no enabled save action", () => {
  const forbidden = {
    ...model,
    permissions: { ...model.permissions, owner: false, approveLiveConfig: false, writeMandate: false },
    permission: { owner: false, canEdit: false, role: "trader" }
  };
  const html = renderToStaticMarkup(createElement(ConfigurationWorkspace, { model: forbidden, actions }));
  assert.match(html, /data-kordyn-v2-configuration-access="forbidden"/);
  assert.doesNotMatch(html, /data-kordyn-v2-action="apply"[^>]*(?<!disabled)>/);
});

test("mobile configuration is registry to scope to editor, not an endless settings stack", () => {
  const html = renderToStaticMarkup(createElement(MobileConfigurationScreen, { model, actions }));
  assert.match(html, /data-kordyn-v2-governance-mobile="configuration"/);
  assert.match(html, /data-kordyn-v2-mobile-config-view="registry"/);
  assert.doesNotMatch(html, /data-kordyn-v2-config-editor="trading"[\s\S]*data-kordyn-v2-config-editor="risk"/);
});
