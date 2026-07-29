import React, { useState, useEffect } from "react";
import { TrendingUp, Target, Layers, CheckCircle2, ChevronRight } from "lucide-react";
import { displayMoney } from "./lib.jsx";
import { LiveGrayPanel } from "./panels.jsx";
import "./redesign.css";

// ============ ④ 风控总览(只读 · 3 秒看懂) ============
export function RiskOverviewPage({ data, action, ui }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const auto = data.automationState || {};
  const portfolio = data.portfolio || {};
  const gray = data.grayReleasePolicies?.[0] || {};
  const latestRisk = (data.riskChecks || [])[0] || {};
  const sys = data.system || {};
  const rawScore = latestRisk.riskScore ?? portfolio.riskScore;
  const hasScore = Number.isFinite(Number(rawScore));
  const score = hasScore ? Number(rawScore) : null;
  const level = portfolio.riskLabel || (score >= 70 ? "高风险" : score >= 40 ? "中风险" : score != null ? "低风险" : "未评估");
  const killed = sys.killSwitch;
  const reduceOnly = sys.reduceOnlyMode;
  const tone = killed || /高/.test(level) ? "bad" : /中/.test(level) ? "warn" : score != null ? "good" : "warn";
  const statusText = killed ? "已熔断 · 禁止开仓" : reduceOnly ? "只减仓 · 禁止新开仓" : tone === "good" ? "运行正常" : tone === "warn" ? "需要关注" : "高危";
  const budget = sys.remainingDailyLossUsdt;
  const equity = Number(portfolio.totalEquityUsdt);
  const budgetCap = mandate.maxDailyLossPct && equity ? (Number(mandate.maxDailyLossPct) / 100) * equity : null;
  const budgetPct = budgetCap && budget != null ? Math.max(0, Math.min(100, (Number(budget) / budgetCap) * 100)) : null;
  const maxLev = mandate.max_leverage || (mandate.maxLeverageBySymbol && Object.values(mandate.maxLeverageBySymbol).length ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : null);
  const minLev = mandate.min_leverage ?? mandate.minLeverage ?? 1;
  const ex = data.exchangeAccounts || [];
  const anyRead = ex.some((a) => a.readEnabled), anyTrade = ex.some((a) => a.tradeEnabled), anyWithdraw = ex.some((a) => a.withdrawEnabled);
  const ips = ex.map((a) => a.ipWhitelist).filter(Boolean);
  const goSettings = () => ui.setActive("riskSettings");
  return (
    <div className="rdPage">
      <div className="rdHead"><div><h1>风控总览 <em>RISK · VIEW</em></h1><p>此刻的风险姿态，一眼看懂；要改配置去「风控设置」。</p></div><button className="rdLink" onClick={goSettings}>去风控设置 ›</button></div>

      <div className={`rdWall ${tone}`}>
        <span className="ic">{killed ? "⛔" : tone === "good" ? "🛡" : "⚠"}</span>
        <div className="mid"><div className="k">运行模式 · {auto.label || "—"}</div><div className="lv">{level} · {statusText}</div>{auto.blockers?.length ? <small>距全自动还缺：{auto.blockers.join("、")}</small> : <small>{auto.detail || ""}</small>}</div>
        <div className="score"><b>{hasScore ? score : "—"}</b><span>/100</span></div>
      </div>

      <div className="rdCard rdBudget">
        <div className="top"><span>今日剩余亏损预算</span><b>{budget == null ? "未授权" : `${displayMoney(budget, 0)} U${budgetPct != null ? ` · ${budgetPct.toFixed(0)}%` : ""}`}</b></div>
        <div className={`rdBar ${budgetPct != null && budgetPct < 25 ? "low" : ""}`}><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>AI 的手被什么管着</b><span className="rdCode">Limits</span><div className="rdR"><button className="rdLink" onClick={goSettings}>调整 ›</button></div></div>
        <div className="rdTiles">
          <div className="rdTile"><div className="tk"><TrendingUp size={13} /> 杠杆区间</div><div className="tv">{maxLev ? (minLev === maxLev ? `${maxLev}x` : `${minLev}–${maxLev}x`) : "未授权"}</div></div>
          <div className="rdTile"><div className="tk"><Target size={13} /> 单笔风险上限</div><div className="tv">{mandate.maxSingleTradeRiskPct != null ? `${mandate.maxSingleTradeRiskPct}%` : "—"}</div></div>
          <div className="rdTile"><div className="tk"><Layers size={13} /> 灰度单笔额度</div><div className="tv sm">{gray.enabled ? `${displayMoney(gray.maxNotionalUsdt, 0)} U` : "未启用"}</div></div>
          <div className="rdTile"><div className="tk"><CheckCircle2 size={13} /> 审批阈值</div><div className="tv sm">{mandate.id ? `≥${displayMoney(mandate.humanApprovalNotionalUsdt || 0, 0)} U` : "—"}</div></div>
        </div>
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>账户安全</b><span className="rdCode">Security</span></div>
        <div className="rdSec"><span className={`dot ${anyRead ? "g" : "w"}`} /><span>API 密钥 · 读取行情/账户</span><span className={`sv ${anyRead ? "g" : "w"}`}>{anyRead ? "已连接" : "未配置"}</span></div>
        <div className="rdSec"><span className={`dot ${anyTrade ? "g" : "w"}`} /><span>API 密钥 · 交易下单</span><span className={`sv ${anyTrade ? "g" : "w"}`}>{anyTrade ? "已开启" : "未开启"}</span></div>
        <div className="rdSec"><span className={`dot ${anyWithdraw ? "r" : "g"}`} /><span>API 密钥 · 提现权限</span><span className={`sv ${anyWithdraw ? "r" : "g"}`}>{anyWithdraw ? "检测到开启 · 高危" : "未开启 · 安全"}</span></div>
        <div className="rdSec"><span className={`dot ${ips.length ? "g" : "w"}`} /><span>IP 白名单</span><span className={`sv ${ips.length ? "g" : "w"}`}>{ips.length ? "已绑定" : "未设置"}</span></div>
        <div className="rdSec"><span className={`dot ${data.larkConfigured ? "g" : "w"}`} /><span>Lark 告警</span><span className={`sv ${data.larkConfigured ? "g" : "w"}`}>{data.larkConfigured ? "已启用" : "未配置"}</span></div>
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>应急操作</b><span className="rdCode">Kill</span></div>
        <p className="rdMuted" style={{ margin: "0 0 12px" }}>出问题立刻按；减风险动作(平仓/止损/减仓)永远放行。</p>
        <div className="rdEmerg">
          <button className="warn" onClick={() => action("/api/system/autonomy", { enabled: false })}>暂停自主</button>
          <button className="warn" onClick={() => { const on = Boolean(reduceOnly); if (window.confirm(on ? "关闭只减仓模式？" : "开启只减仓模式？将禁止新开仓，仅允许减仓/平仓/撤单。")) action("/api/risk/reduce-only", { enabled: !on }); }}>{reduceOnly ? "退出只减仓" : "只减仓"}</button>
          <button className="bad" onClick={() => action("/api/risk/kill-switch", { enabled: !killed, reason: "" })}>{killed ? "解除熔断" : "一键熔断"}</button>
        </div>
      </div>
    </div>
  );
}

