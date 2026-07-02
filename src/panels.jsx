import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Eye,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Hourglass,
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  PlugZap,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  SquareActivity,
  Target,
  Timer,
  TrendingUp,
  WalletCards,
  Zap
} from "lucide-react";
import { pageCopy, formatMoney, displayMoney, displayPct, pct, asArray, safeList, readFileAsDataUrl, formatDateTime, formatDate, formatTime, formatDuration, orderStatus, humanize, humanizeList, humanizePhase, shortId, statusTone, compactAction, systemStatus, exchangeState, useApi, PageHeader, Card, SectionTitle, MetricCard, MiniSparkline, CandleChart, LinePriceChart, StatusBadge, ProgressBar, DataTable, RiskLine, MiniChart } from "./lib.jsx";

export function ConfigPanel({ panel, data, action, ui }) {
  const titles = {
    mandate: "授权委托配置",
    riskRules: "风险规则管理",
    security: "API 与账户安全",
    ip: "IP 白名单",
    keys: "密钥权限",
    eventRule: "事件规则",
    knowledgeImport: "导入知识",
    knowledgeList: "知识来源",
    ruleLibrary: "规则库",
    skillImport: "导入 Skill",
    taskManager: "任务管理",
    marketIndicators: "市场指标",
    eventSources: "事件详情与来源",
    auditChain: "完整审计链",
    executionDetail: "执行详情",
    positions: "持仓详情"
  };
  return (
    <div className="panelOverlay" onClick={ui.closePanel}>
      <aside className="configPanel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>配置中心</span>
            <h2>{titles[panel] || "系统配置"}</h2>
          </div>
          <button className="secondaryButton" onClick={ui.closePanel}>关闭</button>
        </header>
        {panel === "mandate" && <MandatePanel data={data} action={action} />}
        {panel === "riskRules" && <RiskRulesPanel data={data} action={action} />}
        {panel === "security" && <SecurityPanel data={data} action={action} ui={ui} />}
        {panel === "ip" && <IpPanel data={data} action={action} />}
        {panel === "keys" && <KeysPanel action={action} />}
        {panel === "eventRule" && <EventRulePanel action={action} />}
        {panel === "knowledgeImport" && <KnowledgeImportPanel action={action} ui={ui} />}
        {panel === "knowledgeList" && <KnowledgeListPanel data={data} action={action} ui={ui} />}
        {panel === "ruleLibrary" && <RuleLibraryPanel data={data} action={action} ui={ui} />}
        {panel === "skillImport" && <SkillImportPanel data={data} action={action} ui={ui} />}
        {panel === "taskManager" && <TaskManagerPanel data={data} action={action} />}
        {panel === "marketIndicators" && <MarketIndicatorsPanel data={data} action={action} />}
        {panel === "eventSources" && <EventSourcesPanel data={data} action={action} ui={ui} />}
        {panel === "auditChain" && <AuditChainPanel data={data} />}
        {panel === "executionDetail" && <ExecutionDetailPanel data={data} />}
        {panel === "positions" && <PositionsPanel data={data} />}
      </aside>
    </div>
  );
}

