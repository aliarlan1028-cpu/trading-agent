import { ArrowUpRight, Ban, CheckCircle2, History, ShieldCheck } from "lucide-react";

const text = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : String(value);
const list = (value) => Array.isArray(value) ? value : [];

function mcpGrant(capability) {
  const grant = capability?.grant || capability?.authorization || null;
  if (!grant || grant === false) return { state: "not-granted", label: "未授权 · Not granted", scope: "Unavailable", expiresAt: "Unavailable" };
  const status = String(grant.status || grant.state || "granted").toLowerCase();
  if (["expired", "revoked", "denied", "blocked"].includes(status)) return { state: status, label: status === "expired" ? "授权已过期" : "授权不可用", scope: text(grant.scope), expiresAt: text(grant.expiresAt) };
  return { state: "granted", label: "已授权", scope: text(grant.scope || grant.permissions), expiresAt: text(grant.expiresAt) };
}

export function CapabilityInspector({ capability = null, actions, actionsDisabled = false, onNavigate = () => {}, compact = false }) {
  if (!capability) return <aside className="kordynV2CapabilityInspector is-empty"><strong>选择一项能力</strong><p>查看身份、权限、健康和调用证据。</p></aside>;
  const isMcp = capability.category === "mcp" || String(capability.kind).toLowerCase() === "mcp";
  const grant = mcpGrant(capability);
  const native = capability.provenance?.kind === "system-native";
  const canToggle = !actionsDisabled && !native && !capability.connector && (!isMcp || grant.state === "granted");
  const enabled = capability.enabled === true;
  return (
    <aside className={`kordynV2CapabilityInspector${compact ? " is-compact" : ""}`} data-kordyn-v2-capability-inspector={capability.id}>
      <header><span><small>{text(capability.provenance?.label)}</small><strong>{text(capability.name)}</strong><code>{text(capability.version)}</code></span><div><em data-health={capability.health}>{text(capability.health)}</em><b>{enabled ? "已启用" : text(capability.status)}</b></div></header>
      <section className="kordynV2CapabilityIdentity"><strong>来源与身份</strong><dl><div><dt>注册方式</dt><dd>{native ? "code-registered native" : text(capability.source || capability.kind)}</dd></div><div><dt>对象 ID</dt><dd>{text(capability.id)}</dd></div><div><dt>授权影响</dt><dd>{text(capability.permission || capability.requiredPermission)}</dd></div></dl></section>
      <section className="kordynV2CapabilityImpact"><strong>权限与影响</strong><p><CheckCircle2 size={13} aria-hidden="true" />只允许已声明、已授权的调用范围</p><p><Ban size={13} aria-hidden="true" />未知工具默认拒绝，所有调用经过权限、预检与审计</p></section>
      <section className="kordynV2CapabilityUsage"><strong>运行证据</strong><div><span>调用<strong>{text(capability.calls)}</strong></span><span>健康<strong>{text(capability.health)}</strong></span><span>延迟<strong>{text(capability.usage?.avgLatencyMs)} ms</strong></span><span>最近调用<strong>{text(capability.lastRunAt)}</strong></span></div></section>
      {isMcp && <section className="kordynV2McpGrant" data-kordyn-v2-mcp-grant={grant.state}><header><ShieldCheck size={15} aria-hidden="true" /><strong>MCP 明确授权</strong></header><dl><div><dt>状态</dt><dd>{grant.label}</dd></div><div><dt>权限范围</dt><dd>{grant.scope}</dd></div><div><dt>到期时间</dt><dd>{grant.expiresAt}</dd></div><div><dt>声明工具</dt><dd>{list(capability.tools).map((tool) => text(tool?.name || tool)).join(" · ") || "Unavailable"}</dd></div></dl><button type="button" onClick={() => onNavigate("governance", "configuration")}>前往配置 <ArrowUpRight size={13} aria-hidden="true" /></button></section>}
      <footer><button type="button" onClick={() => onNavigate("governance", "audit")}><History size={13} aria-hidden="true" />查看调用记录</button><button type="button" data-kordyn-v2-capability-action="toggle" disabled={!canToggle} onClick={() => enabled ? actions?.disableCapability?.(capability.id) : actions?.enableCapability?.(capability.id)}>{native ? "系统管理 · System managed" : enabled ? "停用能力" : "启用能力"}</button></footer>
    </aside>
  );
}
