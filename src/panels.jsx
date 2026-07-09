import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash2,
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  CheckCircle2,
  XCircle,
  BrainCircuit,
  CalendarClock,
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
import { pageCopy, apiUrl, formatMoney, displayMoney, displayPct, pct, asArray, safeList, readFileAsDataUrl, formatDateTime, formatDate, formatTime, formatDuration, orderStatus, humanize, humanizeList, humanizePhase, shortId, statusTone, compactAction, systemStatus, exchangeState, useApi, PageHeader, Card, SectionTitle, MetricCard, MiniSparkline, CandleChart, LinePriceChart, StatusBadge, ProgressBar, DataTable, RiskLine, MiniChart, InsightNote } from "./lib.jsx";

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
            <h2>{titles[panel] || "系统设置"}</h2>
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

// 系统配置各分区的统一头部（图标 + 标题 + 说明 + 状态），与其他页面的卡片头风格一致。
function CfgHead({ icon: Icon, title, sub, status, statusTone = "" }) {
  return (
    <div className="cfgHead">
      <span className="cfgHeadIcon">{Icon && <Icon size={16} />}</span>
      <div className="cfgHeadText"><b>{title}</b>{sub && <small>{sub}</small>}</div>
      {status && <span className={`cfgHeadStatus ${statusTone}`}>{status}</span>}
    </div>
  );
}

