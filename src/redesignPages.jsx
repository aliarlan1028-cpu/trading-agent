import React, { useState, useEffect } from "react";
import { TrendingUp, Target, Layers, CheckCircle2, ChevronRight, BookOpen } from "lucide-react";
import { displayMoney, humanize, SKILL_STATE } from "./lib.jsx";
import { LiveGrayPanel } from "./panels.jsx";
import { ConceptGraph } from "./pages.jsx";
import "./redesign.css";

// 折叠区(知识库/能力页共用)
function Fold({ title, n, open, onT, children }) {
  return (
    <div className="rdFold">
      <div className={`rdFoldH ${open ? "open" : ""}`} onClick={onT}><b>{title}</b><span className="cn">{n}</span><ChevronRight size={15} className="chev" /></div>
      {open && <div className="rdFoldB">{children}</div>}
    </div>
  );
}

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

// ============ ① 知识库 · 转换工作台 ============
export function KnowledgeWorkbenchPage({ data, action, ui }) {
  const k = data.knowledge || {};
  const sources = k.sources || [];
  const methods = k.tradingMethods || [];
  const concepts = k.conceptCards || [];
  const rules = k.ruleProposals || [];
  const allCands = k.candidates || [];
  const candidates = allCands.filter((c) => c.status === "candidate");
  const [typeF, setTypeF] = useState("all");
  const [openRef, setOpenRef] = useState("");
  const TYPE_CN = { strategy: "交易策略", lens: "分析 prompt", workflow: "工作流" };
  const srcAgg = (sid) => ({
    methods: methods.filter((m) => m.source?.id === sid).length,
    concepts: concepts.filter((c) => (c.source?.id || c.sourceId) === sid).length,
    rules: rules.filter((r) => (r.sourceRefs || []).includes(sid) || r.source?.id === sid).length,
    cand: allCands.filter((c) => c.sourceId === sid && c.status === "candidate").length,
    adopted: allCands.filter((c) => c.sourceId === sid && c.status === "adopted").length
  });
  const shown = candidates.filter((c) => typeF === "all" || c.type === typeF);
  return (
    <div className="rdPage">
      <div className="rdHead"><div><h1>知识库 <em>KNOWLEDGE</em></h1><p>把书变成 AI 能用的能力：导入 → 生成候选 → 采纳即用。方法/概念是副产物，收在下方参考。</p></div></div>

      <div className="rdCard">
        <div className="rdCardH"><b>知识源</b><span className="rdCode">Sources</span><div className="rdR"><button className="rdBtn ghost" onClick={() => ui.openPanel("knowledgeImport")}>导入新书 / 文章</button></div></div>
        {sources.map((s) => { const a = srcAgg(s.id); return (
          <div className="rdSrc" key={s.id}>
            <span className="si"><BookOpen size={16} /></span>
            <div className="sinfo"><div className="sname">《{s.title}》</div>
              <div className="schips"><span className="rdChip">方法 {a.methods}</span><span className="rdChip">概念 {a.concepts}</span><span className="rdChip">纪律 {a.rules}</span>{a.cand > 0 && <span className="rdChip on">候选 {a.cand}</span>}{a.adopted > 0 && <span className="rdChip on">已采纳 {a.adopted}</span>}</div>
            </div>
            <button className="rdBtn" onClick={() => { if (window.confirm(`从《${s.title}》生成候选？后台调用 LLM 读懂并产出，需十几秒。`)) action("/api/knowledge/convert", { sourceId: s.id }); }}>生成候选</button>
          </div>
        ); })}
        {!sources.length && <div className="rdEmpty">还没有知识源。点「导入新书」喂进交易/心理/策略书籍。</div>}
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>转换产出 · 候选能力</b><span className="rdCode">采纳即用</span></div>
        <div className="rdTypeTabs">
          {[["all", "全部", candidates.length], ["strategy", "交易策略", candidates.filter((c) => c.type === "strategy").length], ["lens", "分析 prompt", candidates.filter((c) => c.type === "lens").length], ["workflow", "工作流", candidates.filter((c) => c.type === "workflow").length]].map(([kk, l, n]) => (
            <button key={kk} className={typeF === kk ? "on" : ""} onClick={() => setTypeF(kk)}>{l} {n}</button>
          ))}
        </div>
        {shown.length ? <div className="rdCands">{shown.map((c) => (
          <div className="rdCand" key={c.id}>
            <span className={`ctype t-${c.type}`}>{TYPE_CN[c.type] || c.type}</span>
            <div className="cname">{c.name}</div>
            <div className="cdesc">{c.summary}</div>
            {c.type === "strategy" && c.payload && <div className="cparams"><span>{c.payload.templateId || "模板?"}</span><span>{c.payload.direction === "short" ? "做空" : "做多"}</span><span>{c.payload.timeframe || "?"}</span><span>止损 {c.payload.stop || "?"}</span></div>}
            {c.type === "workflow" && c.payload?.steps && <div className="cdesc rdMono" style={{ fontSize: 10.5 }}>{c.payload.steps.join(" → ")}</div>}
            <div className="csrc">《{c.sourceTitle}》{c.sourceRef ? ` · ${c.sourceRef}` : ""}</div>
            <div className="cbtns"><button className="ignore" onClick={() => action(`/api/knowledge/candidates/${c.id}/ignore`, {})}>忽略</button><button className="adopt" onClick={() => action(`/api/knowledge/candidates/${c.id}/adopt`, {})}>采纳</button></div>
          </div>
        ))}</div> : <div className="rdEmpty">暂无候选。选一本书点「生成候选」，系统读懂后产出策略/提示词/工作流，再逐条采纳。</div>}
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>已理解的知识</b><span className="rdCode">参考 · 折叠</span></div>
        <Fold title="交易方法草案" n={methods.length} open={openRef === "m"} onT={() => setOpenRef(openRef === "m" ? "" : "m")}>
          {methods.slice(0, 40).map((m) => <div className="rdLine" key={m.id}><div><b style={{ fontSize: 12.5 }}>{m.name}</b>{m.direction && <span style={{ marginLeft: 6, opacity: .6, fontSize: 11 }}>{m.direction === "short" ? "空" : "多"} · {m.timeframe || ""}</span>}</div>{m.source?.title && <span className="lsrc">《{m.source.title}》</span>}</div>)}
          {!methods.length && <div className="rdEmpty">导入书后自动蒸馏</div>}
        </Fold>
        <Fold title="风控纪律" n={rules.length} open={openRef === "r"} onT={() => setOpenRef(openRef === "r" ? "" : "r")}>
          {rules.slice(0, 40).map((r) => <div className="rdLine" key={r.id}><div><b style={{ fontSize: 12.5 }}>{r.name}</b>{r.status === "已批准" && <span style={{ marginLeft: 6, color: "var(--rd-good)", fontSize: 11 }}>已批准</span>}</div>{r.sourceTitle && <span className="lsrc">《{r.sourceTitle}》</span>}</div>)}
          {!rules.length && <div className="rdEmpty">暂无</div>}
        </Fold>
        <Fold title="概念图谱" n={concepts.length} open={openRef === "c"} onT={() => setOpenRef(openRef === "c" ? "" : "c")}>
          <ConceptGraph concepts={concepts} />
        </Fold>
      </div>
    </div>
  );
}