export function MandatePanel({ data, action }) {
  const mandate = data.mandates?.[0] || {};
  const [form, setForm] = useState({
    name: mandate.name || "主账户授权委托",
    exchange: mandate.exchanges?.[0] || "BINANCE",
    allowedSymbols: safeList(mandate.allowedSymbols, "BTC/USDT, ETH/USDT"),
    maxLeverage: mandate.max_leverage || 1,
    singleRisk: mandate.maxSingleTradeRiskPct || 0.3,
    dailyLoss: mandate.maxDailyLossPct || 1,
    approval: mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 5000
  });
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    const symbols = asArray(form.allowedSymbols).map((item) => item.toUpperCase());
    const maxLeverage = Number(form.maxLeverage || 1);
    const body = {
      name: form.name,
      status: "active",
      exchanges: [form.exchange],
      marketTypes: ["perpetual_usdt"],
      allowedSymbols: symbols,
      strategies: ["manual_review"],
      maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, maxLeverage])),
      max_leverage: maxLeverage,
      maxSingleTradeRiskPct: Number(form.singleRisk || 0),
      maxDailyLossPct: Number(form.dailyLoss || 0),
      humanApprovalNotionalUsdt: Number(form.approval || 0),
      manual_approval_threshold_usdt: Number(form.approval || 0),
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    await action(mandate.id ? `/api/mandates/${mandate.id}` : "/api/mandates", body, mandate.id ? "PATCH" : "POST");
  }
  return (
    <form className="panelForm" onSubmit={submit}>
      <label>名称<input value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>交易所<select value={form.exchange} onChange={(event) => update("exchange", event.target.value)}><option>BINANCE</option><option>OKX</option></select></label>
      <label>交易对白名单<input value={form.allowedSymbols} onChange={(event) => update("allowedSymbols", event.target.value)} placeholder="BTC/USDT, ETH/USDT" /></label>
      <div className="formGrid">
        <label>最大杠杆<input type="number" min="1" value={form.maxLeverage} onChange={(event) => update("maxLeverage", event.target.value)} /></label>
        <label>单笔风险 %<input type="number" step="0.1" min="0" value={form.singleRisk} onChange={(event) => update("singleRisk", event.target.value)} /></label>
        <label>日亏损上限 %<input type="number" step="0.1" min="0" value={form.dailyLoss} onChange={(event) => update("dailyLoss", event.target.value)} /></label>
        <label>人工确认阈值 USDT<input type="number" min="0" value={form.approval} onChange={(event) => update("approval", event.target.value)} /></label>
      </div>
      <button className="primaryButton" type="submit">保存授权</button>
    </form>
  );
}

