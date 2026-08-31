import { Bell, Bot, Box, CloudCog, DatabaseBackup, KeyRound, Network, RadioTower, ShieldCheck, SlidersHorizontal, UserCog, Users, WalletCards } from "lucide-react";

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

export function ConfigurationRegistry({ scopes = [], selectedId = "trading", onSelect = () => {} }) {
  const countFor = (id) => scopes.filter((row) => row.group === id).length;
  return <nav className="kordynV2ConfigurationRegistry" aria-label="配置范围">{CONFIGURATION_GROUPS.map(({ id, label, description, Icon }) => <button type="button" key={id} data-kordyn-v2-config-target={id} data-selected={id === selectedId} onClick={() => onSelect(id)}><Icon size={15} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span><em>{countFor(id)}</em></button>)}</nav>;
}

