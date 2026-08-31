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

export function ConfigurationEditorFor({ target, model, actions, actionsDisabled }) {
  const props = { actions, actionsDisabled };
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

export function ConfigurationWorkspace({ model = {}, actions }) {
  const [target, setTarget] = useState("trading");
  const forbidden = model.permission?.canEdit !== true;
  return <section className="kordynV2GovernanceWorkspace kordynV2ConfigurationWorkspace" data-kordyn-v2-governance-workspace="configuration" data-kordyn-v2-configuration-access={forbidden ? "forbidden" : "granted"}><header className="kordynV2GovernanceTitle"><span><h1>Configuration · 系统配置</h1><p>所有持久设置的唯一入口；所选值与生效值始终分开。</p></span>{forbidden && <em>Owner 权限必需</em>}</header><div className="kordynV2ConfigurationNotice">配置变更经过权限、预检、确认与审计；敏感凭据不回显。</div><div className="kordynV2ConfigurationWorkbench"><ConfigurationRegistry scopes={model.scopes || []} selectedId={target} onSelect={setTarget} /><ConfigurationEditorFor target={target} model={model} actions={actions} actionsDisabled={forbidden} /><ConfigurationInspector model={model} target={target} actionsDisabled={forbidden} /></div></section>;
}