export function RiskRulesPanel({ data, action }) {
  const [newRule, setNewRule] = useState({ name: "", level: "L3", action: "block", description: "" });
  async function createRule(event) {
    event.preventDefault();
    await action("/api/risk/rules", { ...newRule, scope: "trade" });
    setNewRule({ name: "", level: "L3", action: "block", description: "" });
  }
  return (
    <div className="panelStack">
      {(data.riskRules || []).map((rule) => (
        <div className="panelItem" key={rule.id}>
          <div><strong>{rule.name}</strong><small>{rule.description}</small></div>
          <select defaultValue={rule.action} onChange={(event) => action(`/api/risk/rules/${rule.id}`, { action: event.target.value }, "PATCH")}><option value="block">阻断</option><option value="restrict">限制</option><option value="notify">通知</option><option value="kill_switch">熔断</option></select>
          <button className="secondaryButton" onClick={() => action(`/api/risk/rules/${rule.id}`, { enabled: !rule.enabled }, "PATCH")}>{rule.enabled ? "停用" : "启用"}</button>
        </div>
      ))}
      <form className="panelForm" onSubmit={createRule}>
        <h3>新增规则</h3>
        <label>规则名称<input value={newRule.name} onChange={(event) => setNewRule((current) => ({ ...current, name: event.target.value }))} placeholder="例如：高波动暂停新开仓" /></label>
        <label>说明<textarea value={newRule.description} onChange={(event) => setNewRule((current) => ({ ...current, description: event.target.value }))} /></label>
        <div className="formGrid">
          <label>等级<select value={newRule.level} onChange={(event) => setNewRule((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
          <label>动作<select value={newRule.action} onChange={(event) => setNewRule((current) => ({ ...current, action: event.target.value }))}><option value="notify">通知</option><option value="restrict">限制</option><option value="block">阻断</option><option value="kill_switch">熔断</option></select></label>
        </div>
        <button className="primaryButton" type="submit">创建规则</button>
      </form>
    </div>
  );
}

export function SecurityPanel({ data, action, ui }) {
  return (
    <div className="panelStack">
      {(data.exchangeAccounts || []).map((account) => <div className="panelItem" key={account.id}><div><strong>{account.exchange}</strong><small>{account.label}</small></div><StatusBadge tone={exchangeState(account).tone === "off" ? "warning" : "ok"}>{exchangeState(account).label}</StatusBadge><button className="secondaryButton" onClick={() => ui.openPanel("keys")}>配置密钥</button></div>)}
      <button className="primaryButton" onClick={() => action("/api/security/alerts", { severity: "info", title: "安全设置测试", body: "前端安全面板触发" })}>发送测试告警</button>
      <button className="secondaryButton" onClick={() => action("/api/security/drills/kill_switch", {})}>运行熔断演练</button>
    </div>
  );
}

export function IpPanel({ data, action }) {
  const [values, setValues] = useState(() => Object.fromEntries((data.exchangeAccounts || []).map((account) => [account.id, account.ipWhitelist || ""])));
  return (
    <div className="panelStack">
      {(data.exchangeAccounts || []).map((account) => (
        <form className="panelForm compact" key={account.id} onSubmit={(event) => { event.preventDefault(); action(`/api/exchange/accounts/${account.id}`, { ipWhitelist: values[account.id] }, "PATCH"); }}>
          <h3>{account.exchange}</h3>
          <label>IP 白名单<input value={values[account.id] || ""} onChange={(event) => setValues((current) => ({ ...current, [account.id]: event.target.value }))} placeholder="例如：1.2.3.4, 5.6.7.8" /></label>
          <button className="primaryButton" type="submit">保存 {account.exchange}</button>
        </form>
      ))}
    </div>
  );
}

export function KeysPanel({ action }) {
  return (
    <div className="panelStack">
      <ExchangeCredentialForm exchange="BINANCE" action={action} />
      <ExchangeCredentialForm exchange="OKX" action={action} />
    </div>
  );
}

export function ExchangeCredentialForm({ exchange, action }) {
  const needsPassphrase = exchange === "OKX";
  const [form, setForm] = useState({ apiKey: "", apiSecret: "", passphrase: "", ipWhitelist: "" });
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    await action("/api/security/exchange-credentials", { exchange, ...form });
    setForm({ apiKey: "", apiSecret: "", passphrase: "", ipWhitelist: form.ipWhitelist });
  }
  return (
    <form className="panelForm compact" onSubmit={submit}>
      <h3>{exchange} API</h3>
      <label>API Key<input type="password" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" /></label>
      <label>Secret<input type="password" value={form.apiSecret} onChange={(event) => update("apiSecret", event.target.value)} autoComplete="off" /></label>
      {needsPassphrase && <label>Passphrase<input type="password" value={form.passphrase} onChange={(event) => update("passphrase", event.target.value)} autoComplete="off" /></label>}
      <label>IP 白名单<input value={form.ipWhitelist} onChange={(event) => update("ipWhitelist", event.target.value)} placeholder="建议填写交易所绑定 IP" /></label>
      <button className="primaryButton" type="submit">保存 {exchange} 凭证</button>
    </form>
  );
}

export function EventRulePanel({ action }) {
  const [form, setForm] = useState({ name: "高影响事件前限制新开仓", description: "事件影响未评估前，限制高杠杆新开仓。", level: "L3" });
  return (
    <form className="panelForm" onSubmit={(event) => { event.preventDefault(); action("/api/risk/rules", { ...form, scope: "event", action: "restrict" }); }}>
      <label>规则名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label>说明<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
      <label>等级<select value={form.level} onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
      <button className="primaryButton" type="submit">创建事件规则</button>
    </form>
  );
}

export function KnowledgeImportPanel({ action, ui }) {
  const [mode, setMode] = useState("text");
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    title: "",
    domain: "交易策略",
    url: "",
    subPath: "",
    filePath: "",
    content: "",
    trustScore: 70,
    createRuleDraft: false
  });
  const modes = [
    ["text", "粘贴文本"],
    ["web", "网页链接"],
    ["upload", "上传文件"],
    ["path", "本地路径"],
    ["github", "GitHub"]
  ];
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    const common = {
      title: form.title.trim(),
      domain: form.domain,
      trustScore: Number(form.trustScore || 70),
      createRuleDraft: form.createRuleDraft
    };
    if (mode === "github") {
      if (!form.url.trim()) return ui.notify("请填写 GitHub 仓库地址");
      const result = await action("/api/knowledge/github-import", { repoUrl: form.url.trim(), subPath: form.subPath.trim() });
      if (result.status === "ok") ui.closePanel();
      return result;
    }
    const body = { ...common };
    if (mode === "text") {
      if (!form.content.trim()) return ui.notify("请粘贴知识文本");
      body.type = "text";
      body.content = form.content;
      body.fileName = `${form.title.trim() || "pasted-knowledge"}.md`;
    }
    if (mode === "web") {
      if (!form.url.trim()) return ui.notify("请填写网页链接");
      body.type = "web";
      body.url = form.url.trim();
    }
    if (mode === "path") {
      if (!form.filePath.trim()) return ui.notify("请填写本地文件路径");
      body.filePath = form.filePath.trim();
    }
    if (mode === "upload") {
      if (!file) return ui.notify("请选择 PDF、DOCX、MD 或 TXT 文件");
      body.fileName = file.name;
      body.title ||= file.name;
      body.fileBase64 = await readFileAsDataUrl(file);
    }
    const result = await action("/api/knowledge/import-real", body);
    if (result.source || result.parsed?.source) ui.closePanel();
    return result;
  }
  return (
    <form className="panelForm" onSubmit={submit}>
      <div className="modeTabs">{modes.map(([id, label]) => <button type="button" className={mode === id ? "active" : ""} key={id} onClick={() => setMode(id)}>{label}</button>)}</div>
      <div className="formGrid">
        <label>标题<input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：趋势交易笔记" /></label>
        <label>领域<input value={form.domain} onChange={(event) => update("domain", event.target.value)} placeholder="交易策略 / 风控 / 宏观" /></label>
      </div>
      {mode === "text" && <label>知识文本<textarea className="largeTextarea" value={form.content} onChange={(event) => update("content", event.target.value)} placeholder="粘贴 Markdown、交易规则、研究笔记或复盘内容" /></label>}
      {mode === "web" && <label>网页链接<input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://..." /></label>}
      {mode === "upload" && <label>上传文件<input type="file" accept=".pdf,.docx,.md,.txt,.json,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
      {mode === "path" && <label>本地文件路径<input value={form.filePath} onChange={(event) => update("filePath", event.target.value)} placeholder="/Users/ely/Desktop/xxx.pdf" /></label>}
      {mode === "github" && (
        <>
          <label>GitHub 仓库<input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://github.com/user/repo.git" /></label>
          <label>子目录<input value={form.subPath} onChange={(event) => update("subPath", event.target.value)} placeholder="可留空" /></label>
        </>
      )}
      <div className="formGrid">
        <label>可信度<input type="number" min="1" max="100" value={form.trustScore} onChange={(event) => update("trustScore", event.target.value)} /></label>
        <label className="checkboxLabel"><input type="checkbox" checked={form.createRuleDraft} onChange={(event) => update("createRuleDraft", event.target.checked)} /> 生成规则草案</label>
      </div>
      <button className="primaryButton" type="submit">导入并解析</button>
    </form>
  );
}

export function KnowledgeListPanel({ data, action, ui }) {
  const knowledge = data.knowledge || {};
  const sources = knowledge.sources || [];
  return (
    <div className="panelStack">
      {!sources.length && (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有知识来源</strong>
          <button className="primaryButton" onClick={() => ui.openPanel("knowledgeImport")}>导入知识</button>
        </div>
      )}
      {sources.map((source) => {
        const chunkCount = (knowledge.chunks || []).filter((chunk) => chunk.sourceId === source.id).length;
        return (
          <div className="panelItem" key={source.id}>
            <div><strong>{source.title}</strong><small>{source.domain || source.type} · {chunkCount} 个片段 · {formatDateTime(source.importedAt, "未记录")}</small></div>
            <StatusBadge tone={source.status === "parsed" ? "ok" : "warning"}>{humanize(source.status)}</StatusBadge>
            <button className="secondaryButton" onClick={() => action(`/api/knowledge/sources/${source.id}/parse-real`, {})}>{source.status === "parsed" ? "重新解析" : "解析"}</button>
          </div>
        );
      })}
    </div>
  );
}

export function RuleLibraryPanel({ data, action, ui }) {
  const knowledge = data.knowledge || {};
  const [newRule, setNewRule] = useState({ name: "", description: "", level: "L2", action: "notify" });
  async function createRule(event) {
    event.preventDefault();
    await action("/api/knowledge/rules/proposals", newRule);
    setNewRule({ name: "", description: "", level: "L2", action: "notify" });
  }
  return (
    <div className="panelStack">
      {!(knowledge.ruleProposals || []).length && (
        <div className="emptyPanel emptyPanelAction">
          <strong>还没有规则草案</strong>
          <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>从知识生成</button>
        </div>
      )}
      {(knowledge.ruleProposals || []).map((rule) => (
        <div className="panelItem" key={rule.id}>
          <div><strong>{rule.name}</strong><small>{rule.description || "基于专家知识库生成"} · {rule.level}</small></div>
          <StatusBadge tone={rule.status === "已批准" ? "ok" : "warning"}>{humanize(rule.status, "待审批")}</StatusBadge>
          <button className="secondaryButton" onClick={() => rule.status === "已批准" ? ui.openPanel("riskRules") : action(`/api/knowledge/rules/${rule.id}/approve`, { approved: true })}>{rule.status === "已批准" ? "看风控" : "批准"}</button>
        </div>
      ))}
      <form className="panelForm compact" onSubmit={createRule}>
        <h3>新增规则草案</h3>
        <label>名称<input value={newRule.name} onChange={(event) => setNewRule((current) => ({ ...current, name: event.target.value }))} placeholder="例如：重大事件前禁止高杠杆" /></label>
        <label>说明<textarea value={newRule.description} onChange={(event) => setNewRule((current) => ({ ...current, description: event.target.value }))} /></label>
        <div className="formGrid">
          <label>等级<select value={newRule.level} onChange={(event) => setNewRule((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
          <label>动作<select value={newRule.action} onChange={(event) => setNewRule((current) => ({ ...current, action: event.target.value }))}><option value="notify">通知</option><option value="restrict">限制</option><option value="block">阻断</option><option value="kill_switch">熔断</option></select></label>
        </div>
        <button className="primaryButton" type="submit">提交草案</button>
      </form>
    </div>
  );
}

export function SkillImportPanel({ data, action, ui }) {
  const [form, setForm] = useState({ name: "", sourceUrl: "", skillMd: "" });
  async function submit(event) {
    event.preventDefault();
    if (!form.sourceUrl.trim() && !form.skillMd.trim()) return ui.notify("请填写 GitHub/URL 或粘贴 Skill.md");
    await action("/api/skills/fetch", { name: form.name.trim(), sourceUrl: form.sourceUrl.trim(), skillMd: form.skillMd });
    setForm({ name: "", sourceUrl: "", skillMd: "" });
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <label>Skill 名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="可留空，自动读取 SKILL.md 标题" /></label>
        <label>GitHub / Skill.md URL<input value={form.sourceUrl} onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://github.com/user/skill 或 https://.../SKILL.md" /></label>
        <label>Skill.md 内容<textarea className="largeTextarea" value={form.skillMd} onChange={(event) => setForm((current) => ({ ...current, skillMd: event.target.value }))} placeholder="# Skill Name" /></label>
        <button className="primaryButton" type="submit">导入 Skill</button>
      </form>
      {(data.skills || []).map((skill) => (
        <div className="panelItem" key={skill.id}>
          <div><strong>{skill.name}</strong><small>{skill.source || "uploaded"} · v{skill.version}</small></div>
          <StatusBadge tone={skill.status === "已启用" ? "ok" : "warning"}>{skill.status}</StatusBadge>
          <button className="secondaryButton" onClick={() => action(`/api/skills/${skill.id}/${skill.scan === "已扫描" ? "install" : "scan"}`, {})}>{skill.scan === "已扫描" ? "安装" : "扫描"}</button>
        </div>
      ))}
    </div>
  );
}

export function TaskManagerPanel({ data, action }) {
  const [form, setForm] = useState({ name: "", type: "Every", schedule: "Every 5m", role: "风控" });
  function updateType(type) {
    const schedule = type === "Cron" ? "*/5 * * * *" : type === "At" ? new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16) : "Every 5m";
    setForm((current) => ({ ...current, type, schedule }));
  }
  async function submit(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const schedule = form.type === "At" ? new Date(form.schedule).toISOString() : form.schedule.trim();
    await action("/api/tasks", { ...form, name, schedule, enabled: true });
    setForm({ name: "", type: form.type, schedule: form.schedule, role: form.role });
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <label>任务名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：行情扫描 / 知识过期检查" /></label>
        <div className="formGrid">
          <label>触发类型<select value={form.type} onChange={(event) => updateType(event.target.value)}><option>Every</option><option>Cron</option><option>At</option></select></label>
          <label>任务分类<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} /></label>
        </div>
        <label>{form.type === "At" ? "运行时间" : "触发表达式"}<input type={form.type === "At" ? "datetime-local" : "text"} value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} /></label>
        <button className="primaryButton" type="submit">创建任务</button>
      </form>
      {(data.tasks || []).map((task) => (
        <div className="panelItem" key={task.id}>
          <div><strong>{task.name}</strong><small>{task.schedule || "-"} · 下次 {formatDateTime(task.nextRunAt, "未排期")}</small></div>
          <StatusBadge tone={task.enabled === false ? "warning" : "ok"}>{task.enabled === false ? "已暂停" : humanize(task.status, "运行中")}</StatusBadge>
          <span className="panelActions"><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button><button className="secondaryButton dangerText" onClick={() => action(`/api/tasks/${task.id}`, {}, "DELETE")}>删除</button></span>
        </div>
      ))}
      {!data.tasks?.length && <div className="emptyPanel emptyPanelAction"><strong>暂无任务</strong><span>创建任务后会进入调度器，并在运行日志中留下记录。</span></div>}
    </div>
  );
}

export function MarketIndicatorsPanel({ data, action }) {
  const markets = data.markets || [];
  return (
    <div className="panelStack">
      {markets.map((market) => (
        <div className="panelItem" key={market.symbol}>
          <div><strong>{market.symbol}</strong><small>状态 {humanize(market.status, "未同步")} · K 线 {market.candles?.length || 0} 根</small></div>
          <StatusBadge tone={market.status === "synced" ? "ok" : "warning"}>{market.price ? `${displayMoney(market.price)} USDT` : "未同步"}</StatusBadge>
          <button className="secondaryButton" onClick={() => action(`/api/exchange/BINANCE/ticker?symbol=${encodeURIComponent(market.symbol)}`, {}, "GET")}>同步</button>
        </div>
      ))}
      <div className="panelForm compact">
        <h3>当前可用指标</h3>
        <RiskLine label="24h 涨跌幅" value={displayPct(data.activeMarket?.changePct)} />
        <RiskLine label="资金费率" value={data.activeMarket?.fundingRate || "未同步"} />
        <RiskLine label="持仓量 OI" value={data.activeMarket?.openInterest ? `${data.activeMarket.openInterest} USDT` : "未同步"} />
        <RiskLine label="波动率" value={data.activeMarket?.candles?.length ? "待计算" : "需先同步 K 线"} />
      </div>
    </div>
  );
}

export function EventSourcesPanel({ data, action, ui }) {
  const [form, setForm] = useState({ name: "", type: "rss", url: "", trustScore: 80 });
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) {
      ui.notify("请填写事件源名称和 URL");
      return;
    }
    await action("/api/event-sources", { ...form, trustScore: Number(form.trustScore || 80) });
    setForm({ name: "", type: form.type, url: "", trustScore: form.trustScore });
  }
  return (
    <div className="panelStack">
      <button className="primaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> 刷新事件源</button>
      {(data.events || []).slice(0, 5).map((event) => (
        <div className="panelItem" key={event.id}>
          <div><strong>{event.title}</strong><small>{event.category || "事件"} · {event.due || "待定"}</small></div>
          <StatusBadge tone={event.impact >= 80 ? "danger" : "warning"}>{event.impactLabel || "待评估"}</StatusBadge>
          <button className="secondaryButton" onClick={() => action(`/api/events/${event.id}/progress`, { note: "人工查看后标记进度" })}>标记</button>
        </div>
      ))}
      {!data.events?.length && <div className="emptyPanel emptyPanelAction"><strong>暂无事件卡</strong><span>刷新事件源后会生成真实事件卡。</span></div>}
      <form className="panelForm compact" onSubmit={submit}>
        <h3>新增事件源</h3>
        <label>名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：交易所公告 / 宏观日历 RSS" /></label>
        <label>URL<input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." /></label>
        <div className="formGrid">
          <label>类型<select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="rss">RSS</option><option value="html">HTML</option><option value="json">JSON</option></select></label>
          <label>可信度<input type="number" min="1" max="100" value={form.trustScore} onChange={(event) => setForm((current) => ({ ...current, trustScore: event.target.value }))} /></label>
        </div>
        <button className="primaryButton" type="submit">保存事件源</button>
      </form>
    </div>
  );
}