export function SystemConfigPanel({ data, action, ui, section }) {
  const config = data.config || {};
  const providers = config.llm?.providers || {};
  const exchange = config.exchange || {};
  const live = config.liveTrading || {};
  const integrations = config.integrations || {};
  const runtime = config.runtime || {};
  const readiness = data.readiness || {};
  const [llmForm, setLlmForm] = useState({
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: providers.anthropic?.model || "claude-sonnet-4-5",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: providers.openai?.model || "gpt-5.2",
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_MODEL: providers.deepseek?.model || "deepseek-chat",
    GEMINI_API_KEY: "",
    GEMINI_MODEL: providers.gemini?.model || "gemini-2.5-pro"
  });
  const [exchangeForm, setExchangeForm] = useState({
    BINANCE_API_KEY: "",
    BINANCE_API_SECRET: "",
    OKX_API_KEY: "",
    OKX_API_SECRET: "",
    OKX_API_PASSPHRASE: "",
    BINANCE_IP_WHITELIST: (data.exchangeAccounts || []).find((item) => item.exchange === "BINANCE")?.ipWhitelist || "",
    OKX_IP_WHITELIST: (data.exchangeAccounts || []).find((item) => item.exchange === "OKX")?.ipWhitelist || "",
    OKX_MARGIN_MODE: data.runtimeConfig?.OKX_MARGIN_MODE || "cross",
    OKX_POSITION_MODE: data.runtimeConfig?.OKX_POSITION_MODE || "net",
    BINANCE_MARGIN_MODE: data.runtimeConfig?.BINANCE_MARGIN_MODE || "cross",
    BINANCE_POSITION_MODE: data.runtimeConfig?.BINANCE_POSITION_MODE || "one_way"
  });
  const [liveForm, setLiveForm] = useState({
    liveTradingEnabled: Boolean(live.liveTradingEnabled),
    acknowledged: Boolean(live.acknowledged),
    orderWriteEnabled: Boolean(live.orderWriteEnabled),
    grayEnabled: Boolean(live.grayEnabled),
    grayRequiresApproval: live.grayRequiresApproval !== false,
    maxNotionalUsdt: live.maxNotionalUsdt || 50
  });
  const [integrationForm, setIntegrationForm] = useState({
    LANGSMITH_API_KEY: "",
    LANGSMITH_ENDPOINT: integrations.langsmith?.endpoint || "https://api.smith.langchain.com",
    LANGSMITH_PROJECT: integrations.langsmith?.project || "trading-agent",
    ETHERSCAN_API_KEY: "",
    BRAVE_SEARCH_API_KEY: "",
    TAVILY_API_KEY: "",
    SERPAPI_API_KEY: "",
    ALERT_WEBHOOK_URL: "",
    LARK_WEBHOOK_URL: "",
    LARK_WEBHOOK_SECRET: "",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_CHAT_ID: integrations.telegram?.chatId || "",
    TELEGRAM_PROFIT_POSTER_ENABLED: integrations.telegram?.profitPosterEnabled ? "true" : "false",
    TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT: integrations.telegram?.minPnlUsdt ?? 0,
    TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT: integrations.telegram?.minRoiPct ?? 0,
    TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES: integrations.telegram?.cooldownMinutes ?? 240
  });
  const [runtimeForm, setRuntimeForm] = useState({
    ADMIN_PASSWORD: "",
    AUTH_REQUIRED: runtime.authRequired === false ? "false" : "true",
    SKILL_SANDBOX_IMAGE: runtime.skillSandboxImage || "node:20-alpine",
    REALTIME_RECONCILER_ENABLED: runtime.realtimeReconcilerEnabled ? "true" : "false",
    BINANCE_MARKET_TYPE: runtime.binanceMarketType || "spot",
    OKX_MARKET_TYPE: runtime.okxMarketType || "perpetual_swap",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    PORT: runtime.port || "8787"
  });
  const providerRows = [
    ["anthropic", "Anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
    ["openai", "OpenAI", "OPENAI_API_KEY", "OPENAI_MODEL"],
    ["deepseek", "DeepSeek", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"],
    ["gemini", "Gemini（预留）", "GEMINI_API_KEY", "GEMINI_MODEL"]
  ];
  const secretRows = [
    ["BINANCE_API_KEY", "Binance API Key", exchange.binance?.hasKey],
    ["BINANCE_API_SECRET", "Binance Secret", exchange.binance?.hasSecret],
    ["OKX_API_KEY", "OKX API Key", exchange.okx?.hasKey],
    ["OKX_API_SECRET", "OKX Secret", exchange.okx?.hasSecret],
    ["OKX_API_PASSPHRASE", "OKX Passphrase", exchange.okx?.hasPassphrase]
  ];
  const langsmithSecretRows = [["LANGSMITH_API_KEY", "LangSmith API Key", integrations.langsmith?.hasKey]];
  const dataSourceSecretRows = [
    ["ETHERSCAN_API_KEY", "Etherscan API Key", integrations.etherscan?.hasKey],
    ["BRAVE_SEARCH_API_KEY", "Brave Search API Key", integrations.search?.brave?.hasKey],
    ["TAVILY_API_KEY", "Tavily API Key", integrations.search?.tavily?.hasKey],
    ["SERPAPI_API_KEY", "SerpAPI API Key", integrations.search?.serpapi?.hasKey]
  ];
  const alertSecretRows = [["ALERT_WEBHOOK_URL", "告警 Webhook URL", integrations.alerts?.hasWebhook]];
  const integrationSecretRows = [...langsmithSecretRows, ...dataSourceSecretRows, ...alertSecretRows];
  const larkSecretRows = [
    ["LARK_WEBHOOK_URL", "飞书机器人 Webhook URL", integrations.lark?.hasWebhook],
    ["LARK_WEBHOOK_SECRET", "飞书签名密钥（可选）", integrations.lark?.signed]
  ];
  const telegramSecretRows = [
    ["TELEGRAM_BOT_TOKEN", "Telegram Bot Token", integrations.telegram?.hasBotToken]
  ];
  const runtimeSecretRows = [
    ["ADMIN_PASSWORD", "管理员登录密码", runtime.adminPasswordSet],
    ["HTTP_PROXY", "HTTP Proxy", runtime.httpProxySet],
    ["HTTPS_PROXY", "HTTPS Proxy", runtime.httpsProxySet]
  ];
  const [activeConfigSection, setActiveConfigSection] = useState(section || "llm");
  const [openProvider, setOpenProvider] = useState(config.llm?.activeProvider || "anthropic");
  const [openExchange, setOpenExchange] = useState("binance");
  const sectionHeadProps = (open, setOpen, id) => (section ? { role: "button", onClick: () => setOpen(open === id ? "" : id) } : {});
  const [activeIntegrationModule, setActiveIntegrationModule] = useState("telegram");
  const configSections = [
    { id: "llm", icon: BrainCircuit, title: "模型", sub: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : "未配置" },
    { id: "exchange", icon: WalletCards, title: "交易所", sub: [exchange.binance?.hasKey && "Binance", exchange.okx?.hasKey && "OKX"].filter(Boolean).join("、") || "未配置" },
    { id: "live", icon: Zap, title: "实盘灰度", sub: live.effective ? "已开启" : "关闭" },
    { id: "integrations", icon: PlugZap, title: "外部服务", sub: integrations.telegram?.configured ? "TG 已接入" : integrations.lark?.hasWebhook ? "飞书已接入" : (integrations.langsmith?.hasKey || integrations.alerts?.hasWebhook ? "部分已配置" : "未配置") },
    { id: "runtime", icon: Settings, title: "运行参数", sub: runtime.authRequired === false ? "免登录" : "鉴权开启" }
  ];
  const integrationModules = [
    { id: "telegram", icon: Bell, title: "Telegram 海报", sub: "盈利仓位群推送", done: integrations.telegram?.configured },
    { id: "lark", icon: PlugZap, title: "飞书通知", sub: "关键交易事件提醒", done: integrations.lark?.hasWebhook },
    { id: "langsmith", icon: BrainCircuit, title: "LangSmith", sub: "Agent Trace 观测", done: integrations.langsmith?.hasKey },
    { id: "data", icon: Globe2, title: "数据与搜索", sub: "链上与搜索 API", done: dataSourceSecretRows.some(([, , configured]) => configured) },
    { id: "alerts", icon: AlertTriangle, title: "告警 Webhook", sub: "外部告警转发", done: integrations.alerts?.hasWebhook }
  ];
  function updateLlm(key, value) {
    setLlmForm((current) => ({ ...current, [key]: value }));
  }
  function updateExchange(key, value) {
    setExchangeForm((current) => ({ ...current, [key]: value }));
  }
  function updateLive(key, value) {
    setLiveForm((current) => ({ ...current, [key]: value }));
  }
  function updateIntegration(key, value) {
    setIntegrationForm((current) => ({ ...current, [key]: value }));
  }
  function updateRuntime(key, value) {
    setRuntimeForm((current) => ({ ...current, [key]: value }));
  }
  async function saveLlm(event) {
    event.preventDefault();
    const body = {};
    for (const [, , keyName, modelName] of providerRows) {
      if (llmForm[keyName]) body[keyName] = llmForm[keyName];
      body[modelName] = llmForm[modelName];
    }
    const result = await action("/api/config", body);
    if (result.status) setLlmForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.endsWith("_API_KEY") ? "" : value])));
  }
  async function saveExchange(event) {
    event.preventDefault();
    const body = {
      OKX_MARGIN_MODE: exchangeForm.OKX_MARGIN_MODE,
      OKX_POSITION_MODE: exchangeForm.OKX_POSITION_MODE,
      BINANCE_MARGIN_MODE: exchangeForm.BINANCE_MARGIN_MODE,
      BINANCE_POSITION_MODE: exchangeForm.BINANCE_POSITION_MODE
    };
    for (const [keyName] of secretRows) {
      if (exchangeForm[keyName]) body[keyName] = exchangeForm[keyName];
    }
    const result = await action("/api/config", body);
    const binanceAccount = (data.exchangeAccounts || []).find((item) => item.exchange === "BINANCE");
    const okxAccount = (data.exchangeAccounts || []).find((item) => item.exchange === "OKX");
    if (binanceAccount && exchangeForm.BINANCE_IP_WHITELIST !== binanceAccount.ipWhitelist) {
      await action(`/api/exchange/accounts/${binanceAccount.id}`, { ipWhitelist: exchangeForm.BINANCE_IP_WHITELIST }, "PATCH");
    }
    if (okxAccount && exchangeForm.OKX_IP_WHITELIST !== okxAccount.ipWhitelist) {
      await action(`/api/exchange/accounts/${okxAccount.id}`, { ipWhitelist: exchangeForm.OKX_IP_WHITELIST }, "PATCH");
    }
    if (result.status) setExchangeForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.includes("API") || key.includes("SECRET") || key.includes("PASSPHRASE") ? "" : value])));
  }
  async function saveLive(event) {
    event.preventDefault();
    if (liveForm.liveTradingEnabled && !liveForm.acknowledged) {
      ui.notify("开启实盘前必须勾选风险确认");
      return;
    }
    await action("/api/config/live-trading", {
      ...liveForm,
      maxNotionalUsdt: Number(liveForm.maxNotionalUsdt || 50)
    });
  }
  async function saveIntegrations(event) {
    event.preventDefault();
    const body = {
      LANGSMITH_ENDPOINT: integrationForm.LANGSMITH_ENDPOINT,
      LANGSMITH_PROJECT: integrationForm.LANGSMITH_PROJECT,
      TELEGRAM_CHAT_ID: integrationForm.TELEGRAM_CHAT_ID,
      TELEGRAM_PROFIT_POSTER_ENABLED: integrationForm.TELEGRAM_PROFIT_POSTER_ENABLED,
      TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT: String(Number(integrationForm.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT || 0)),
      TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT: String(Number(integrationForm.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT || 0)),
      TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES: String(Number(integrationForm.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES || 240))
    };
    for (const [keyName] of [...integrationSecretRows, ...larkSecretRows, ...telegramSecretRows]) {
      if (integrationForm[keyName]) body[keyName] = integrationForm[keyName];
    }
    const result = await action("/api/config", body);
    if (result.status) setIntegrationForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.endsWith("_KEY") || key === "ALERT_WEBHOOK_URL" || key.startsWith("LARK_") || key === "TELEGRAM_BOT_TOKEN" ? "" : value])));
  }
  async function saveRuntime(event) {
    event.preventDefault();
    const body = {
      AUTH_REQUIRED: runtimeForm.AUTH_REQUIRED,
      SKILL_SANDBOX_IMAGE: runtimeForm.SKILL_SANDBOX_IMAGE,
      REALTIME_RECONCILER_ENABLED: runtimeForm.REALTIME_RECONCILER_ENABLED,
      BINANCE_MARKET_TYPE: runtimeForm.BINANCE_MARKET_TYPE,
      OKX_MARKET_TYPE: runtimeForm.OKX_MARKET_TYPE,
      PORT: runtimeForm.PORT
    };
    for (const [keyName] of runtimeSecretRows) {
      if (runtimeForm[keyName]) body[keyName] = runtimeForm[keyName];
    }
    const result = await action("/api/config", body);
    if (result.status) setRuntimeForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, ["ADMIN_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY"].includes(key) ? "" : value])));
  }
  function removeSecret(keyName) {
    return action(`/api/config/secret/${encodeURIComponent(keyName)}`, {}, "DELETE");
  }
  return (
    <div className="settingsConsole">
      {!section && (
        <nav className="settingsNav" aria-label="系统设置分类">
          {configSections.map((item) => {
            const Icon = item.icon;
            return (
              <button type="button" className={activeConfigSection === item.id ? "active" : ""} key={item.id} onClick={() => setActiveConfigSection(item.id)}>
                <Icon size={17} />
                <span>{item.title}</span>
                <small>{item.sub}</small>
              </button>
            );
          })}
        </nav>
      )}

      <div className="settingsWorkspace">

        {activeConfigSection === "llm" && (
          <form className="panelForm" onSubmit={saveLlm}>
            <CfgHead icon={BrainCircuit} title="AI 模型 API" sub="驱动 Agent 分析与决策的大模型；对话与自主巡检都用当前启用的 provider" status={config.llm?.activeProvider ? `使用中 · ${config.llm.activeProvider}` : "未配置"} statusTone={config.llm?.activeProvider ? "ok" : ""} />
            <div className="providerGrid">
              {providerRows.map(([idName, label, keyName, modelName]) => {
                const collapsed = Boolean(section) && openProvider !== idName;
                return (
                  <div className={`configFieldset ${collapsed ? "collapsed" : ""} ${idName === config.llm?.activeProvider ? "cfgActive" : ""}`} key={idName}>
                    <div
                      className="configFieldsetHead"
                      role={section ? "button" : undefined}
                      onClick={section ? () => setOpenProvider(openProvider === idName ? "" : idName) : undefined}
                    >
                      <span className="cfgProvLogo" data-p={idName}>{label.charAt(0)}</span>
                      <strong>{label}</strong>
                      {idName === config.llm?.activeProvider && <span className="cfgUsing">使用中</span>}
                      <StatusBadge tone={providers[idName]?.hasKey ? "ok" : "neutral"}>{providers[idName]?.hasKey ? "已配置" : "未配置"}</StatusBadge>
                      {section && <ChevronDown size={15} style={{ transform: collapsed ? "none" : "rotate(180deg)" }} />}
                    </div>
                    {!collapsed && (
                      <>
                        <label>API Key<input type="password" autoComplete="off" value={llmForm[keyName]} onChange={(event) => updateLlm(keyName, event.target.value)} placeholder={providers[idName]?.hasKey ? "留空则保留现有密钥" : "粘贴 API Key"} /></label>
                        <label>模型<input value={llmForm[modelName]} onChange={(event) => updateLlm(modelName, event.target.value)} /></label>
                        {providers[idName]?.hasKey && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除 {label} Key</button>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <button className="primaryButton" type="submit"><KeyRound size={14} /> 保存模型配置</button>
          </form>
        )}

        {activeConfigSection === "exchange" && (
          <form className="panelForm" onSubmit={saveExchange}>
            <CfgHead icon={WalletCards} title="交易所密钥与账户安全" sub="只读密钥用于同步账户与行情；实盘下单另需在「实盘灰度」开启。绝不勾选提币权限" status="仅读写交易，禁提币" statusTone="warn" />
            <div className="exchangeColumns">
              <div className="exchangeCol">
                <div className="exchangeColHead" {...sectionHeadProps(openExchange, setOpenExchange, "binance")}><span className="exchangeLogo binance">◆</span><strong>Binance</strong><StatusBadge tone={exchange.binance?.hasSecret ? "ok" : "neutral"}>{exchange.binance?.hasSecret ? "读写就绪" : exchange.binance?.hasKey ? "仅 Key" : "未配置"}</StatusBadge>{section && <ChevronDown size={15} style={{ transform: openExchange === "binance" ? "rotate(180deg)" : "none" }} />}</div>
                {(!section || openExchange === "binance") && (
                  <>
                    <label>API Key<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.BINANCE_API_KEY} onChange={(event) => updateExchange("BINANCE_API_KEY", event.target.value)} placeholder={exchange.binance?.hasKey ? "留空则保留现有密钥" : "待配置"} />{exchange.binance?.hasKey && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("BINANCE_API_KEY")}>移除</button>}</span></label>
                    <label>Secret<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.BINANCE_API_SECRET} onChange={(event) => updateExchange("BINANCE_API_SECRET", event.target.value)} placeholder={exchange.binance?.hasSecret ? "留空则保留现有密钥" : "待配置"} />{exchange.binance?.hasSecret && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("BINANCE_API_SECRET")}>移除</button>}</span></label>
                    <label>IP 白名单<input value={exchangeForm.BINANCE_IP_WHITELIST} onChange={(event) => updateExchange("BINANCE_IP_WHITELIST", event.target.value)} placeholder="建议填写交易所绑定 IP" /></label>
                    <div className="formGrid">
                      <label>保证金模式<select value={exchangeForm.BINANCE_MARGIN_MODE} onChange={(event) => updateExchange("BINANCE_MARGIN_MODE", event.target.value)}><option value="cross">cross 全仓</option><option value="isolated">isolated 逐仓</option></select></label>
                      <label>持仓模式<select value={exchangeForm.BINANCE_POSITION_MODE} onChange={(event) => updateExchange("BINANCE_POSITION_MODE", event.target.value)}><option value="one_way">单向</option><option value="hedge">双向对冲</option></select></label>
                    </div>
                    <small className="fieldHint">Binance 无 Passphrase（认证仅 Key+Secret）；保证金/持仓模式仅在 Binance 合约交易时生效。</small>
                  </>
                )}
              </div>
              <div className="exchangeCol">
                <div className="exchangeColHead" {...sectionHeadProps(openExchange, setOpenExchange, "okx")}><span className="exchangeLogo okx">✣</span><strong>OKX</strong><StatusBadge tone={exchange.okx?.hasSecret && exchange.okx?.hasPassphrase ? "ok" : "neutral"}>{exchange.okx?.hasSecret && exchange.okx?.hasPassphrase ? "读写就绪" : exchange.okx?.hasKey ? "缺 Secret/Passphrase" : "未配置"}</StatusBadge>{section && <ChevronDown size={15} style={{ transform: openExchange === "okx" ? "rotate(180deg)" : "none" }} />}</div>
                {(!section || openExchange === "okx") && (
                  <>
                    <label>API Key<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.OKX_API_KEY} onChange={(event) => updateExchange("OKX_API_KEY", event.target.value)} placeholder={exchange.okx?.hasKey ? "留空则保留现有密钥" : "待配置"} />{exchange.okx?.hasKey && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("OKX_API_KEY")}>移除</button>}</span></label>
                    <label>Secret<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.OKX_API_SECRET} onChange={(event) => updateExchange("OKX_API_SECRET", event.target.value)} placeholder={exchange.okx?.hasSecret ? "留空则保留现有密钥" : "待配置"} />{exchange.okx?.hasSecret && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("OKX_API_SECRET")}>移除</button>}</span></label>
                    <label>Passphrase<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.OKX_API_PASSPHRASE} onChange={(event) => updateExchange("OKX_API_PASSPHRASE", event.target.value)} placeholder={exchange.okx?.hasPassphrase ? "留空则保留现有密钥" : "待配置"} />{exchange.okx?.hasPassphrase && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("OKX_API_PASSPHRASE")}>移除</button>}</span></label>
                    <label>IP 白名单<input value={exchangeForm.OKX_IP_WHITELIST} onChange={(event) => updateExchange("OKX_IP_WHITELIST", event.target.value)} placeholder="建议填写交易所绑定 IP" /></label>
                    <div className="formGrid">
                      <label>保证金模式<select value={exchangeForm.OKX_MARGIN_MODE} onChange={(event) => updateExchange("OKX_MARGIN_MODE", event.target.value)}><option value="cross">cross</option><option value="isolated">isolated</option></select></label>
                      <label>持仓模式<select value={exchangeForm.OKX_POSITION_MODE} onChange={(event) => updateExchange("OKX_POSITION_MODE", event.target.value)}><option value="net">net</option><option value="long_short">long_short</option></select></label>
                    </div>
                  </>
                )}
              </div>
            </div>
            <button className="primaryButton" type="submit"><Lock size={14} /> 保存交易所配置</button>
          </form>
        )}

        {activeConfigSection === "live" && (
          <form className="panelForm" onSubmit={saveLive}>
            <CfgHead icon={Zap} title="实盘写入与灰度发布" sub="多道安全闸全部就绪后，批准的计划才会真实下单，否则一律干跑" status={live.effective ? "实盘已开启" : "实盘关闭"} statusTone={live.effective ? "neg" : ""} />
            {(() => {
              const snapshotOk = (data.accountSnapshots || []).some((s) => s.status === "ok");
              const mandateOk = (data.mandates || []).some((m) => ["active", "running"].includes(m.status));
              const withdrawOk = data.readiness?.checks?.find((c) => c.key === "withdraw_permission_detection")?.configured ?? false;
              const auditOk = data.readiness?.checks?.find((c) => c.key === "audit_chain")?.configured ?? true;
              const gates = [
                { ok: Boolean(live.liveTradingEnabled), label: "实盘写入总开关", hint: "勾选下方 LIVE_TRADING_ENABLED" },
                { ok: Boolean(live.acknowledged), label: "风险确认", hint: "勾选下方「风险确认」" },
                { ok: Boolean(live.orderWriteEnabled), label: "真实下单写入", hint: "勾选下方「真实下单写入」——批准被拦时多半就是缺这个" },
                { ok: Boolean(live.grayEnabled), label: "小额灰度策略", hint: "勾选下方「启用小额灰度」并设额度/币种" },
                { ok: mandateOk, label: "有效授权 Mandate", hint: "先创建并激活一个 Mandate（可让 AI 交易员协助）" },
                { ok: snapshotOk, label: "账户快照", hint: "配置交易所后同步一次私有账户" },
                { ok: withdrawOk, label: "API 无提现权限已确认", hint: "系统设置 → 交易所 → 确认该 Key 无提现权限" },
                { ok: !data.system?.killSwitch, label: "未熔断", hint: "解除顶部「熔断」" },
                { ok: auditOk, label: "审计链正常", hint: "审计链异常需先修复" }
              ];
              const pass = gates.filter((g) => g.ok).length;
              return (
                <div className="liveReadiness">
                  <div className="liveReadinessHead">
                    <span>实盘下单就绪清单（全部就绪后批准才会真实下单，否则只干跑）</span>
                    <b className={pass === gates.length ? "ok" : "warn"}>{pass}/{gates.length} 就绪</b>
                  </div>
                  <div className="liveGateList">
                    {gates.map((g) => (
                      <div key={g.label} className={g.ok ? "liveGate ok" : "liveGate"}>
                        {g.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        <span>{g.label}</span>
                        {!g.ok && <small>{g.hint}</small>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="switchGrid">
              <label className="checkboxLabel"><input type="checkbox" checked={liveForm.liveTradingEnabled} onChange={(event) => updateLive("liveTradingEnabled", event.target.checked)} /> LIVE_TRADING_ENABLED</label>
              <label className="checkboxLabel"><input type="checkbox" checked={liveForm.acknowledged} onChange={(event) => updateLive("acknowledged", event.target.checked)} /> 风险确认</label>
              <label className="checkboxLabel"><input type="checkbox" checked={liveForm.orderWriteEnabled} onChange={(event) => updateLive("orderWriteEnabled", event.target.checked)} /> 真实下单写入</label>
              <label className="checkboxLabel"><input type="checkbox" checked={liveForm.grayEnabled} onChange={(event) => updateLive("grayEnabled", event.target.checked)} /> 启用小额灰度</label>
              <label className="checkboxLabel"><input type="checkbox" checked={liveForm.grayRequiresApproval} onChange={(event) => updateLive("grayRequiresApproval", event.target.checked)} /> 保留人工确认（取消勾选＝授权与额度内全自动下单）</label>
            </div>
            {live.liveTradingEnabled && liveForm.grayRequiresApproval === false ? (
              <div className="autoTradeBanner on">🤖 全自动执行已开启：AI 自主巡检发现符合授权的机会时，会在「单笔灰度额度」内自动下单，超额度仍转你人工批准。</div>
            ) : (
              <div className="autoTradeBanner off">当前为「人工批准」模式：AI 提计划，你点批准后才下单。要全自动：开启实盘写入三道闸 + 取消勾选「保留人工确认」。</div>
            )}
            <label>单笔灰度额度 USDT（全自动下单的单笔上限）<input type="number" min="1" value={liveForm.maxNotionalUsdt} onChange={(event) => updateLive("maxNotionalUsdt", event.target.value)} /></label>
            <button className="primaryButton" type="submit"><Zap size={14} /> 保存实盘配置</button>
          </form>
        )}

        {activeConfigSection === "integrations" && (
          <form className="panelForm integrationConsole" onSubmit={saveIntegrations}>
            <div className="formTitleRow">
              <div>
                <h3>外部服务与告警</h3>
                {!section && <span>按模块维护第三方能力，避免密钥和通知配置挤在一张长表单里。</span>}
              </div>
              <button className="primaryButton" type="submit"><PlugZap size={14} /> 保存当前配置</button>
            </div>
            {!section && (
              <div className="integrationModuleGrid">
                {integrationModules.map((module) => {
                  const Icon = module.icon;
                  return (
                    <button type="button" className={activeIntegrationModule === module.id ? "active" : ""} key={module.id} onClick={() => setActiveIntegrationModule(module.id)}>
                      <Icon size={18} />
                      <span>{module.title}</span>
                      <small>{module.sub}</small>
                      <StatusBadge tone={module.done ? "ok" : "neutral"}>{module.done ? "已接入" : "待配置"}</StatusBadge>
                    </button>
                  );
                })}
              </div>
            )}

            {(section || activeIntegrationModule === "telegram") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "telegram")}>
                  <strong>Telegram 盈利仓位海报</strong>
                  <StatusBadge tone={integrations.telegram?.configured ? "ok" : "neutral"}>{integrations.telegram?.configured ? (integrations.telegram?.profitPosterEnabled ? "已启用" : "已配置") : "未配置"}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "telegram" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "telegram") && (<>
                {!section && <InsightNote icon={Bell} title="群推送">配置 Bot Token 和群 Chat ID 后，持仓监控会把满足盈利阈值的仓位渲染成海报并推送到 Telegram 群。</InsightNote>}
                <div className="formGrid">
                  {telegramSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? "留空则保留现有配置" : "123456:ABC..."} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除</button>}</span></label>
                  ))}
                  <label>Telegram 群 Chat ID<input value={integrationForm.TELEGRAM_CHAT_ID} onChange={(event) => updateIntegration("TELEGRAM_CHAT_ID", event.target.value)} placeholder="-1001234567890" /></label>
                  <label>自动推送<select value={integrationForm.TELEGRAM_PROFIT_POSTER_ENABLED} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_ENABLED", event.target.value)}><option value="false">关闭</option><option value="true">开启</option></select></label>
                  <label>最小盈利 USDT<input type="number" min="0" step="0.01" value={integrationForm.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT", event.target.value)} /></label>
                  <label>最小 ROI %<input type="number" min="0" step="0.01" value={integrationForm.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT", event.target.value)} /></label>
                  <label>冷却时间（分钟）<input type="number" min="1" value={integrationForm.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES", event.target.value)} /></label>
                </div>
                {integrations.telegram?.configured && <button className="secondaryButton" type="button" onClick={() => action("/api/notifications/telegram-test", {})}><Bell size={14} /> 发送 Telegram 海报测试</button>}
                </>)}
              </div>
            )}

            {(section || activeIntegrationModule === "lark") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "lark")}>
                  <strong>飞书（Lark）主动通知</strong>
                  <StatusBadge tone={integrations.lark?.hasWebhook ? "ok" : "neutral"}>{integrations.lark?.hasWebhook ? (integrations.lark?.signed ? "已配置 · 已签名" : "已配置") : "未配置"}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "lark" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "lark") && (<>
                {!section && <InsightNote icon={PlugZap} title="关键事件">配置飞书自定义机器人后，新计划待批准、逼近止损、保本移动、一键熔断等关键事件会主动推送到你的飞书。</InsightNote>}
                <div className="formGrid">
                  {larkSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? "留空则保留现有配置" : (keyName === "LARK_WEBHOOK_URL" ? "https://open.feishu.cn/open-apis/bot/v2/hook/..." : "开启签名校验时填写")} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除</button>}</span></label>
                  ))}
                </div>
                {integrations.lark?.hasWebhook && <button className="secondaryButton" type="button" onClick={() => action("/api/notifications/lark-test", {})}><Bell size={14} /> 发送飞书测试消息</button>}
                </>)}
              </div>
            )}

            {(section || activeIntegrationModule === "langsmith") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "langsmith")}>
                  <strong>LangSmith Trace</strong>
                  <StatusBadge tone={integrations.langsmith?.hasKey ? "ok" : "neutral"}>{integrations.langsmith?.hasKey ? "已配置" : "未配置"}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "langsmith" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "langsmith") && (<>
                <div className="formGrid">
                  {langsmithSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? "留空则保留现有配置" : "待配置"} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除</button>}</span></label>
                  ))}
                  <label>Endpoint<input value={integrationForm.LANGSMITH_ENDPOINT} onChange={(event) => updateIntegration("LANGSMITH_ENDPOINT", event.target.value)} /></label>
                  <label>Project<input value={integrationForm.LANGSMITH_PROJECT} onChange={(event) => updateIntegration("LANGSMITH_PROJECT", event.target.value)} /></label>
                </div>
                </>)}
              </div>
            )}

            {(section || activeIntegrationModule === "data") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "data")}>
                  <strong>数据与搜索 API</strong>
                  <StatusBadge tone={dataSourceSecretRows.some(([, , configured]) => configured) ? "ok" : "neutral"}>{dataSourceSecretRows.some(([, , configured]) => configured) ? "部分已配置" : "未配置"}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "data" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "data") && (<>
                <div className="formGrid">
                  {dataSourceSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? "留空则保留现有配置" : "待配置"} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除</button>}</span></label>
                  ))}
                </div>
                </>)}
              </div>
            )}

            {(section || activeIntegrationModule === "alerts") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "alerts")}>
                  <strong>告警 Webhook</strong>
                  <StatusBadge tone={integrations.alerts?.hasWebhook ? "ok" : "neutral"}>{integrations.alerts?.hasWebhook ? "已配置" : "未配置"}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "alerts" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "alerts") && (
                <div className="formGrid">
                  {alertSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? "留空则保留现有配置" : "https://..."} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除</button>}</span></label>
                  ))}
                </div>
                )}
              </div>
            )}
          </form>
        )}

        {activeConfigSection === "runtime" && (
          <form className="panelForm" onSubmit={saveRuntime}>
            <CfgHead icon={Settings} title="系统运行参数" sub="鉴权、市场类型、代理、沙箱镜像、实时对账等运行时开关" status={runtime.authRequired === false ? "免登录" : "鉴权开启"} statusTone={runtime.authRequired === false ? "warn" : "ok"} />
            <div className="formGrid">
              {runtimeSecretRows.map(([keyName, label, configured]) => (
                <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={runtimeForm[keyName]} onChange={(event) => updateRuntime(keyName, event.target.value)} placeholder={configured ? "留空则保留现有配置" : "待配置"} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>移除</button>}</span></label>
              ))}
            </div>
            <div className="formGrid">
              <label>登录鉴权<select value={runtimeForm.AUTH_REQUIRED} onChange={(event) => updateRuntime("AUTH_REQUIRED", event.target.value)}><option value="true">开启</option><option value="false">关闭</option></select></label>
              <label>Binance 默认市场<select value={runtimeForm.BINANCE_MARKET_TYPE} onChange={(event) => updateRuntime("BINANCE_MARKET_TYPE", event.target.value)}><option value="spot">spot</option><option value="perpetual_usdt">perpetual_usdt</option><option value="usdm">usdm</option></select></label>
              <label>OKX 默认市场<select value={runtimeForm.OKX_MARKET_TYPE} onChange={(event) => updateRuntime("OKX_MARKET_TYPE", event.target.value)}><option value="spot">spot</option><option value="perpetual_swap">perpetual_swap</option></select></label>
              <label>实时对账<select value={runtimeForm.REALTIME_RECONCILER_ENABLED} onChange={(event) => updateRuntime("REALTIME_RECONCILER_ENABLED", event.target.value)}><option value="false">关闭</option><option value="true">开启</option></select></label>
              <label>服务端口（重启生效）<input type="number" min="1" max="65535" value={runtimeForm.PORT} onChange={(event) => updateRuntime("PORT", event.target.value)} /></label>
            </div>
            <label>Skill 沙箱镜像<input value={runtimeForm.SKILL_SANDBOX_IMAGE} onChange={(event) => updateRuntime("SKILL_SANDBOX_IMAGE", event.target.value)} placeholder="node:20-alpine" /></label>
            <button className="primaryButton" type="submit"><Settings size={14} /> 保存系统运行配置</button>
          </form>
        )}

        {!config.secretsMasterKeySet && <div className="emptyPanel emptyPanelAction"><strong>建议设置 SECRETS_MASTER_KEY</strong><span>当前使用开发默认主密钥，适合本地试用，不适合长期保存真实凭证。</span></div>}
      </div>
    </div>
  );
}

