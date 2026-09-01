import { useState } from "react";
import { Bell, Bot, Box, CloudCog, DatabaseBackup, KeyRound, Network, RadioTower, Search, ShieldCheck, SlidersHorizontal, UserCog, Users, WalletCards } from "lucide-react";

export const CONFIGURATION_GROUPS = Object.freeze([
  Object.freeze({ id: "trading", label: "交易授权", description: "运行模式与 Mandate", Icon: SlidersHorizontal }),
  Object.freeze({ id: "risk", label: "风险规则", description: "确定性限制与动作", Icon: ShieldCheck }),
  Object.freeze({ id: "environment", label: "环境", description: "运行环境与系统参数", Icon: CloudCog }),
  Object.freeze({ id: "network", label: "网络", description: "代理与连接边界", Icon: Network }),
  Object.freeze({ id: "backup", label: "备份", description: "一致性备份与验证", Icon: DatabaseBackup }),
  Object.freeze({ id: "security", label: "安全", description: "MFA 与凭据生命周期", Icon: KeyRound }),
  Object.freeze({ id: "exchange", label: "交易所", description: "OKX 连接与权限", Icon: WalletCards }),
  Object.freeze({ id: "event-sources", label: "事件源", description: "来源、可信度与抓取", Icon: RadioTower }),
  Object.freeze({ id: "notifications", label: "通知", description: "渠道与投递测试", Icon: Bell }),
  Object.freeze({ id: "models", label: "模型与密钥", description: "Provider 与模型选择", Icon: Box }),
  Object.freeze({ id: "agents", label: "AI 交易员", description: "角色、工具与工作流", Icon: Bot }),
  Object.freeze({ id: "users", label: "用户与权限", description: "RBAC 与订阅", Icon: Users }),
  Object.freeze({ id: "account", label: "账户资料", description: "当前身份与允许编辑项", Icon: UserCog })
]);

export function ConfigurationRegistry({ scopes = [], selectedId = "trading", dirtyCount = 0, onSelect = () => {}, onSelectObject = null }) {
  const [query, setQuery] = useState("");
  const countFor = (id) => scopes.filter((row) => row.group === id).length;
  const normalized = query.trim().toLowerCase();
  const groups = normalized ? CONFIGURATION_GROUPS.filter(({ id, label, description }) => `${id} ${label} ${description}`.toLowerCase().includes(normalized)) : CONFIGURATION_GROUPS;
  return <aside className="kordynV2ConfigurationRegistry"><label className="kordynV2ConfigurationSearch"><Search size={14} /><input type="search" value={query} data-kordyn-v2-config-search placeholder="Search configuration…" aria-label="搜索配置" onChange={(event) => setQuery(event.target.value)} /></label><nav aria-label="配置范围">{groups.map(({ id, label, description, Icon }) => <button type="button" key={id} data-kordyn-v2-config-target={id} data-kordyn-v2-object-id={id} data-kordyn-v2-object-type="Configuration item" data-selected={id === selectedId} onClick={() => { const accepted = onSelectObject?.({ id, type: "Configuration item", workspaceId: "governance" }); if (accepted !== null && accepted !== false) onSelect(id); }}><Icon size={15} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span><em>{countFor(id)}</em></button>)}</nav><footer data-kordyn-v2-config-unsaved={dirtyCount}><strong>未保存变更 <em>{dirtyCount}</em></strong><small>{dirtyCount ? "当前配置包含待审查改动" : "所选值与加载值一致"}</small></footer></aside>;
}
