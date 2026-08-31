import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { CONFIGURATION_GROUPS } from "./ConfigurationRegistry.jsx";
import { ConfigurationEditorFor } from "./ConfigurationWorkspace.jsx";
import { configurationTargetAllowed } from "./governancePermissions.js";

export function MobileConfigurationScreen({ model = {}, actions, actionsDisabled = false, onSelect = () => {} }) {
  const [target, setTarget] = useState("");
  const forbidden = target ? !configurationTargetAllowed(model.permissions, target) : false;
  if (target) return <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="configuration" data-kordyn-v2-mobile-config-view="editor"><button className="kordynV2MobileBack" type="button" onClick={() => setTarget("")}><ArrowLeft size={18} />配置范围</button><ConfigurationEditorFor target={target} model={model} actions={actions} actionsDisabled={forbidden || actionsDisabled} onSelect={onSelect} /></section>;
  return <section className="kordynV2GovernanceMobile" data-kordyn-v2-governance-mobile="configuration" data-kordyn-v2-mobile-config-view="registry"><header><h2>系统配置</h2><p>选择范围后进入独立编辑与确认流程</p></header><nav className="kordynV2MobileConfigurationRegistry" aria-label="配置范围">{CONFIGURATION_GROUPS.map(({ id, label, description, Icon }) => <button type="button" key={id} data-kordyn-v2-config-target={id} data-kordyn-v2-config-access={configurationTargetAllowed(model.permissions, id) ? "granted" : "forbidden"} onClick={() => setTarget(id)}><Icon size={20} /><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={18} /></button>)}</nav></section>;
}