// 交易对白名单多选器：从 OKX/Binance 全部 USDT 永续合约里搜索多选。
function SymbolMultiSelect({ value = [], onChange }) {
  const [all, setAll] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const boxRef = useRef(null);
  useEffect(() => {
    let alive = true;
    const token = localStorage.getItem("agent_token") || "";
    fetch(apiUrl("/api/market/instruments"), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : { instruments: [] }))
      .then((j) => { if (alive) setAll(j.instruments || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    function onDocClick(event) { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);
  const selected = value || [];
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return all.filter((item) => !selected.includes(item.symbol) && (!q || item.symbol.includes(q))).slice(0, 60);
  }, [all, query, selected]);
  function add(sym) { onChange([...selected, sym]); setQuery(""); }
  function remove(sym) { onChange(selected.filter((s) => s !== sym)); }
  return (
    <div className="symbolSelect" ref={boxRef}>
      <div className="symbolChips">
        {selected.length
          ? selected.map((s) => <span key={s} className="symbolChip">{s}<button type="button" title="移除" onClick={() => remove(s)}>×</button></span>)
          : <span className="symbolChipsEmpty">未选择任何交易对</span>}
      </div>
      <input
        className="symbolSearch"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? "加载永续合约列表…" : `搜索代币，从 ${all.length} 个永续合约中多选`}
      />
      {open && !loading && (
        <div className="symbolDropdown">
          {filtered.length
            ? filtered.map((item) => (
              <button type="button" key={item.symbol} className="symbolOption" onClick={() => add(item.symbol)}>
                <span>{item.symbol}</span><small>{(item.exchanges || []).join(" · ")}</small>
              </button>
            ))
            : <div className="symbolNoMatch">{query ? "无匹配合约" : "开始输入以搜索"}</div>}
        </div>
      )}
    </div>
  );
}

export function MandatePanel({ data, action }) {
  const mandate = data.mandates?.[0] || {};
  const [form, setForm] = useState({
    name: mandate.name || "主账户授权委托",
    exchange: mandate.exchanges?.[0] || "BINANCE",
    allowedSymbols: mandate.allowedSymbols?.length ? mandate.allowedSymbols.map((s) => String(s).toUpperCase()) : ["BTC/USDT", "ETH/USDT"],
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
    const symbols = (Array.isArray(form.allowedSymbols) ? form.allowedSymbols : asArray(form.allowedSymbols)).map((item) => String(item).toUpperCase());
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
      <label className="symbolLabel">交易对白名单<SymbolMultiSelect value={form.allowedSymbols} onChange={(next) => update("allowedSymbols", next)} /></label>
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
      {(data.exchangeAccounts || []).map((account) => <div className="panelItem" key={account.id}><div><strong>{account.exchange}</strong><small>{account.label}</small></div><StatusBadge tone={exchangeState(account).tone === "off" ? "warning" : "ok"}>{exchangeState(account).label}</StatusBadge><button className="secondaryButton" onClick={() => { ui.closePanel?.(); ui.setActive?.("systemSettings"); }}>去系统设置</button></div>)}
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
      {mode === "upload" && <label>上传文件<input type="file" accept=".pdf,.epub,.docx,.md,.txt,.json,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
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
            <button className="dangerTextButton" title="删除该知识来源及其片段" onClick={() => { if (window.confirm(`确定删除「${source.title}」？其片段、概念卡与规则将一并移除。`)) action(`/api/knowledge/sources/${source.id}`, {}, "DELETE"); }}><Trash2 size={15} /></button>
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
  const [form, setForm] = useState({ name: "", type: "Every", schedule: "Every 5m", role: "风控", kind: "standard", mission: "" });
  const [taskFilter, setTaskFilter] = useState("全部");
  const tasks = data.tasks || [];
  const taskTabs = [
    ["全部", tasks.length],
    ["Every", tasks.filter((task) => task.type === "Every").length],
    ["Cron", tasks.filter((task) => task.type === "Cron").length],
    ["At", tasks.filter((task) => task.type === "At").length]
  ];
  const visibleTasks = taskFilter === "全部" ? tasks : tasks.filter((task) => task.type === taskFilter);
  function updateType(type) {
    const schedule = type === "Cron" ? "*/5 * * * *" : type === "At" ? new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16) : "Every 5m";
    setForm((current) => ({ ...current, type, schedule }));
  }
  const isMission = form.kind === "mission";
  async function submit(event) {
    event.preventDefault();
    const name = (form.name || form.mission).trim().slice(0, 40);
    if (!name) return;
    if (isMission && !form.mission.trim()) return;
    const schedule = form.type === "At" ? new Date(form.schedule).toISOString() : form.schedule.trim();
    const payload = { name, type: form.type, schedule, enabled: true, role: isMission ? "情报" : form.role };
    if (isMission) payload.mission = form.mission.trim();
    await action("/api/tasks", payload);
    setForm((current) => ({ ...current, name: "", mission: "" }));
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <div className="taskTabs taskKindSwitch">
          <button type="button" className={!isMission ? "active" : ""} onClick={() => setForm((current) => ({ ...current, kind: "standard" }))}>常规任务</button>
          <button type="button" className={isMission ? "active" : ""} onClick={() => setForm((current) => ({ ...current, kind: "mission" }))}>情报 · 自由任务</button>
        </div>
        <label>任务名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={isMission ? "例如：俄乌停战跟踪（留空自动取目标）" : "例如：行情扫描 / 知识过期检查"} /></label>
        {isMission && (
          <label>追踪目标（自然语言）<textarea rows={2} value={form.mission} onChange={(event) => setForm((current) => ({ ...current, mission: event.target.value }))} placeholder="例如：每天追踪俄乌停战进展并总结影响；或：盯 ETH ETF 审批，有动静就产出简报" /></label>
        )}
        <div className="formGrid">
          <label>触发类型<select value={form.type} onChange={(event) => updateType(event.target.value)}><option>Every</option><option>Cron</option><option>At</option></select></label>
          {!isMission && <label>任务分类<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} /></label>}
        </div>
        <label>{form.type === "At" ? "运行时间" : "触发表达式"}<input type={form.type === "At" ? "datetime-local" : "text"} value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} /></label>
        {isMission && <span className="fieldHint">Agent 会按此计划刷新情报、匹配相关事件专题、产出简报（在通知与情报中心可见）。无需 API key 也能跑，有 LLM 时更聪明。</span>}
        <button className="primaryButton" type="submit">{isMission ? "派发情报任务" : "创建任务"}</button>
      </form>
      <div className="taskManagerList">
        <div className="taskManagerHead">
          <strong>已创建任务</strong>
          <div className="taskTabs">{taskTabs.map(([name, count]) => <button className={taskFilter === name ? "active" : ""} key={name} onClick={() => setTaskFilter(name)}>{name} {count}</button>)}</div>
        </div>
        <div className="taskManagerScroll">
          {visibleTasks.map((task) => (
            <div className="panelItem" key={task.id}>
              <div><strong>{task.name}</strong><small>{task.schedule || "-"} · 下次 {formatDateTime(task.nextRunAt, "未排期")}</small></div>
              <StatusBadge tone={task.enabled === false ? "warning" : "ok"}>{task.enabled === false ? "已暂停" : humanize(task.status, "运行中")}</StatusBadge>
              <span className="panelActions"><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/run`, {})}>运行</button><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? "恢复" : "暂停"}</button><button className="secondaryButton dangerText" onClick={() => action(`/api/tasks/${task.id}`, {}, "DELETE")}>删除</button></span>
            </div>
          ))}
          {!visibleTasks.length && <div className="emptyPanel emptyPanelAction"><strong>{tasks.length ? "当前类型暂无任务" : "暂无任务"}</strong><span>{tasks.length ? "切换上方类型查看其他已创建任务。" : "创建任务后会进入调度器，并在运行日志中留下记录。"}</span></div>}
        </div>
      </div>
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