export function AuditChainPanel({ data }) {
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const chainItems = [
    ["授权任务", latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, "未授权")],
    ["分析包", latestPlan.analysisBundleId, latestPlan.analysisBundleId ? "已生成" : "未生成"],
    ["交易计划", latestPlan.id, humanize(latestPlan.status, "未生成")],
    ["风险校验", latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, "未检查")],
    ["执行", latestOrder.id, humanize(latestOrder.status, "真实写关闭")],
    ["结算对账", data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, "未对账")],
    ["复盘审查", data.reviews?.[0]?.id, data.reviews?.[0]?.id ? "已记录" : "未生成"]
  ];
  return (
    <div className="panelStack">
      {chainItems.map(([label, value, state], index) => (
        <div className="panelItem" key={label}>
          <div><strong>{index + 1}. {label}</strong><small>{value || "未生成 ID"}</small></div>
          <StatusBadge tone={statusTone(state)}>{state}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

export function ExecutionDetailPanel({ data }) {
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  return (
    <div className="panelStack">
      <div className="panelForm compact">
        <RiskLine label="订单 ID" value={latestOrder.id || "未生成"} />
        <RiskLine label="交易计划 ID" value={latestPlan.id || "未生成"} />
        <RiskLine label="风险校验 ID" value={latestPlan.riskCheckId || latestRisk.id || "未生成"} />
        <RiskLine label="交易对" value={latestPlan.symbol || latestOrder.symbol || "-"} />
        <RiskLine label="方向 / 类型" value={`${humanize(latestPlan.direction || latestOrder.side, "-")} / ${humanize(latestOrder.type || latestPlan.entry?.type, "-")}`} />
        <RiskLine label="执行状态" value={humanize(latestOrder.status, "真实写操作关闭")} />
        <RiskLine label="对账结果" value={humanize(data.reconciliationReports?.[0]?.status, "未对账")} />
      </div>
      {!latestOrder.id && !latestPlan.id && <div className="emptyPanel emptyPanelAction"><strong>暂无执行对象</strong><span>生成交易计划并通过风控后，这里会展示订单、风控和对账详情。</span></div>}
    </div>
  );
}

export function PositionsPanel({ data }) {
  const positions = data.positions || [];
  return (
    <div className="panelStack">
      {positions.map((position) => (
        <div className="panelForm compact" key={position.id}>
          <h3>{position.symbol}</h3>
          <RiskLine label="方向" value={position.direction || "-"} />
          <RiskLine label="数量" value={position.size || "-"} />
          <RiskLine label="开仓均价" value={position.entry ? formatMoney(position.entry) : "-"} />
          <RiskLine label="标记价格" value={position.mark ? formatMoney(position.mark) : "-"} />
          <RiskLine label="未实现盈亏" value={position.pnl ? formatMoney(position.pnl) : "-"} />
        </div>
      ))}
      {!positions.length && <div className="emptyPanel emptyPanelAction"><strong>暂无真实持仓</strong><span>配置只读 API 并完成同步后，这里会展示交易所持仓明细。</span></div>}
    </div>
  );
}
