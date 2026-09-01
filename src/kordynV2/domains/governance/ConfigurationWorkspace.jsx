import { useState } from "react";
import { ConfigurationInspector } from "./ConfigurationInspector.jsx";
import { ConfigurationRegistry } from "./ConfigurationRegistry.jsx";
import { AccountProfileEditor } from "./configuration/AccountProfileEditor.jsx";
import { AgentEditor } from "./configuration/AgentEditor.jsx";
import { BackupEditor } from "./configuration/BackupEditor.jsx";
import { EnvironmentEditor } from "./configuration/EnvironmentEditor.jsx";
import { EventSourceEditor } from "./configuration/EventSourceEditor.jsx";
import { ExchangeEditor } from "./configuration/ExchangeEditor.jsx";
import { ModelEditor } from "./configuration/ModelEditor.jsx";
import { NetworkEditor } from "./configuration/NetworkEditor.jsx";
import { NotificationEditor } from "./configuration/NotificationEditor.jsx";
import { RiskRuleEditor } from "./configuration/RiskRuleEditor.jsx";
import { SecurityEditor } from "./configuration/SecurityEditor.jsx";
import { TradingRuntimeEditor } from "./configuration/TradingRuntimeEditor.jsx";
import { UserSubscriptionEditor } from "./configuration/UserSubscriptionEditor.jsx";
import { configurationTargetAllowed } from "./governancePermissions.js";

export function ConfigurationEditorFor({ target, model, actions, actionsDisabled, onSelect, onDirtyChange }) {
  const props = { actions, actionsDisabled, onSelect, onDirtyChange };
  if (target === "trading") return <TradingRuntimeEditor model={model.trading} {...props} />;
  if (target === "risk") return <RiskRuleEditor model={model.risk} {...props} />;
  if (target === "environment") return <EnvironmentEditor model={model.environment} {...props} />;
  if (target === "network") return <NetworkEditor model={model.network} {...props} />;
  if (target === "backup") return <BackupEditor model={model.backup} {...props} />;
  if (target === "security") return <SecurityEditor model={model.security} {...props} />;
  if (target === "exchange") return <ExchangeEditor model={model.exchange} {...props} />;
  if (target === "event-sources") return <EventSourceEditor model={model.eventSources} {...props} />;
  if (target === "notifications") return <NotificationEditor model={model.notifications} {...props} />;
  if (target === "models") return <ModelEditor model={model.models} {...props} />;
  if (target === "agents") return <AgentEditor model={model.agents} {...props} />;
  if (target === "users") return <UserSubscriptionEditor users={model.users} subscriptions={model.subscriptions} {...props} />;
  return <AccountProfileEditor model={model.account} {...props} />;
}

export function ConfigurationWorkspace({ model = {}, actions, actionsDisabled = false, onSelect = () => {} }) {
  const [target, setTarget] = useState("trading");
  const [dirty, setDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const forbidden = !configurationTargetAllowed(model.permissions, target);
  const disabled = forbidden || actionsDisabled;
  const selectTarget = (next) => { setTarget(next); setDirty(false); };
  const discard = () => { setDirty(false); setEditorVersion((value) => value + 1); };
  const submitCurrent = () => { if (typeof document !== "undefined") document.getElementById(`kordyn-v2-config-form-${target}`)?.requestSubmit(); };
  const account = model.exchange?.accounts?.[0];
  return <section className="kordynV2GovernanceWorkspace kordynV2ConfigurationWorkspace" data-kordyn-v2-governance-workspace="configuration" data-kordyn-v2-configuration-access={forbidden ? "forbidden" : "granted"}><header className="kordynV2GovernanceTitle"><span><h1>Configuration · 系统配置</h1><p>所有持久设置的唯一入口；所选值与生效值始终分开。</p></span><div className="kordynV2ConfigurationGlobalActions"><button type="button" disabled={!dirty} onClick={discard}>放弃未保存 <em>{dirty ? 1 : 0}</em></button><button type="button" disabled={!dirty || disabled} onClick={submitCurrent}>审查并应用 <em>{dirty ? 1 : 0}</em></button></div></header><div className="kordynV2ConfigurationNotice">配置变更经过权限、预检、确认与审计；敏感凭据不回显。账户资料允许本人更新，其余配置按服务端权限逐项关闭。</div><div className="kordynV2ConfigurationWorkbench"><ConfigurationRegistry scopes={model.scopes || []} selectedId={target} dirtyCount={dirty ? 1 : 0} onSelect={selectTarget} onSelectObject={onSelect} /><main className="kordynV2ConfigurationCenter"><div className="kordynV2ConfigurationSettingsMatrix"><ConfigurationEditorFor key={`${target}-${editorVersion}`} target={target} model={model} actions={actions} actionsDisabled={disabled} onSelect={onSelect} onDirtyChange={setDirty} /></div><section className="kordynV2ConfigurationCredentialBar"><strong>交易所凭据</strong><span>{account?.exchange || account?.name || "Unavailable"}</span><span>API Key {account?.keySuffix ? `••••${account.keySuffix}` : "hidden / unavailable"}</span><span>连接状态 <em>{account?.status || "Unavailable"}</em></span></section></main><ConfigurationInspector model={model} target={target} actionsDisabled={disabled} /></div></section>;
}