// ============ ② 能力与工具 ============
export function CapabilitiesPage({ data, action, ui }) {
  const k = data.knowledge || {};
  const skills = k.tradingSkills || [];
  const inUse = skills.filter((s) => ["active", "degraded"].includes(s.status));
  const pipeline = skills.filter((s) => !["active", "degraded", "retired", "superseded", "compile_failed"].includes(s.status));
  const lenses = (k.lenses || []).filter((l) => l.active);
  const workflows = (k.workflows || []).filter((w) => w.active);
  const tools = data.analysisEngine?.tools || [];
  const ext = data.skills || [];
  const mcp = data.mcpServers || [];
  const [pipeOpen, setPipeOpen] = useState(false);
  const retire = (s) => { if (window.confirm(`退役技能「${s.name}」？退役后不再参与决策。`)) action(`/api/knowledge/skills/${s.id}/retire`, { reason: "manual" }); };
  const skillRow = (s) => { const lm = s.liveMetrics || {}; const deg = s.status === "degraded"; return (
    <div className="rdCap" key={s.id}>
      <div className="cmain"><div className="cnm">{s.name}</div><div className="cmeta">{(s.spec?.symbolScope || ["*"]).join("/")} · {s.spec?.timeframe || ""} · {s.spec?.direction === "short" ? "空" : "多"}{s.sourceTitle ? ` · 《${s.sourceTitle}》` : ""}</div></div>
      {lm.trades ? <div className="rdMetrics"><div className="m"><b>{lm.trades}</b><span>笔</span></div><div className="m"><b>{lm.winRatePct}%</b><span>胜率</span></div><div className="m"><b>{lm.profitFactor ?? "-"}</b><span>盈亏因子</span></div></div> : <span className="cmeta">暂无成交</span>}
      <span className={`rdStatePill ${deg ? "deg" : "live"}`}>{deg ? "已降级" : "在用"}</span>
      <button className="rdEditBtn" onClick={() => retire(s)}>退役</button>
    </div>
  ); };
  return (
    <div className="rdPage">
      <div className="rdHead"><div><h1>能力与工具 <em>CAPABILITIES</em></h1><p>AI 现在拥有的所有手脚：采纳的能力(在用 + 真实成绩)、内置工具、外部插件。</p></div><button className="rdLink" onClick={() => ui.setActive("knowledgeBase")}>去知识库造能力 ›</button></div>

      <div className="rdCard"><div className="rdStatRow">
        <div className="rdStat"><b>{inUse.length}</b><span>在用能力</span></div>
        <div className="rdStat"><b>{lenses.length}</b><span>分析透镜</span></div>
        <div className="rdStat"><b>{workflows.length}</b><span>工作流</span></div>
        <div className="rdStat"><b>{tools.length}</b><span>内置工具</span></div>
        <div className="rdStat"><b>{ext.length + mcp.length}</b><span>外部插件/MCP</span></div>
      </div></div>

      <div className="rdCard">
        <div className="rdCardH"><b>我的能力</b><span className="rdCode">采纳即用 · 在用/表现</span><div className="rdR"><button className="rdEditBtn" onClick={() => ui.openPanel("skillImport")}>从想法建策略</button></div></div>
        <div className="rdCapSub">交易策略 · {inUse.length}</div>
        {inUse.length ? inUse.map(skillRow) : <div className="rdEmpty">暂无在用策略。去知识库采纳或从想法新建。</div>}
        {lenses.length > 0 && <><div className="rdCapSub">分析透镜 · {lenses.length}</div>{lenses.map((l) => <div className="rdCap" key={l.id}><div className="cmain"><div className="cnm">{l.name}</div><div className="cmeta">{l.promptText}</div></div>{l.sourceTitle && <span className="cmeta rdMono" style={{ flex: "none" }}>《{l.sourceTitle}》</span>}<span className="rdStatePill live">在用</span></div>)}</>}
        {workflows.length > 0 && <><div className="rdCapSub">工作流 · {workflows.length}</div>{workflows.map((w) => <div className="rdCap" key={w.id}><div className="cmain"><div className="cnm">{w.name}</div><div className="cmeta">{(w.steps || []).join(" → ")}</div></div><span className="rdStatePill live">在用</span></div>)}</>}
        {pipeline.length > 0 && <div style={{ marginTop: 14 }}><Fold title="流水线中(传统验证路径)" n={pipeline.length} open={pipeOpen} onT={() => setPipeOpen(!pipeOpen)}>{pipeline.map((s) => <div className="rdLine" key={s.id}><div><b style={{ fontSize: 12.5 }}>{s.name}</b></div><span className="lsrc">{SKILL_STATE[s.status]?.label || humanize(s.status)}</span></div>)}</Fold></div>}
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>内置工具</b><span className="rdCode">AI 天生会用 · 只读</span></div>
        <div className="rdToolGrid">{tools.map((t, i) => <div className="rdTool" key={t.name || i}><b>{t.name || String(t)}</b><span>{t.description || ""}</span></div>)}{!tools.length && <div className="rdEmpty">工具目录未同步</div>}</div>
      </div>

      <div className="rdCard">
        <div className="rdCardH"><b>外部插件 / MCP</b><span className="rdCode">Plugins</span><div className="rdR"><button className="rdEditBtn" onClick={() => ui.openPanel("skillImport")}>导入</button></div></div>
        {ext.map((s) => <div className="rdCap" key={s.id}><div className="cmain"><div className="cnm">{s.name}</div><div className="cmeta">{humanize(s.status)}</div></div></div>)}
        {mcp.map((m) => <div className="rdCap" key={m.id}><div className="cmain"><div className="cnm">{m.name || m.id}</div><div className="cmeta">MCP</div></div><span className={`rdStatePill ${m.status === "connected" ? "live" : "deg"}`}>{m.status === "connected" ? "已连接" : "未连接"}</span></div>)}
        {!ext.length && !mcp.length && <div className="rdEmpty">暂无外部插件</div>}
      </div>
    </div>
  );
}