// ============ ⑤ 风控设置(可管理) ============
const SCOPE_OF = (r) => { const t = String(r.scope || r.category || r.name || "").toLowerCase(); if (/account|portfolio|loss|margin|equity|账户|资金/.test(t)) return "account"; if (/event|事件|宏观/.test(t)) return "event"; if (/system|knowledge|kill|api|系统/.test(t)) return "system"; return "trade"; };
const RULE_CATS = [
  { key: "account", label: "账户风险", color: "var(--rd-info)" },
  { key: "trade", label: "交易风险", color: "var(--rd-good)" },
  { key: "event", label: "事件风险", color: "var(--rd-warn)" },
  { key: "system", label: "系统风险", color: "var(--rd-use)" }
];
const ACTION_CN = { pause_opening: "暂停开仓", notify: "提醒", reduce: "减仓", none: "仅记录" };

function NumField({ label, value, unit, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => { const n = Number(v); if (Number.isFinite(n) && String(v) !== String(value)) onSave(n); };
  return <div className="rdField"><span className="fk">{label}</span><span className="fv"><input value={v ?? ""} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} inputMode="decimal" /><span className="unit">{unit}</span></span></div>;
}

export function RiskSettingsPage({ data, action, ui }) {
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const auto = data.automationState || {};
  const rules = data.riskRules || [];
  const [openCat, setOpenCat] = useState("account");
  const cur = auto.mode === "full_auto_small" ? "full_auto" : auto.mode === "semi_auto" ? "semi_auto" : auto.mode === "observe" ? "observe" : null;
  async function setMode(m) {
    if (m === cur) return;
    let ack = false;
    if (m !== "observe") { if (!window.confirm(m === "full_auto" ? "切到「全自动」：AI 发现符合授权的机会会用真实资金自动下单，不再问你。确认？" : "切到「半自动」：会用真实资金交易，但每单需你点批准。确认？")) return; ack = true; }
    await action("/api/system/operating-mode", { mode: m, acknowledged: ack });
  }
  const patchMandate = (field, value) => { if (mandate.id) action(`/api/mandates/${mandate.id}`, { [field]: value }, "PATCH"); };
  const toggleRule = (r) => action(`/api/risk/rules/${r.id}`, { enabled: r.enabled === false }, "PATCH");
  const maxLev = mandate.max_leverage || (mandate.maxLeverageBySymbol && Object.values(mandate.maxLeverageBySymbol).length ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : "");
  const minLev = mandate.min_leverage ?? mandate.minLeverage ?? "";
  const MODES = [{ id: "observe", label: "观察", desc: "只分析，绝不下单(干跑)" }, { id: "semi_auto", label: "半自动", desc: "AI 提计划，你批准才下单" }, { id: "full_auto", label: "全自动", desc: "够格机会自动下单" }];
  return (
    <div className="rdPage">
      <div className="rdHead"><div><h1>风控设置 <em>RISK · CONFIG</em></h1><p>授权边界、风险规则、实盘/灰度、密钥一处配置。</p></div><button className="rdLink" onClick={() => ui.setActive("riskOverview")}>去风控总览 ›</button></div>

      <div className="rdCard">
        <div className="rdCardH"><b>运行模式</b><span className="rdCode">Mode</span><div className="rdR"><span className="rdMono" style={{ fontSize: 11, color: "var(--rd-faint)" }}>当前：{auto.label || "—"}</span></div></div>
        <div className="rdModes">{MODES.map((m) => <button key={m.id} className={`rdMode ${cur === m.id ? "on" : ""}`} onClick={() => setMode(m.id)}><b>{m.label}</b><span>{m.desc}</span></button>)}</div>
      </div>

      <div className="rdGrid2">
        <div className="rdCard">
          <div className="rdCardH"><b>授权委托</b><span className="rdCode">Mandate</span><div className="rdR"><button className="rdEditBtn" onClick={() => ui.openPanel("mandate")}>白名单/详情</button></div></div>
          <div className="rdField"><span className="fk">白名单</span><span className="fv"><b>{(mandate.allowedSymbols || []).join("、") || "未授权"}</b></span></div>
          <NumField label="杠杆下限" value={minLev} unit="x" onSave={(v) => patchMandate("min_leverage", v)} />
          <NumField label="杠杆上限" value={maxLev} unit="x" onSave={(v) => patchMandate("max_leverage", v)} />
          <NumField label="仓位/单" value={mandate.positionPct ?? mandate.equityPct ?? ""} unit="% 余额" onSave={(v) => patchMandate("positionPct", v)} />
          <NumField label="单笔风险" value={mandate.maxSingleTradeRiskPct ?? ""} unit="%" onSave={(v) => patchMandate("maxSingleTradeRiskPct", v)} />
          <NumField label="单日亏损" value={mandate.maxDailyLossPct ?? ""} unit="%" onSave={(v) => patchMandate("maxDailyLossPct", v)} />
          <NumField label="审批阈值" value={mandate.humanApprovalNotionalUsdt ?? ""} unit="U" onSave={(v) => patchMandate("humanApprovalNotionalUsdt", v)} />
        </div>

        <div className="rdCard">
          <div className="rdCardH"><b>实盘写入与灰度</b><span className="rdCode">Live / Gray</span></div>
          <LiveGrayPanel data={data} action={action} ui={ui} />
        </div>
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>风险规则</b><span className="rdCode">Rules · 可开关 · 标来源</span><div className="rdR"><button className="rdEditBtn" onClick={() => ui.openPanel("ruleLibrary")}>批准/去重</button></div></div>
        {RULE_CATS.map((cat) => {
          const list = rules.filter((r) => SCOPE_OF(r) === cat.key);
          const on = openCat === cat.key;
          return (
            <div className="rdRuleCat" key={cat.key}>
              <div className={`rdRuleCatH ${on ? "open" : ""}`} onClick={() => setOpenCat(on ? "" : cat.key)}>
                <span className="catdot" style={{ background: cat.color }} /><b>{cat.label}</b><span className="cn">{list.filter((r) => r.enabled !== false).length}/{list.length} 启用</span><ChevronRight size={15} className="chev" />
              </div>
              {on && (list.length ? list.map((r) => (
                <div className="rdRule" key={r.id}>
                  <div className="rmain"><div className="rn">{r.name || "规则"}</div><div className="rmeta">{r.condition ? `当 ${r.condition} → ` : ""}{ACTION_CN[r.action] || r.action || "提醒"}</div>{r.sourceTitle && <div className="rsrc">《{r.sourceTitle}》</div>}</div>
                  <button className={`rdSw ${r.enabled !== false ? "on" : ""}`} onClick={() => toggleRule(r)} title={r.enabled !== false ? "点击停用" : "点击启用"} />
                </div>
              )) : <div className="rdRuleEmpty">该类暂无规则(可从知识库蒸馏或手动新增)</div>)}
            </div>
          );
        })}
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>密钥与 IP</b><span className="rdCode">Keys</span><div className="rdR"><button className="rdEditBtn" onClick={() => ui.openPanel("ip")}>管理 IP</button></div></div>
        {(data.exchangeAccounts || []).map((a) => (
          <div className="rdSec" key={a.id}><span className={`dot ${a.readEnabled ? "g" : "w"}`} /><span>{a.exchange}</span><span className={`sv ${a.readEnabled ? "g" : "w"}`}>{a.readEnabled ? "已连接" : "未配置"}{a.withdrawEnabled ? " · 提现高危" : ""}</span></div>
        ))}
        {!(data.exchangeAccounts || []).length && <div className="rdRuleEmpty">未配置交易所密钥</div>}
      </div>
    </div>
  );
}
