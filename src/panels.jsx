import React, { useEffect, useMemo, useRef, useState } from "react";
import { uiConfirm, uiPrompt } from "./confirm.jsx";
import {
  Trash2,
  AlertTriangle,
  Bell,
  CheckCircle2,
  XCircle,
  BrainCircuit,
  ChevronDown,
  Globe2,
  KeyRound,
  Layers,
  Lock,
  PlugZap,
  RefreshCw,
  Search,
  Settings,
  WalletCards,
  Zap
} from "lucide-react";
import { apiUrl, formatMoney, displayMoney, displayPct, asArray, readFileAsDataUrl, formatDateTime, humanize, localizeText, statusTone, exchangeState, StatusBadge, RiskLine, InsightNote } from "./lib.jsx";
import { t } from "./i18n.js";

export function ConfigPanel({ panel, data, action, ui }) {
  const titles = {
    mandate: t("交易权限设置", "Trading permissions"),
    riskRules: t("风险规则管理", "Risk rule management"),
    ip: t("IP 白名单", "IP allowlist"),
    eventRule: t("事件规则", "Event risk rule"),
    knowledgeImport: t("导入知识", "Import knowledge"),
    knowledgeList: t("知识来源", "Knowledge sources"),
    ruleLibrary: t("规则库", "Rule library"),
    riskIncidents: t("风险事件处理", "Risk incident handling"),
    skillImport: t("导入 Skill", "Import skill"),
    taskManager: t("任务管理", "Task management"),
    eventSources: t("事件详情与来源", "Event sources"),
    auditChain: t("完整审计链", "Full audit trail"),
    executionDetail: t("执行详情", "Execution details")
  };
  return (
    <div className="panelOverlay" onClick={ui.closePanel}>
      <aside className="configPanel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{t("配置中心", "Configuration")}</span>
            <h2>{titles[panel] || t("系统设置", "System settings")}</h2>
          </div>
          <button className="secondaryButton" onClick={ui.closePanel}>{t("关闭", "Close")}</button>
        </header>
        {panel === "mandate" && <MandatePanel data={data} action={action} />}
        {panel === "riskRules" && <RiskRulesPanel data={data} action={action} />}
        {panel === "ip" && <IpPanel data={data} action={action} />}
        {panel === "eventRule" && <EventRulePanel action={action} />}
        {panel === "knowledgeImport" && <KnowledgeImportPanel action={action} ui={ui} />}
        {panel === "knowledgeList" && <KnowledgeListPanel data={data} action={action} ui={ui} />}
        {panel === "ruleLibrary" && <RuleLibraryPanel data={data} action={action} ui={ui} />}
        {panel === "riskIncidents" && <RiskIncidentsPanel data={data} action={action} ui={ui} />}
        {panel === "skillImport" && <SkillImportPanel data={data} action={action} ui={ui} />}
        {panel === "taskManager" && <TaskManagerPanel data={data} action={action} />}
        {panel === "eventSources" && <EventSourcesPanel data={data} action={action} ui={ui} />}
        {panel === "auditChain" && <AuditChainPanel data={data} />}
        {panel === "executionDetail" && <ExecutionDetailPanel data={data} />}
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
    DEEPSEEK_MODEL: providers.deepseek?.model || "deepseek-v4-flash",
    GEMINI_API_KEY: "",
    GEMINI_MODEL: providers.gemini?.model || "gemini-2.5-flash"
  });
  const [exchangeForm, setExchangeForm] = useState({
    OKX_API_KEY: "",
    OKX_API_SECRET: "",
    OKX_API_PASSPHRASE: "",
    OKX_IP_WHITELIST: (() => {
      const value = (data.exchangeAccounts || []).find((item) => item.exchange === "OKX")?.ipWhitelist || "";
      return value === "建议开启" ? "" : value;
    })(),
    OKX_MARGIN_MODE: data.runtimeConfig?.OKX_MARGIN_MODE || "cross",
    OKX_POSITION_MODE: data.runtimeConfig?.OKX_POSITION_MODE || "net"
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
    TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES: integrations.telegram?.cooldownMinutes ?? 240,
    TELEGRAM_WATCH_CHAT_ID: integrations.telegram?.watchChatId || "",
    TELEGRAM_WATCH_NOTIFIER_ENABLED: integrations.telegram?.watchNotifierEnabled ? "true" : "false",
    TELEGRAM_WATCH_DAILY_DIGEST_ENABLED: integrations.telegram?.watchDailyDigestEnabled ? "true" : "false",
    TELEGRAM_WATCH_LANGUAGE: integrations.telegram?.watchLanguage || "en"
  });
  const [runtimeForm, setRuntimeForm] = useState({
    ADMIN_PASSWORD: "",
    AUTH_REQUIRED: runtime.authRequired === false ? "false" : "true",
    SKILL_SANDBOX_IMAGE: runtime.skillSandboxImage || "node:20-alpine",
    OKX_MARKET_TYPE: runtime.okxMarketType || "perpetual_swap",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    PORT: runtime.port || "8787"
  });
  const providerRows = [
    ["anthropic", "Anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
    ["openai", "OpenAI", "OPENAI_API_KEY", "OPENAI_MODEL"],
    ["deepseek", "DeepSeek", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"],
    ["gemini", t("Gemini（备用）", "Gemini (optional)"), "GEMINI_API_KEY", "GEMINI_MODEL"]
  ];
  // 各家常见模型下拉建议(datalist:可点选也可手输自定义,新模型出了直接打进去也行)。
  const PROVIDER_MODELS = {
    anthropic: ["claude-opus-4-8", "claude-sonnet-4-5", "claude-haiku-4-5"],
    openai: ["gpt-5.2", "gpt-5", "gpt-4.1", "o4-mini"],
    deepseek: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    // flash 放首位:免费额度大十几倍,咱们用 Gemini 只做联网搜索归因,flash 够用;pro 免费档极小易 429。
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash"]
  };
  const secretRows = [
    ["OKX_API_KEY", "OKX API Key", exchange.okx?.hasKey],
    ["OKX_API_SECRET", "OKX Secret", exchange.okx?.hasSecret],
    ["OKX_API_PASSPHRASE", "OKX Passphrase", exchange.okx?.hasPassphrase]
  ];
  const langsmithSecretRows = [["LANGSMITH_API_KEY", "LangSmith API Key", integrations.langsmith?.hasKey]];
  // 这些旧字段目前没有进入事实证据链，不能继续以“可配置数据源”的样子误导用户。
  // 信息面统一由当前 ME News/官方日历/OKX 公共数据管道提供。
  const dataSourceSecretRows = [];
  const alertSecretRows = [["ALERT_WEBHOOK_URL", t("告警 Webhook URL", "Alert webhook URL"), integrations.alerts?.hasWebhook]];
  const integrationSecretRows = [...langsmithSecretRows, ...dataSourceSecretRows, ...alertSecretRows];
  const larkSecretRows = [
    ["LARK_WEBHOOK_URL", t("飞书机器人 Webhook URL", "Lark bot webhook URL"), integrations.lark?.hasWebhook],
    ["LARK_WEBHOOK_SECRET", t("飞书签名密钥（可选）", "Lark signing secret (optional)"), integrations.lark?.signed]
  ];
  const telegramSecretRows = [
    ["TELEGRAM_BOT_TOKEN", "Telegram Bot Token", integrations.telegram?.hasBotToken]
  ];
  const runtimeSecretRows = [
    ["ADMIN_PASSWORD", t("管理员登录密码", "Owner password"), runtime.adminPasswordSet],
    ["HTTP_PROXY", "HTTP Proxy", runtime.httpProxySet],
    ["HTTPS_PROXY", "HTTPS Proxy", runtime.httpsProxySet]
  ];
  const sectionKind = ({ environment: "runtime", network: "runtime", notifications: "integrations", data_backup: "data_backup", security: "runtime" })[section] || section;
  const [activeConfigSection, setActiveConfigSection] = useState(sectionKind || "llm");
  const [openProvider, setOpenProvider] = useState(config.llm?.activeProvider || "anthropic");
  const [openExchange, setOpenExchange] = useState("okx");
  const sectionHeadProps = (open, setOpen, id) => (section ? { role: "button", onClick: () => setOpen(open === id ? "" : id) } : {});
  const [activeIntegrationModule, setActiveIntegrationModule] = useState("telegram");
  const showIntegration = (id) => !section ? activeIntegrationModule === id : section === "notifications" ? ["telegram", "lark", "alerts"].includes(id) : true;
  const configSections = [
    { id: "llm", icon: BrainCircuit, title: t("模型", "Models"), sub: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : t("未配置", "Not configured") },
    { id: "exchange", icon: WalletCards, title: t("交易所", "Exchange"), sub: exchange.okx?.hasKey ? "OKX" : t("未配置", "Not configured") },
    { id: "integrations", icon: PlugZap, title: t("外部服务", "Integrations"), sub: integrations.telegram?.configured ? t("TG 已接入", "Telegram connected") : integrations.lark?.hasWebhook ? t("飞书已接入", "Lark connected") : (integrations.langsmith?.hasKey || integrations.alerts?.hasWebhook ? t("部分已配置", "Partially configured") : t("未配置", "Not configured")) },
    { id: "runtime", icon: Settings, title: t("运行参数", "Runtime"), sub: runtime.authRequired === false ? t("免登录", "Sign-in disabled") : t("鉴权开启", "Sign-in enabled") }
  ];
  const integrationModules = [
    { id: "telegram", icon: Bell, title: t("Telegram 推送", "Telegram Delivery"), sub: t("盈利海报与观察哨", "Profit posters and watch alerts"), done: integrations.telegram?.configured },
    { id: "lark", icon: PlugZap, title: t("飞书通知", "Lark Notifications"), sub: t("关键交易事件提醒", "Critical trading alerts"), done: integrations.lark?.hasWebhook },
    { id: "langsmith", icon: BrainCircuit, title: "LangSmith", sub: t("Agent 运行链路观测", "Agent trace observability"), done: integrations.langsmith?.hasKey },
    { id: "alerts", icon: AlertTriangle, title: t("告警 Webhook", "Alert Webhook"), sub: t("外部告警转发", "Forward alerts externally"), done: integrations.alerts?.hasWebhook }
  ];
  function updateLlm(key, value) {
    setLlmForm((current) => ({ ...current, [key]: value }));
  }
  // (审计 M1)mount 快照:保存时只 PATCH 用户真实改动的字段,防止陈旧表单把别处刚改的
  // IP 白名单/保证金模式静默写回旧值(表单是一次性快照,而 data 每 15s 在刷新)。
  const exchangeBaselineRef = useRef(null);
  if (exchangeBaselineRef.current === null) exchangeBaselineRef.current = { ...exchangeForm };
  const exchangeDirty = (key) => exchangeForm[key] !== exchangeBaselineRef.current[key];
  function updateExchange(key, value) {
    setExchangeForm((current) => ({ ...current, [key]: value }));
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
      OKX_MARGIN_MODE: exchangeForm.OKX_MARGIN_MODE
    };
    for (const [keyName] of secretRows) {
      if (exchangeForm[keyName]) body[keyName] = exchangeForm[keyName];
    }
    const result = await action("/api/config", body);
    const okxAccount = (data.exchangeAccounts || []).find((item) => item.exchange === "OKX");
    if (okxAccount && exchangeDirty("OKX_IP_WHITELIST") && exchangeForm.OKX_IP_WHITELIST !== okxAccount.ipWhitelist) {
      await action(`/api/exchange/accounts/${okxAccount.id}`, { ipWhitelist: exchangeForm.OKX_IP_WHITELIST }, "PATCH");
    }
    if (result.status) setExchangeForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.includes("API") || key.includes("SECRET") || key.includes("PASSPHRASE") ? "" : value])));
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
      TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES: String(Number(integrationForm.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES || 240)),
      TELEGRAM_WATCH_CHAT_ID: integrationForm.TELEGRAM_WATCH_CHAT_ID,
      TELEGRAM_WATCH_NOTIFIER_ENABLED: integrationForm.TELEGRAM_WATCH_NOTIFIER_ENABLED,
      TELEGRAM_WATCH_DAILY_DIGEST_ENABLED: integrationForm.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED,
      TELEGRAM_WATCH_LANGUAGE: integrationForm.TELEGRAM_WATCH_LANGUAGE
    };
    for (const [keyName] of [...integrationSecretRows, ...larkSecretRows, ...telegramSecretRows]) {
      if (integrationForm[keyName]) body[keyName] = integrationForm[keyName];
    }
    const result = await action("/api/config", body);
    if (result.status) setIntegrationForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.endsWith("_KEY") || key === "ALERT_WEBHOOK_URL" || key.startsWith("LARK_") || key === "TELEGRAM_BOT_TOKEN" ? "" : value])));
  }
  async function saveRuntime(event) {
    event.preventDefault();
    const body = {};
    if (!section || section === "environment") Object.assign(body, {
      SKILL_SANDBOX_IMAGE: runtimeForm.SKILL_SANDBOX_IMAGE,
      OKX_MARKET_TYPE: runtimeForm.OKX_MARKET_TYPE,
      PORT: runtimeForm.PORT
    });
    if (!section || section === "security") body.AUTH_REQUIRED = runtimeForm.AUTH_REQUIRED;
    const allowedSecrets = section === "network" ? new Set(["HTTP_PROXY", "HTTPS_PROXY"])
      : section === "security" ? new Set(["ADMIN_PASSWORD"])
        : section === "environment" ? new Set() : new Set(runtimeSecretRows.map(([key]) => key));
    for (const [keyName] of runtimeSecretRows.filter(([key]) => allowedSecrets.has(key))) {
      if (runtimeForm[keyName]) body[keyName] = runtimeForm[keyName];
    }
    const result = await action("/api/config", body);
    if (result.status) setRuntimeForm((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, ["ADMIN_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY"].includes(key) ? "" : value])));
  }
  function removeSecret(keyName) {
    return action(`/api/config/secret/${encodeURIComponent(keyName)}`, {}, "DELETE");
  }
  const visibleRuntimeRows = section === "network" ? runtimeSecretRows.filter(([key]) => ["HTTP_PROXY", "HTTPS_PROXY"].includes(key))
    : section === "security" ? runtimeSecretRows.filter(([key]) => key === "ADMIN_PASSWORD")
      : section === "environment" ? [] : runtimeSecretRows;
  const runtimeHeading = section === "network"
    ? [t("网络代理", "Network Proxy"), t("仅当服务器访问 OKX、模型服务或外部数据源需要代理时填写。", "Configure a proxy only when the server needs it to reach OKX, model providers, or external data sources.")]
    : section === "security"
      ? [t("登录与凭证安全", "Sign-in & Credential Security"), t("管理登录保护和 Owner 密码。密钥原文不会显示在前端或日志中。", "Manage sign-in protection and the Owner password. Secret values are never exposed in the UI or ordinary logs.")]
      : [t("环境与服务", "Environment & Services"), t("管理 OKX 市场类型、服务端口和 Skill 沙箱运行环境。", "Manage the OKX market type, server port, and Skill sandbox runtime.")];
  return (
    <div className="settingsConsole">
      {!section && (
        <nav className="settingsNav" aria-label={t("系统设置分类", "System settings categories")}>
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
            <CfgHead icon={BrainCircuit} title={t("AI 模型", "AI Models")} sub={t("选择用于对话、市场分析和自主巡检的模型服务。", "Choose the model provider used for chat, market analysis, and autonomous reviews.")} status={config.llm?.activeProvider ? `${t("使用中", "Active")} · ${config.llm.activeProvider}` : t("未配置", "Not configured")} statusTone={config.llm?.activeProvider ? "ok" : ""} />
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
                      {idName === config.llm?.activeProvider && <span className="cfgUsing">{t("使用中", "Active")}</span>}
                      <StatusBadge tone={providers[idName]?.hasKey ? "ok" : "neutral"}>{providers[idName]?.hasKey ? t("已配置", "Configured") : t("未配置", "Not configured")}</StatusBadge>
                      {section && <ChevronDown size={15} style={{ transform: collapsed ? "none" : "rotate(180deg)" }} />}
                    </div>
                    {!collapsed && (
                      <>
                        <label>API Key<input type="password" autoComplete="off" value={llmForm[keyName]} onChange={(event) => updateLlm(keyName, event.target.value)} placeholder={providers[idName]?.hasKey ? t("留空则保留现有密钥", "Leave blank to keep the current key") : t("粘贴 API Key", "Paste API key")} /></label>
                        <label>{t("模型", "Model")}<input list={`models-${idName}`} value={llmForm[modelName]} onChange={(event) => updateLlm(modelName, event.target.value)} placeholder={t("选择或输入模型名", "Choose or enter a model name")} />
                          <datalist id={`models-${idName}`}>{(PROVIDER_MODELS[idName] || []).map((m) => <option key={m} value={m} />)}</datalist>
                          {idName === "gemini" && <small className="cfgHint">{t("Gemini 仅用于联网搜索归因。建议使用 Flash；Pro 免费额度较小，容易触发限流。", "Gemini is used only for web-search attribution. Flash is recommended; the Pro free tier is more likely to be rate-limited.")}</small>}
                        </label>
                        {providers[idName]?.hasKey && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>{t("移除", "Remove")} {label} Key</button>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="configSaveBar"><small>{t("只保存本页发生的更改；留空的密钥保持不变。", "Only changes on this page are saved; blank secret fields keep their current values.")}</small><button className="primaryButton" type="submit"><KeyRound size={14} /> {t("保存模型设置", "Save model settings")}</button></div>
          </form>
        )}

        {activeConfigSection === "exchange" && (
          <form className="panelForm" onSubmit={saveExchange}>
            <CfgHead icon={WalletCards} title={t("OKX 连接与权限", "OKX Connection & Permissions")} sub={t("账户同步与交易执行都使用 OKX。API Key 必须禁用提现权限并限制 IP。", "Market analysis and execution both use OKX. Disable withdrawals and restrict the API key by IP.")} status={t("禁止提现", "Withdrawals disabled")} statusTone="warn" />
            <div className="exchangeColumns">
              <div className="exchangeCol">
                <div className="exchangeColHead" {...sectionHeadProps(openExchange, setOpenExchange, "okx")}><span className="exchangeLogo okx">✣</span><strong>OKX</strong><StatusBadge tone={exchange.okx?.hasSecret && exchange.okx?.hasPassphrase ? "ok" : "neutral"}>{exchange.okx?.hasSecret && exchange.okx?.hasPassphrase ? t("连接信息完整", "Credentials complete") : exchange.okx?.hasKey ? t("缺少 Secret 或 Passphrase", "Secret or passphrase missing") : t("未配置", "Not configured")}</StatusBadge>{section && <ChevronDown size={15} style={{ transform: openExchange === "okx" ? "rotate(180deg)" : "none" }} />}</div>
                {(!section || openExchange === "okx") && (
                  <>
                    <label>API Key<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.OKX_API_KEY} onChange={(event) => updateExchange("OKX_API_KEY", event.target.value)} placeholder={exchange.okx?.hasKey ? t("留空则保留现有密钥", "Leave blank to keep the current key") : t("待配置", "Enter API key")} />{exchange.okx?.hasKey && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("OKX_API_KEY")}>{t("移除", "Remove")}</button>}</span></label>
                    <label>Secret<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.OKX_API_SECRET} onChange={(event) => updateExchange("OKX_API_SECRET", event.target.value)} placeholder={exchange.okx?.hasSecret ? t("留空则保留现有密钥", "Leave blank to keep the current secret") : t("待配置", "Enter secret")} />{exchange.okx?.hasSecret && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("OKX_API_SECRET")}>{t("移除", "Remove")}</button>}</span></label>
                    <label>Passphrase<span className="inputWithAction"><input type="password" autoComplete="off" value={exchangeForm.OKX_API_PASSPHRASE} onChange={(event) => updateExchange("OKX_API_PASSPHRASE", event.target.value)} placeholder={exchange.okx?.hasPassphrase ? t("留空则保留现有密钥", "Leave blank to keep the current passphrase") : t("待配置", "Enter passphrase")} />{exchange.okx?.hasPassphrase && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret("OKX_API_PASSPHRASE")}>{t("移除", "Remove")}</button>}</span></label>
                    <label>{t("OKX 后台绑定 IP（仅记录）", "IP bound in OKX (record only)")}<input value={exchangeForm.OKX_IP_WHITELIST} onChange={(event) => updateExchange("OKX_IP_WHITELIST", event.target.value)} placeholder={t("请先在 OKX API 后台绑定，再在此记录", "Bind it in OKX first, then record it here")} /></label>
                    <div className="formGrid">
                      <label>{t("保证金模式", "Margin mode")}<select value={exchangeForm.OKX_MARGIN_MODE} onChange={(event) => updateExchange("OKX_MARGIN_MODE", event.target.value)}><option value="cross">{t("全仓", "Cross")}</option><option value="isolated">{t("逐仓", "Isolated")}</option></select></label>
                    </div>
                  </>
                )}
              </div>
            </div>
            {/* API Key 权限核验:七层安全闸之一(api_key_permission_unverified)会拦截所有实盘新开仓,
                此前实盘灰度面板提示来这里核验,但这里根本没有入口——按钮在此补上。 */}
            {(data.apiKeyMetadata || []).some((k) => k.hasApiKey) && (
              <div className="keyVerifyBlock">
                <strong>{t("API Key 权限确认", "API Key Permission Check")}</strong>
                <small>{t("实盘交易前，请先在 OKX 确认该 Key 未开启提现权限，再在此确认。未确认前，系统会阻止真实开仓。", "Before live trading, verify in OKX that withdrawals are disabled, then confirm here. Live entries remain blocked until this check is complete.")}</small>
                {(data.apiKeyMetadata || []).filter((k) => k.hasApiKey).map((k) => (
                  <div className="keyVerifyRow" key={k.id || k.exchange}>
                    <b>{k.exchange}</b>
                    <StatusBadge tone={k.permissionVerifiedAt ? "ok" : "warn"}>{k.permissionVerifiedAt ? `${t("已确认", "Confirmed")} · ${k.permissionVerificationStatus === "manual_confirmed" ? t("人工确认", "Manual") : t("接口验证", "API verified")}` : t("未确认，实盘开仓已阻止", "Not confirmed; live entries blocked")}</StatusBadge>
                    {!k.permissionVerifiedAt && (
                      <button className="secondaryButton" type="button" onClick={async () => { if (await uiConfirm(t(`确认你已在 ${k.exchange} API 管理页面核对过该 Key 未开启提现权限？`, `Confirm that withdrawals are disabled for this key in ${k.exchange}?`))) action(`/api/exchange/api-key-metadata/${k.id}/confirm-no-withdraw`, {}); }}>{t("确认无提现权限", "Confirm withdrawals disabled")}</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="configSaveBar"><small>{t("保存后会保留现有安全校验，密钥原文不会回显。", "Existing security checks remain in place and secret values are never shown.")}</small><button className="primaryButton" type="submit"><Lock size={14} /> {t("保存 OKX 设置", "Save OKX settings")}</button></div>
          </form>
        )}

        {activeConfigSection === "integrations" && (
          <form className="panelForm integrationConsole" onSubmit={saveIntegrations}>
            <div className="formTitleRow">
              <div>
                <h3>{t("外部服务与通知", "Integrations & Notifications")}</h3>
                {!section && <span>{t("按模块管理第三方服务、数据源和通知渠道。", "Manage third-party services, data sources, and notification channels by module.")}</span>}
              </div>
              <button className="primaryButton configCompactSave" type="submit"><PlugZap size={14} /> {section === "notifications" ? t("保存通知设置", "Save notification settings") : t("保存本模块", "Save module")}</button>
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
                      <StatusBadge tone={module.done ? "ok" : "neutral"}>{module.done ? t("已接入", "Connected") : t("待配置", "Not configured")}</StatusBadge>
                    </button>
                  );
                })}
              </div>
            )}

            {showIntegration("telegram") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "telegram")}>
                  <strong>{t("Telegram 盈利海报与观察条件", "Telegram Profit Posters & Watch Conditions")}</strong>
                  <StatusBadge tone={integrations.telegram?.configured ? "ok" : "neutral"}>{integrations.telegram?.configured ? (integrations.telegram?.profitPosterEnabled ? t("已启用", "Enabled") : t("已配置", "Configured")) : t("未配置", "Not configured")}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "telegram" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "telegram") && (<>
                {!section && <InsightNote icon={Bell} title={t("只推交易上需要立即知道的变化", "Only decision-changing interruptions")}>{t("盯盘是持续服务，观察哨是其中的结构化价位条件。Telegram 只推主条件命中或当前判断关键失效；登记、更新、到期和撤销留在应用内。", "Live watch is the continuous service; a watch is one structured price condition. Telegram sends only primary triggers or critical thesis invalidations; registration, edits, expiry, and cancellation stay in the app.")}</InsightNote>}
                <div className="formGrid">
                  {telegramSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? t("留空则保留现有配置", "Leave blank to keep the current token") : "123456:ABC..."} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>{t("移除", "Remove")}</button>}</span></label>
                  ))}
                  <label>{t("Telegram 群 Chat ID", "Telegram group chat ID")}<input value={integrationForm.TELEGRAM_CHAT_ID} onChange={(event) => updateIntegration("TELEGRAM_CHAT_ID", event.target.value)} placeholder="-1001234567890" /></label>
                  <label>{t("盈利海报自动推送", "Automatic profit posters")}<select value={integrationForm.TELEGRAM_PROFIT_POSTER_ENABLED} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_ENABLED", event.target.value)}><option value="false">{t("关闭", "Off")}</option><option value="true">{t("开启", "On")}</option></select></label>
                  <label>{t("最低盈利（USDT）", "Minimum profit (USDT)")}<input type="number" min="0" step="0.01" value={integrationForm.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT", event.target.value)} /></label>
                  <label>{t("最低 ROI（%）", "Minimum ROI (%)")}<input type="number" min="0" step="0.01" value={integrationForm.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT", event.target.value)} /></label>
                  <label>{t("发送间隔（分钟）", "Cooldown (minutes)")}<input type="number" min="1" value={integrationForm.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES} onChange={(event) => updateIntegration("TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES", event.target.value)} /></label>
                  <label>{t("关键观察条件推送", "Critical watch delivery")}<select value={integrationForm.TELEGRAM_WATCH_NOTIFIER_ENABLED} onChange={(event) => updateIntegration("TELEGRAM_WATCH_NOTIFIER_ENABLED", event.target.value)}><option value="false">{t("关闭", "Off")}</option><option value="true">{t("开启", "On")}</option></select></label>
                  <label>{t("观察哨推送语言", "Watch alert language")}<select value={integrationForm.TELEGRAM_WATCH_LANGUAGE} onChange={(event) => updateIntegration("TELEGRAM_WATCH_LANGUAGE", event.target.value)}><option value="en">English</option><option value="zh">中文</option></select></label>
                  <label>{t("观察哨每日摘要", "Daily watch digest")}<select value={integrationForm.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED} onChange={(event) => updateIntegration("TELEGRAM_WATCH_DAILY_DIGEST_ENABLED", event.target.value)}><option value="false">{t("关闭", "Off")}</option><option value="true">{t("开启", "On")}</option></select></label>
                  <label>{t("观察哨单独群 ID（可选）", "Separate watch chat ID (optional)")}<input value={integrationForm.TELEGRAM_WATCH_CHAT_ID} onChange={(event) => updateIntegration("TELEGRAM_WATCH_CHAT_ID", event.target.value)} placeholder={t("留空则使用上面的群", "Leave blank to use the primary group")} /></label>
                </div>
                {integrations.telegram?.configured && <button className="secondaryButton" type="button" onClick={() => action("/api/notifications/telegram-test", {})}><Bell size={14} /> {t("发送测试海报", "Send test poster")}</button>}
                {integrations.telegram?.watchConfigured && <button className="secondaryButton" type="button" onClick={() => action("/api/notifications/telegram-watch-test", {})}><Bell size={14} /> {t("发送观察哨测试", "Send watch alert test")}</button>}
                </>)}
              </div>
            )}

            {showIntegration("lark") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "lark")}>
                  <strong>{t("飞书（Lark）主动通知", "Lark Notifications")}</strong>
                  <StatusBadge tone={integrations.lark?.hasWebhook ? "ok" : "neutral"}>{integrations.lark?.hasWebhook ? (integrations.lark?.signed ? t("已配置并签名", "Configured and signed") : t("已配置", "Configured")) : t("未配置", "Not configured")}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "lark" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "lark") && (<>
                {!section && <InsightNote icon={PlugZap} title={t("关键事件", "Critical events")}>{t("配置飞书自定义机器人后，待确认计划、临近止损、保本移动和紧急停止等关键事件会发送到飞书。", "After you configure a Lark bot, critical events such as plans awaiting approval, near-stop alerts, break-even moves, and emergency stops are delivered to Lark.")}</InsightNote>}
                <div className="formGrid">
                  {larkSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? t("留空则保留现有配置", "Leave blank to keep the current value") : (keyName === "LARK_WEBHOOK_URL" ? "https://open.feishu.cn/open-apis/bot/v2/hook/..." : t("启用签名校验时填写", "Required only when signature verification is enabled"))} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>{t("移除", "Remove")}</button>}</span></label>
                  ))}
                </div>
                {integrations.lark?.hasWebhook && <button className="secondaryButton" type="button" onClick={() => action("/api/notifications/lark-test", {})}><Bell size={14} /> {t("发送飞书测试消息", "Send Lark test message")}</button>}
                </>)}
              </div>
            )}

            {showIntegration("langsmith") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "langsmith")}>
                  <strong>LangSmith Trace</strong>
                  <StatusBadge tone={integrations.langsmith?.hasKey ? "ok" : "neutral"}>{integrations.langsmith?.hasKey ? t("已配置", "Configured") : t("未配置", "Not configured")}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "langsmith" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "langsmith") && (<>
                <div className="formGrid">
                  {langsmithSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? t("留空则保留现有配置", "Leave blank to keep the current value") : t("待配置", "Enter value")} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>{t("移除", "Remove")}</button>}</span></label>
                  ))}
                  <label>Endpoint<input value={integrationForm.LANGSMITH_ENDPOINT} onChange={(event) => updateIntegration("LANGSMITH_ENDPOINT", event.target.value)} /></label>
                  <label>Project<input value={integrationForm.LANGSMITH_PROJECT} onChange={(event) => updateIntegration("LANGSMITH_PROJECT", event.target.value)} /></label>
                </div>
                </>)}
              </div>
            )}

            {showIntegration("alerts") && (
              <div className="configFieldset modulePanel">
                <div className="configFieldsetHead" {...sectionHeadProps(activeIntegrationModule, setActiveIntegrationModule, "alerts")}>
                  <strong>{t("告警 Webhook", "Alert Webhook")}</strong>
                  <StatusBadge tone={integrations.alerts?.hasWebhook ? "ok" : "neutral"}>{integrations.alerts?.hasWebhook ? t("已配置", "Configured") : t("未配置", "Not configured")}</StatusBadge>
                  {section && <ChevronDown size={15} style={{ transform: activeIntegrationModule === "alerts" ? "rotate(180deg)" : "none" }} />}
                </div>
                {(!section || activeIntegrationModule === "alerts") && (
                <div className="formGrid">
                  {alertSecretRows.map(([keyName, label, configured]) => (
                    <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={integrationForm[keyName]} onChange={(event) => updateIntegration(keyName, event.target.value)} placeholder={configured ? t("留空则保留现有配置", "Leave blank to keep the current value") : "https://..."} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>{t("移除", "Remove")}</button>}</span></label>
                  ))}
                </div>
                )}
              </div>
            )}
          </form>
        )}

        {activeConfigSection === "data_backup" && (
          <div className="panelForm configDataBackup">
            <CfgHead icon={RefreshCw} title={t("数据与备份", "Data & Backup")} sub={t("创建 SQLite 一致性快照，不中断行情同步、分析、记忆或交易执行。", "Create a consistent SQLite snapshot without interrupting market sync, analysis, memory, or trade execution.")} status={t("在线备份", "Online backup")} statusTone="ok" />
            <div className="configInfoGrid">
              <div><b>{t("备份内容", "Included")}</b><span>{t("交易事实、三层记忆、知识库、策略、配置和审计索引", "Trade facts, all memory layers, knowledge, strategies, settings, and audit indexes")}</span></div>
              <div><b>{t("运行影响", "Runtime impact")}</b><span>{t("使用 SQLite 在线备份接口，系统无需停机", "Uses SQLite online backup; no service downtime required")}</span></div>
              <div><b>{t("日志与海报", "Logs & posters")}</b><span>{t("运行日志和可重新生成的海报不属于决策记忆，可按保留策略清理", "Runtime logs and reproducible posters are not decision memory and may follow their retention policy")}</span></div>
            </div>
            <div className="configSaveBar"><small>{t("备份文件保存在服务器受控备份目录中。", "The backup is stored in the server-managed backup directory.")}</small><button className="primaryButton" type="button" onClick={() => action("/api/system/backup", {})}><RefreshCw size={14} /> {t("立即创建备份", "Create backup now")}</button></div>
          </div>
        )}

        {activeConfigSection === "runtime" && (
          <form className="panelForm" onSubmit={saveRuntime}>
            <CfgHead icon={section === "network" ? Globe2 : section === "security" ? Lock : Settings} title={runtimeHeading[0]} sub={runtimeHeading[1]} status={section === "network" ? (runtime.httpProxySet || runtime.httpsProxySet ? t("已配置", "Configured") : t("直连", "Direct connection")) : runtime.authRequired === false ? t("免登录", "Sign-in disabled") : t("鉴权开启", "Sign-in enabled")} statusTone={section === "network" ? "" : runtime.authRequired === false ? "warn" : "ok"} />
            {visibleRuntimeRows.length > 0 && <div className="formGrid">
              {visibleRuntimeRows.map(([keyName, label, configured]) => (
                <label key={keyName}>{label}<span className="inputWithAction"><input type="password" autoComplete="off" value={runtimeForm[keyName]} onChange={(event) => updateRuntime(keyName, event.target.value)} placeholder={configured ? t("留空则保留现有配置", "Leave blank to keep the current value") : t("待配置", "Enter value")} />{configured && <button className="secondaryButton dangerText" type="button" onClick={() => removeSecret(keyName)}>{t("移除", "Remove")}</button>}</span></label>
              ))}
            </div>}
            {(!section || section === "security") && <div className="formGrid">
              <label>{t("登录鉴权", "Require sign-in")}<select value={runtimeForm.AUTH_REQUIRED} onChange={(event) => updateRuntime("AUTH_REQUIRED", event.target.value)}><option value="true">{t("开启", "On")}</option><option value="false">{t("关闭", "Off")}</option></select></label>
            </div>}
            {(!section || section === "environment") && <><div className="formGrid">
              <label>{t("OKX 市场", "OKX market")}<select value={runtimeForm.OKX_MARKET_TYPE} onChange={(event) => updateRuntime("OKX_MARKET_TYPE", event.target.value)}><option value="perpetual_swap">{t("USDT 永续", "USDT perpetuals")}</option></select></label>
              <label>{t("服务端口（重启生效）", "Server port (restart required)")}<input type="number" min="1" max="65535" value={runtimeForm.PORT} onChange={(event) => updateRuntime("PORT", event.target.value)} /></label>
            </div>
            <label>{t("Skill 沙箱镜像", "Skill sandbox image")}<input value={runtimeForm.SKILL_SANDBOX_IMAGE} onChange={(event) => updateRuntime("SKILL_SANDBOX_IMAGE", event.target.value)} placeholder="node:20-alpine" /></label>
            </>}
            <div className="configSaveBar"><small>{section === "network" ? t("代理设置保存后由服务端连接使用。", "Proxy settings are used by server-side connections after saving.") : section === "security" ? t("密码和登录设置会写入受保护配置；密码原文不会回显。", "Password and sign-in settings are stored in protected configuration; the password is never shown again.") : t("端口和部分运行参数需要重启服务后生效。", "The port and some runtime settings require a service restart.")}</small><button className="primaryButton" type="submit"><Settings size={14} /> {section === "network" ? t("保存代理设置", "Save proxy settings") : section === "security" ? t("保存安全设置", "Save security settings") : t("保存运行设置", "Save runtime settings")}</button></div>
          </form>
        )}

        {(!section || section === "security") && !config.secretsMasterKeySet && <div className="emptyPanel emptyPanelAction"><strong>{t("请设置 SECRETS_MASTER_KEY", "Set SECRETS_MASTER_KEY")}</strong><span>{t("当前使用开发默认主密钥，只适合本地试用，不应长期保存真实凭证。", "The development default master key is suitable only for local testing and must not be used to store real credentials long term.")}</span></div>}
      </div>
    </div>
  );
}

// 交易对白名单多选器：从 OKX 全部 USDT 永续合约里搜索多选。
export function SymbolMultiSelect({ value = [], onChange, options = null, placeholder, maxVisibleChips = 6 }) {
  const [all, setAll] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    let alive = true;
    const token = localStorage.getItem("agent_token") || "";
    fetch(apiUrl("/api/market/instruments"), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : { instruments: [] }))
      .then((j) => { if (alive) { setAll(j.instruments || []); setLoadError(false); } })
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    function onDocClick(event) { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);
  const selected = value || [];
  const available = useMemo(() => {
    if (!Array.isArray(options)) return all;
    const allowed = new Set(options.map((item) => String(item).toUpperCase()));
    const known = all.filter((item) => allowed.has(String(item.symbol).toUpperCase()));
    const knownSymbols = new Set(known.map((item) => String(item.symbol).toUpperCase()));
    return [...known, ...[...allowed].filter((symbol) => !knownSymbols.has(symbol)).map((symbol) => ({ symbol, exchanges: ["OKX"] }))];
  }, [all, options]);
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return available.filter((item) => !selected.includes(item.symbol) && (!q || item.symbol.startsWith(q) || item.symbol.split("/")[0].includes(q))).slice(0, 60);
  }, [available, query, selected]);
  const visibleSelected = expanded ? selected : selected.slice(0, maxVisibleChips);
  function add(sym) { onChange([...selected, sym]); setQuery(""); setOpen(true); }
  function remove(sym) { onChange(selected.filter((s) => s !== sym)); }
  return (
    <div className="symbolSelect" ref={boxRef}>
      <div className="symbolSelectHead">
        <span>{selected.length ? t(`已选择 ${selected.length} 个`, `${selected.length} selected`) : t("尚未选择", "None selected")}</span>
        {selected.length > 0 && <button type="button" onClick={() => onChange([])}>{t("清空", "Clear")}</button>}
      </div>
      <div className={`symbolChips ${expanded ? "expanded" : ""}`}>
        {selected.length
          ? <>{visibleSelected.map((s) => <span key={s} className="symbolChip"><i>{String(s).split("/")[0].slice(0, 1)}</i>{s}<button type="button" aria-label={`${t("移除", "Remove")} ${s}`} title={t("移除", "Remove")} onClick={() => remove(s)}>×</button></span>)}{selected.length > maxVisibleChips && <button type="button" className="symbolMore" onClick={() => setExpanded((current) => !current)}>{expanded ? t("收起", "Collapse") : `+${selected.length - maxVisibleChips}`}</button>}</>
          : <span className="symbolChipsEmpty">{t("未选择任何交易对", "No trading pairs selected")}</span>}
      </div>
      <div className="symbolSearchShell"><Search size={14}/><input
          className="symbolSearch"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={loading ? t("加载永续合约列表…", "Loading perpetual markets…") : (placeholder || t(`搜索代币，从 ${available.length} 个永续合约中多选`, `Search and select from ${available.length} perpetual markets`))}
        /><kbd>{t("多选", "Multi")}</kbd></div>
      {open && !loading && (
        <div className="symbolDropdown">
          <div className="symbolDropdownHead"><span>{query ? t("搜索结果", "Search results") : t("可选永续合约", "Available perpetuals")}</span><b>{filtered.length}</b></div>
          {filtered.length
            ? filtered.map((item) => (
              <button type="button" key={item.symbol} className="symbolOption" onClick={() => add(item.symbol)}>
                <i>{item.symbol.split("/")[0].slice(0, 1)}</i><span><b>{item.symbol.split("/")[0]}</b><small>USDT {t("永续", "Perpetual")}</small></span><em>{(item.exchanges || ["OKX"]).join(" · ")}</em><CheckCircle2 size={15}/>
              </button>
            ))
            : <div className="symbolNoMatch">{loadError ? t("合约列表加载失败，请稍后重试", "Could not load markets. Try again shortly.") : query ? t("没有匹配的永续合约", "No matching perpetual market") : t("没有更多可选交易对", "No more pairs available")}</div>}
        </div>
      )}
    </div>
  );
}

export function MandatePanel({ data, action }) {
  // 必须编辑"当前生效"的授权——历史 bug:mandates[0] 是数组第一条(往往是被替代的旧授权),
  // 用户在表单里增删币对/改杠杆保存到旧记录,而风控卡显示的是生效记录 → 看起来"改了没生效"。
  const mandate = data.agentStatus?.activeMandate
    || (data.mandates || []).find((m) => ["active", "running"].includes(m.status))
    || data.mandates?.[0] || {};
  const activeGray = (data.grayReleasePolicies || []).find((item) => item.enabled);
  const legacyNotionalDefault = Number(activeGray?.maxNotionalUsdt) > 0 ? Number(activeGray.maxNotionalUsdt) : 50;
  const orderNotional = mandate.maxOrderNotionalUsdt ?? mandate.max_notional_usdt ?? legacyNotionalDefault;
  const symbolNotional = mandate.maxSymbolNotionalUsdt ?? orderNotional;
  const portfolioNotional = mandate.maxPortfolioNotionalUsdt ?? symbolNotional;
  const remainDays = mandate.validUntil ? Math.max(1, Math.ceil((new Date(mandate.validUntil) - Date.now()) / 86400000)) : 7;
  const buildForm = () => ({
    name: mandate.name || t("主账户交易权限", "Primary account trading permissions"),
    exchange: "OKX",
    allowedSymbols: mandate.allowedSymbols?.length ? mandate.allowedSymbols.map((s) => String(s).toUpperCase()) : ["BTC/USDT", "ETH/USDT"],
    minLeverage: mandate.min_leverage ?? mandate.minLeverage ?? 1,
    maxLeverage: mandate.max_leverage || 1,
    positionPct: mandate.positionPct ?? mandate.equityPct ?? 30,
    singleRisk: mandate.maxSingleTradeRiskPct || 2,
    dailyLoss: mandate.maxDailyLossPct || 1,
    weeklyLoss: mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? 5,
    maxOrderNotional: orderNotional,
    maxSymbolNotional: symbolNotional,
    maxPortfolioNotional: portfolioNotional,
    maxConcurrentPositions: mandate.maxConcurrentPositions || 3,
    maxMarginUtilizationPct: mandate.maxMarginUtilizationPct ?? mandate.max_margin_utilization_pct ?? 70,
    allowAddPosition: mandate.allowAddPosition === true || mandate.allow_add_position === true,
    validDays: remainDays
  });
  const [form, setForm] = useState(buildForm);
  // 生效授权切换(如保存后版本更新)时重同步表单,避免编辑陈旧快照。
  useEffect(() => { setForm(buildForm()); }, [mandate.id, mandate.version, activeGray?.maxNotionalUsdt]);
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    const symbols = (Array.isArray(form.allowedSymbols) ? form.allowedSymbols : asArray(form.allowedSymbols)).map((item) => String(item).toUpperCase());
    const maxLeverage = Number(form.maxLeverage || 1);
    const minLeverage = Math.max(1, Math.min(maxLeverage, Number(form.minLeverage || 1)));
    const body = {
      name: form.name,
      status: "active",
      exchanges: ["OKX"],
      marketTypes: ["perpetual_usdt"],
      allowedSymbols: symbols,
      strategies: mandate.strategies?.length
        ? mandate.strategies
        : ["trend_following", "mean_reversion", "momentum", "breakout"],
      maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, maxLeverage])),
      max_leverage: maxLeverage,
      min_leverage: minLeverage,
      minLeverage,
      sizingMode: "balance_pct",
      positionPct: Math.max(1, Math.min(100, Number(form.positionPct || 30))),
      maxSingleTradeRiskPct: Number(form.singleRisk || 0),
      maxDailyLossPct: Number(form.dailyLoss || 0),
      maxWeeklyLossPct: Number(form.weeklyLoss || 0),
      maxOrderNotionalUsdt: Number(form.maxOrderNotional || 0),
      maxSymbolNotionalUsdt: Number(form.maxSymbolNotional || 0),
      maxPortfolioNotionalUsdt: Number(form.maxPortfolioNotional || 0),
      maxConcurrentPositions: Number(form.maxConcurrentPositions || 1),
      maxMarginUtilizationPct: Number(form.maxMarginUtilizationPct || 70),
      allowAddPosition: form.allowAddPosition === true,
      allow_add_position: form.allowAddPosition === true,
      validUntil: new Date(Date.now() + Math.max(1, Math.min(365, Number(form.validDays || 7))) * 24 * 60 * 60 * 1000).toISOString()
    };
    await action(mandate.id ? `/api/mandates/${mandate.id}` : "/api/mandates", body, mandate.id ? "PATCH" : "POST");
  }
  return (
    <form className="panelForm" onSubmit={submit}>
      <label>{t("名称", "Name")}<input value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>{t("交易所", "Exchange")}<input value="OKX" disabled /></label>
      <label className="symbolLabel">{t("允许的交易对", "Allowed pairs")}<SymbolMultiSelect value={form.allowedSymbols} onChange={(next) => update("allowedSymbols", next)} /></label>
      <div className="formGrid">
        <label>{t("最低杠杆", "Minimum leverage")}<input type="number" min="1" value={form.minLeverage} onChange={(event) => update("minLeverage", event.target.value)} /><small className="fieldHint">{t("AI 只会在这个范围内选择", "The AI selects leverage only within this range")}</small></label>
        <label>{t("最高杠杆", "Maximum leverage")}<input type="number" min="1" value={form.maxLeverage} onChange={(event) => update("maxLeverage", event.target.value)} /><small className="fieldHint">{t("如需固定杠杆，请与最低杠杆设为相同", "Set equal to the minimum to use fixed leverage")}</small></label>
        <label>{t("单日亏损上限 %", "Daily loss limit %")}<input type="number" step="0.1" min="0" value={form.dailyLoss} onChange={(event) => update("dailyLoss", event.target.value)} /></label>
        <label>{t("近 7 日亏损上限 %", "Rolling 7-day loss limit %")}<input type="number" step="0.1" min="0.1" max="20" value={form.weeklyLoss} onChange={(event) => update("weeklyLoss", event.target.value)} /><small className="fieldHint">{t("达到上限后停止新开仓；默认 5%", "New entries stop at the limit; default 5%")}</small></label>
        <label>{t("交易权限单笔上限 USDT", "Trading-permission order limit (USDT)")}<input type="number" min="1" value={form.maxOrderNotional} onChange={(event) => update("maxOrderNotional", event.target.value)} /><small className="fieldHint">{t(`独立于实盘灰度额度；实际下单取两者较小值。当前灰度 ${activeGray?.maxNotionalUsdt ?? "—"} USDT。`, `Independent of the live-validation limit; execution uses the lower value. Current live-validation limit: ${activeGray?.maxNotionalUsdt ?? "—"} USDT.`)}</small></label>
      </div>
      <div className="formGrid">
        <label>{t("每单保证金占余额 %", "Margin per order (% of equity)")}<input type="number" step="1" min="1" max="100" value={form.positionPct} onChange={(event) => update("positionPct", event.target.value)} /><small className="fieldHint">{t("名义金额 = 保证金 × 杠杆，例如 30% × 8x", "Notional = margin × leverage, for example 30% × 8x")}</small></label>
        <label>{t("单笔最多亏损 %", "Maximum loss per trade %")}<input type="number" step="0.1" min="0" value={form.singleRisk} onChange={(event) => update("singleRisk", event.target.value)} /><small className="fieldHint">{t("按止损距离计算；超过限制时自动缩小仓位", "Calculated from stop distance; position size is reduced when needed")}</small></label>
        <label>{t("有效期（天）", "Valid for (days)")}<input type="number" min="1" max="365" value={form.validDays} onChange={(event) => update("validDays", event.target.value)} /><small className="fieldHint">{t("截止", "Until")} {new Date(Date.now() + Math.max(1, Math.min(365, Number(form.validDays || 7))) * 86400000).toLocaleDateString(t("zh-CN", "en-US"))}</small></label>
        <label>{t("单个交易对名义金额上限 USDT", "Maximum notional per pair (USDT)")}<input type="number" min="1" value={form.maxSymbolNotional} onChange={(event) => update("maxSymbolNotional", event.target.value)} /></label>
        <label>{t("全部持仓名义金额上限 USDT", "Maximum portfolio notional (USDT)")}<input type="number" min="1" value={form.maxPortfolioNotional} onChange={(event) => update("maxPortfolioNotional", event.target.value)} /></label>
        <label>{t("最多同时持仓数", "Maximum concurrent positions")}<input type="number" min="1" max="20" value={form.maxConcurrentPositions} onChange={(event) => update("maxConcurrentPositions", event.target.value)} /></label>
        <label>{t("成交后保证金使用率上限 %", "Maximum post-trade margin use %")}<input type="number" min="1" max="100" step="1" value={form.maxMarginUtilizationPct} onChange={(event) => update("maxMarginUtilizationPct", event.target.value)} /><small className="fieldHint">{t("每次下单前按真实可用保证金重新计算", "Recalculated from real available margin before every order")}</small></label>
        <label className="switchLabel"><input type="checkbox" checked={form.allowAddPosition} onChange={(event) => update("allowAddPosition", event.target.checked)} /><span>{t("允许同币种追加仓位", "Allow adding to an existing pair")}<small className="fieldHint">{t("关闭时，同币种只允许一个仓位或在途入场计划", "When off, only one position or pending entry is allowed per pair")}</small></span></label>
      </div>
      <button className="primaryButton" type="submit">{t("保存并立即生效", "Save and apply")}</button>
    </form>
  );
}

export function RiskRulesPanel({ data, action }) {
  const [newRule, setNewRule] = useState({
    name: "",
    level: "L3",
    action: "reject_entry",
    description: "",
    conditionField: "plan.leverage",
    conditionOperator: "gt",
    conditionValue: "3"
  });
  async function createRule(event) {
    event.preventDefault();
    const { conditionField, conditionOperator, conditionValue, ...rule } = newRule;
    await action("/api/risk/rules", {
      ...rule,
      scope: "trade",
      conditionSpec: {
        field: conditionField,
        operator: conditionOperator,
        value: Number(conditionValue)
      }
    });
    setNewRule((current) => ({ ...current, name: "", description: "" }));
  }
  return (
    <div className="panelStack">
      {(data.riskRules || []).map((rule) => (
        <div className="panelItem" key={rule.id}>
          <div><strong>{localizeText(rule.name)}</strong><small>{localizeText(rule.description)}</small><small>{rule.enabled===false?t("当前停用","Currently disabled"):rule.enforcementStatus==="advisory_uncompiled"?t("仅作为 AI 提示，不会阻断下单","AI advisory only; does not block orders"):rule.action==="notify"?t("命中后写入通知中心，不阻断下单","Creates an in-app notification without blocking"):t("命中后阻断当前计划的新开仓，不改变全局熔断状态","Blocks this plan's new entry without changing the global kill switch")}</small></div>
          <select disabled={rule.systemManaged} value={["notify","reject_entry","pause_opening"].includes(rule.action)?rule.action:(rule.action==="block"||rule.action==="restrict"||rule.action==="kill_switch"?"reject_entry":"notify")} onChange={(event) => action(`/api/risk/rules/${rule.id}`, { action: event.target.value }, "PATCH")}><option value="notify">{t("通知", "Notify")}</option><option value="reject_entry">{t("拒绝当前入场", "Reject this entry")}</option><option value="pause_opening">{t("暂停当前计划开仓", "Pause this plan's entry")}</option></select>
          <button className="secondaryButton" disabled={rule.systemManaged} onClick={() => action(`/api/risk/rules/${rule.id}`, { enabled: !rule.enabled }, "PATCH")}>{rule.systemManaged?t("内置强制","Built-in"):rule.enabled ? t("停用", "Disable") : t("启用", "Enable")}</button>
        </div>
      ))}
      <form className="panelForm" onSubmit={createRule}>
        <h3>{t("新增规则", "New rule")}</h3>
        <label>{t("规则名称", "Rule name")}<input value={newRule.name} onChange={(event) => setNewRule((current) => ({ ...current, name: event.target.value }))} placeholder={t("例如：高波动暂停新开仓", "Example: pause new entries during high volatility")} /></label>
        <label>{t("说明", "Description")}<textarea value={newRule.description} onChange={(event) => setNewRule((current) => ({ ...current, description: event.target.value }))} /></label>
        <div className="formGrid">
          <label>{t("指标", "Metric")}<select value={newRule.conditionField} onChange={(event) => setNewRule((current) => ({ ...current, conditionField: event.target.value }))}>
            <option value="plan.leverage">{t("计划杠杆", "Planned leverage")}</option>
            <option value="plan.riskPercent">{t("单笔风险百分比", "Risk per trade (%)")}</option>
            <option value="market.fundingRate">{t("资金费率", "Funding rate")}</option>
            <option value="market.spreadBps">{t("盘口点差 bps", "Order-book spread (bps)")}</option>
            <option value="event.maxImpact">{t("相关事件最高影响分", "Highest related-event impact score")}</option>
            <option value="account.remainingDailyLossUsdt">{t("剩余日亏损额度", "Remaining daily loss allowance")}</option>
          </select></label>
          <label>{t("比较", "Comparison")}<select value={newRule.conditionOperator} onChange={(event) => setNewRule((current) => ({ ...current, conditionOperator: event.target.value }))}>
            <option value="gt">{t("大于", "Greater than")}</option><option value="gte">{t("大于等于", "Greater than or equal")}</option><option value="lt">{t("小于", "Less than")}</option><option value="lte">{t("小于等于", "Less than or equal")}</option><option value="abs_gt">{t("绝对值大于", "Absolute value greater than")}</option>
          </select></label>
          <label>{t("阈值", "Threshold")}<input type="number" step="any" value={newRule.conditionValue} onChange={(event) => setNewRule((current) => ({ ...current, conditionValue: event.target.value }))} /></label>
        </div>
        <div className="formGrid">
          <label>{t("等级", "Level")}<select value={newRule.level} onChange={(event) => setNewRule((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
          <label>{t("动作", "Action")}<select value={newRule.action} onChange={(event) => setNewRule((current) => ({ ...current, action: event.target.value }))}><option value="notify">{t("通知（不阻断）", "Notify (non-blocking)")}</option><option value="reject_entry">{t("拒绝当前入场", "Reject this entry")}</option><option value="pause_opening">{t("暂停当前计划开仓", "Pause this plan's entry")}</option></select></label>
        </div>
        <button className="primaryButton" type="submit">{t("创建规则", "Create rule")}</button>
      </form>
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
          <label>{t("IP 白名单", "IP allowlist")}<input value={values[account.id] || ""} onChange={(event) => setValues((current) => ({ ...current, [account.id]: event.target.value }))} placeholder={t("例如：1.2.3.4, 5.6.7.8", "Example: 1.2.3.4, 5.6.7.8")} /></label>
          <button className="primaryButton" type="submit">{t(`保存 ${account.exchange}`, `Save ${account.exchange}`)}</button>
        </form>
      ))}
    </div>
  );
}

export function EventRulePanel({ action }) {
  // 阻断型规则必须带可编译的 conditionSpec(后端硬校验)——此前不带,本面板 100% 400(审计 H1)。
  const [form, setForm] = useState({ name: t("高影响事件前限制新开仓", "Restrict new entries before high-impact events"), description: t("事件影响未评估前，限制高杠杆新开仓。", "Restrict high-leverage entries until event impact has been assessed."), level: "L3", ruleAction: "reject_entry", conditionField: "event.maxImpact", conditionOperator: "gte", conditionValue: "80" });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  function submit(event) {
    event.preventDefault();
    const body = { name: form.name, description: form.description, level: form.level, scope: "event", action: form.ruleAction };
    body.conditionSpec = { field: form.conditionField, operator: form.conditionOperator, value: Number(form.conditionValue) };
    action("/api/risk/rules", body);
  }
  return (
    <form className="panelForm" onSubmit={submit}>
      <label>{t("规则名称", "Rule name")}<input value={form.name} onChange={set("name")} /></label>
      <label>{t("说明", "Description")}<textarea value={form.description} onChange={set("description")} /></label>
      <div className="formGrid">
        <label>{t("等级", "Level")}<select value={form.level} onChange={set("level")}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
        <label>{t("动作", "Action")}<select value={form.ruleAction} onChange={set("ruleAction")}><option value="notify">{t("通知（不阻断）", "Notify (non-blocking)")}</option><option value="reject_entry">{t("拒绝当前入场", "Reject this entry")}</option><option value="pause_opening">{t("暂停当前计划开仓", "Pause this plan's entry")}</option></select></label>
      </div>
      <div className="formGrid">
          <label>{t("触发字段", "Trigger field")}<select value={form.conditionField} onChange={set("conditionField")}>
            <option value="event.maxImpact">{t("事件影响分", "Event impact score")}</option>
            <option value="market.fundingRate">{t("资金费率", "Funding rate")}</option>
            <option value="market.spreadBps">{t("点差(bps)", "Spread (bps)")}</option>
            <option value="account.remainingDailyLossUsdt">{t("剩余日亏预算", "Remaining daily loss budget")}</option>
          </select></label>
          <label>{t("比较", "Comparison")}<select value={form.conditionOperator} onChange={set("conditionOperator")}><option value="gte">≥</option><option value="gt">&gt;</option><option value="lte">≤</option><option value="lt">&lt;</option></select></label>
          <label>{t("阈值", "Threshold")}<input type="number" value={form.conditionValue} onChange={set("conditionValue")} /></label>
      </div>
      <button className="primaryButton" type="submit">{t("创建事件规则", "Create event rule")}</button>
    </form>
  );
}

export function KnowledgeImportPanel({ action, ui }) {
  const [mode, setMode] = useState("text");
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    title: "",
    domain: t("交易策略", "Trading strategy"),
    url: "",
    subPath: "",
    crawlDepth: 1,
    crawlMaxPages: 12,
    content: "",
    author: "",
    bookFocus: "",
    trustScore: 70,
    createRuleDraft: false
  });
  const modes = [
    ["book", t("按书名", "Book title")],
    ["text", t("粘贴文本", "Paste text")],
    ["web", t("网页链接", "Web page")],
    ["upload", t("上传文件", "Upload file")],
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
      if (!form.url.trim()) return ui.notify(t("请填写 GitHub 仓库地址", "Enter a GitHub repository URL"));
      const result = await action("/api/knowledge/github-import", { repoUrl: form.url.trim(), subPath: form.subPath.trim() });
      if (result.status === "ok") ui.closePanel();
      return result;
    }
    const body = { ...common };
    if (mode === "book") {
      if (!form.title.trim()) return ui.notify(t("请填写书名", "Enter a book title"));
      body.type = "book_title";
      body.author = form.author.trim();
      body.bookFocus = form.bookFocus.trim();
    }
    if (mode === "text") {
      if (!form.content.trim()) return ui.notify(t("请粘贴知识文本", "Paste the knowledge text"));
      body.type = "text";
      body.content = form.content;
      body.fileName = `${form.title.trim() || "pasted-knowledge"}.md`;
    }
    if (mode === "web") {
      if (!form.url.trim()) return ui.notify(t("请填写网页链接", "Enter a web page URL"));
      body.type = "web";
      body.url = form.url.trim();
      body.crawlDepth = Number(form.crawlDepth);
      body.crawlMaxPages = Number(form.crawlMaxPages);
    }
    if (mode === "upload") {
      if (!file) return ui.notify(t("请选择 PDF、DOCX、MD 或 TXT 文件", "Select a PDF, DOCX, MD, or TXT file"));
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
        <label>{t("标题", "Title")}<input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder={t("例如：趋势交易笔记", "Example: Trend-trading notes")} /></label>
        <label>{t("领域", "Domain")}<input value={form.domain} onChange={(event) => update("domain", event.target.value)} placeholder={t("交易策略 / 风控 / 宏观", "Trading strategy / risk / macro")} /></label>
      </div>
      {mode === "book" && (
        <>
          <div className="bookHint">{t("仅填写书名时，AI 只能生成“合成读书笔记”，不能证明内容来自原书，因此永久禁止编译为自主交易技能。要让 Agent 真正学习并验证该书方法，请上传你有权使用的 PDF/EPUB/DOCX 或粘贴原文笔记。", "A title alone can only produce a synthetic reading note and cannot prove the content came from the book, so it can never be compiled into an autonomous trading skill. Upload a PDF/EPUB/DOCX you are entitled to use, or paste your source notes, if you want the Agent to learn and validate the method.")}</div>
          <div className="formGrid">
            <label>{t("作者（可选）", "Author (optional)")}<input value={form.author} onChange={(event) => update("author", event.target.value)} placeholder={t("如 Al Brooks / Mark Douglas", "e.g. Al Brooks / Mark Douglas")} /></label>
            <label>{t("侧重（可选）", "Focus (optional)")}<input value={form.bookFocus} onChange={(event) => update("bookFocus", event.target.value)} placeholder={t("如 价格行为 setup / 交易心理 / 风控", "e.g. price action setups / psychology / risk")} /></label>
          </div>
        </>
      )}
      {mode === "text" && <label>{t("知识文本", "Knowledge text")}<textarea className="largeTextarea" value={form.content} onChange={(event) => update("content", event.target.value)} placeholder={t("粘贴 Markdown、交易规则、研究笔记或复盘内容", "Paste Markdown, trading rules, research notes, or reviews")} /></label>}
      {mode === "web" && (
        <>
          <label>{t("网页链接", "Web page URL")}<input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://..." /></label>
          <div className="bookHint">{t("浅爬取：只在同一域名内、按下面的深度/页数抓取。深度 0＝只抓本页，1＝含直接子链接。动态渲染(需 JS/登录)的页面可能抓不到正文。", "Limited crawl: stays on the same domain and respects the depth/page limits below. Depth 0 fetches this page only; depth 1 includes direct links. Dynamically rendered or authenticated pages may not expose their article text.")}</div>
          <div className="formGrid">
            <label>{t("抓取深度", "Crawl depth")}
              <select value={form.crawlDepth} onChange={(event) => update("crawlDepth", event.target.value)}>
                <option value="0">{t("0 · 仅本页", "0 · This page only")}</option>
                <option value="1">{t("1 · 含直接子链接", "1 · Include direct links")}</option>
                <option value="2">{t("2 · 再深一层", "2 · One level deeper")}</option>
              </select>
            </label>
            <label>{t("最多页数", "Maximum pages")}<input type="number" min="1" max="40" value={form.crawlMaxPages} onChange={(event) => update("crawlMaxPages", event.target.value)} /></label>
          </div>
        </>
      )}
      {mode === "upload" && <label>{t("上传文件", "Upload file")}<input type="file" accept=".pdf,.epub,.docx,.md,.txt,.json,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
      {mode === "github" && (
        <>
          <label>{t("GitHub 仓库", "GitHub repository")}<input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://github.com/user/repo.git" /></label>
          <label>{t("子目录", "Subdirectory")}<input value={form.subPath} onChange={(event) => update("subPath", event.target.value)} placeholder={t("可留空，只导入某个子目录", "Optional: import only this subdirectory")} /></label>
          <div className="bookHint">{t("浅克隆仓库，优先纳入 README/docs 与文档，再补源码（最多 300 个文本文件，跳过锁文件/超大文件）。仓库很大时会按优先级截断，导入完成后会如实说明纳入了多少个。", "The repository is cloned with limited depth. README/docs and documentation are prioritized, followed by source files (up to 300 text files; lockfiles and oversized files are skipped). Large repositories are truncated by priority and the import report states exactly what was included.")}</div>
        </>
      )}
      <div className="formGrid">
        <label>{t("可信度", "Trust score")}<input type="number" min="1" max="100" value={form.trustScore} onChange={(event) => update("trustScore", event.target.value)} /></label>
        <label className="checkboxLabel"><input type="checkbox" checked={form.createRuleDraft} onChange={(event) => update("createRuleDraft", event.target.checked)} /> {t("生成规则草案", "Generate a rule draft")}</label>
      </div>
      <button className="primaryButton" type="submit">{t("导入并解析", "Import and parse")}</button>
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
          <strong>{t("还没有知识来源", "No knowledge sources yet")}</strong>
          <button className="primaryButton" onClick={() => ui.openPanel("knowledgeImport")}>{t("导入知识", "Import knowledge")}</button>
        </div>
      )}
      {sources.map((source) => {
        const chunkCount = (knowledge.chunks || []).filter((chunk) => chunk.sourceId === source.id).length;
        return (
          <div className="panelItem" key={source.id}>
            <div><strong>{localizeText(source.title)}</strong><small>{localizeText(source.domain || source.type)} · {chunkCount} {t("个片段", "chunks")} · {formatDateTime(source.importedAt, t("未记录", "Not recorded"))}</small></div>
            <StatusBadge tone={source.status === "parsed" ? "ok" : "warning"}>{humanize(source.status)}</StatusBadge>
            <button className="secondaryButton" onClick={() => action(`/api/knowledge/sources/${source.id}/parse-real`, {})}>{source.status === "parsed" ? t("重新解析", "Parse again") : t("解析", "Parse")}</button>
            <button className="dangerTextButton" title={t("删除该知识来源及其片段", "Delete this source and its chunks")} onClick={async () => { if (await uiConfirm(t(`确定删除「${source.title}」？其片段、概念卡与规则将一并移除。`, `Delete “${source.title}”? Its chunks, concept cards, and rules will also be removed.`))) action(`/api/knowledge/sources/${source.id}`, {}, "DELETE"); }}><Trash2 size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}

const ruleActionLabel = (action) => ({ notify: t("通知", "Notify"), reject_entry: t("拒绝当前入场", "Reject entry"), pause_opening: t("暂停当前计划开仓", "Pause plan entry"), reduce: t("减仓（旧动作）", "Reduce (legacy)"), none: t("仅记录", "Log only"), restrict: t("阻断（旧动作）", "Block (legacy)"), block: t("阻断（旧动作）", "Block (legacy)"), kill_switch: t("阻断（旧动作）", "Block (legacy)") }[action] || action || t("通知", "Notify"));

// —— 规则相似度：中文按 2-gram + 拉丁词做 Jaccard，客户端聚类出"疑似重复组"给用户预览。——
function ruleTokens(rule) {
  const text = `${rule.name || ""} ${rule.description || ""} ${rule.condition || ""}`.toLowerCase();
  const latin = text.match(/[a-z0-9]+/g) || [];
  const cjk = text.replace(/[^一-龥]/g, "");
  const grams = [];
  for (let i = 0; i < cjk.length - 1; i += 1) grams.push(cjk.slice(i, i + 2));
  return new Set([...latin, ...grams]);
}
function ruleJaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function clusterRules(rules, threshold = 0.5) {
  const toks = rules.map(ruleTokens);
  const parent = rules.map((_, i) => i);
  const find = (x) => { let r = x; while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; } return r; };
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      if (ruleJaccard(toks[i], toks[j]) >= threshold) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  rules.forEach((r, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(r); });
  return [...groups.values()].filter((g) => g.length > 1);
}

export function RuleLibraryPanel({ data, action, ui }) {
  const knowledge = data.knowledge || {};
  const [newRule, setNewRule] = useState({ name: "", description: "", level: "L2", action: "notify" });
  const [guideOpen, setGuideOpen] = useState(true);
  const rules = knowledge.ruleProposals || [];
  const sourceMap = useMemo(() => Object.fromEntries((knowledge.sources || []).map((s) => [s.id, s.title])), [knowledge.sources]);
  const pending = rules.filter((r) => r.status !== "已批准" && r.status !== "已拒绝").length;
  const approvedCount = rules.filter((r) => r.status === "已批准").length;
  const activeSkills = (knowledge.tradingSkills || []).filter((s) => s.status === "active").length;
  const clusters = useMemo(() => clusterRules(rules.filter((r) => r.status !== "已拒绝")), [rules]);
  const dupExtra = clusters.reduce((n, g) => n + g.length - 1, 0);

  async function createRule(event) {
    event.preventDefault();
    await action("/api/knowledge/rules/proposals", newRule);
    setNewRule({ name: "", description: "", level: "L2", action: "notify" });
  }
  async function mergeCluster(group) {
    const [, ...rest] = group;
    const removable = rest.filter((r) => r.status !== "已批准");
    if (!removable.length) return ui.notify(t("该组其余为已批准规则，未删除", "The remaining rules in this group are approved and were not deleted"));
    if (!await uiConfirm(t(`保留「${group[0].name}」，删除本组其余 ${removable.length} 条疑似重复草案？`, `Keep “${group[0].name}” and delete the other ${removable.length} likely duplicate drafts?`))) return;
    for (const r of removable) await action(`/api/knowledge/rules/${r.id}`, {}, "DELETE");
  }
  return (
    <div className="panelStack">
      <div className="ruleLibNote">
        <strong>{t("规则库 = 从书里蒸馏出的「纪律/风控」约束", "Rule library = discipline and risk constraints distilled from sources")}</strong>
        <small>{t(`每条都标注了来源书籍与依据。批准后写入风控引擎、并注入 AI 提示词；可预测方向的「策略」不在这里，而是走「策略假设」必须先回测。共 ${rules.length} 条 · ${approvedCount} 已批准 · ${pending} 待审批。`, `Every rule cites its source and rationale. Approved rules enter the risk engine and AI context. Directional strategies belong in strategy hypotheses and must be backtested first. ${rules.length} total · ${approvedCount} approved · ${pending} pending.`)}</small>
        <div className="ruleLibActions">
          <button className="secondaryButton" disabled={rules.length < 2} onClick={async () => { if (await uiConfirm(t("用 AI 语义合并近义规则（无 AI 时退回按 类别+名称+依据 精确去重；已批准的保留），确定去重？", "Merge semantically similar rules with AI? Without AI, exact category/name/rationale matching is used. Approved rules are preserved."))) action("/api/knowledge/rules/dedup", {}); }}><Layers size={14} /> {t("语义去重", "Semantic dedupe")}</button>
        </div>
      </div>

      {/* 上手引导：回答"规则这么多会不会一直不交易"，并给择要批准的路径 */}
      <div className="ruleGuide">
        <button className="ruleGuideHead" onClick={() => setGuideOpen((v) => !v)}>
          <AlertTriangle size={14} /> <b>{t("规则很多、很多重复，会不会导致系统一直不交易？", "Can too many or duplicate rules prevent all trading?")}</b>
          <ChevronDown size={14} className={guideOpen ? "flip" : ""} />
        </button>
        {guideOpen && (
          <div className="ruleGuideBody">
            <p>{t(`规则数量本身不会阻止交易。风险纪律只有在触发条件满足时才会限制或暂停开仓。长时间没有开仓通常是因为没有已启用且验证通过的策略（当前 ${activeSkills} 个）、没有生效的交易权限，或当日风险预算已经用尽。`, `Rule count alone does not block trading. Risk controls restrict or pause entries only when their trigger conditions are met. A prolonged lack of entries usually means there is no enabled, validated strategy (currently ${activeSkills}), no active trading permissions, or the daily risk budget has been exhausted.`)}</p>
            <div className="ruleGuideSteps">
              <div className={dupExtra ? "on" : "done"}><b>{t("① 先去重", "1. Remove duplicates")}</b><span>{dupExtra ? t(`疑似可精简 ${dupExtra} 条`, `${dupExtra} likely duplicates`) : t("已较精简", "Already concise")}</span></div>
              <div className={approvedCount ? "done" : "on"}><b>{t("② 择要批准", "2. Approve selectively")}</b><span>{approvedCount ? t(`${approvedCount} 条已批`, `${approvedCount} approved`) : t("每类只批最关键 1-2 条", "Approve only the top 1–2 per category")}</span></div>
              <div className={activeSkills ? "done" : "on"}><b>{t("③ 启用策略", "3. Enable a strategy")}</b><span>{activeSkills ? t(`${activeSkills} 个策略已启用`, `${activeSkills} strategies enabled`) : t("先让一个策略通过验证并启用", "Validate and enable one strategy first")}</span></div>
            </div>
            {!approvedCount && <p className="ruleGuideWarn">{t("当前没有已批准规则。批准后规则会进入风控引擎和 AI 上下文；请先去重，再从每个类别选择最关键的规则。", "No rules are approved yet. Approved rules enter the risk engine and AI context. Remove duplicates first, then select the most important rules in each category.")}</p>}
          </div>
        )}
      </div>

      {/* 疑似重复分组预览：去重前先让用户看清"哪些会被合并" */}
      {clusters.length > 0 && (
        <div className="ruleDupWrap">
          <div className="ruleDupHead"><Layers size={14} /> {t("疑似重复", "Likely duplicates")} <b>{clusters.length}</b> {t("组 · 可精简", "groups · removable")} <b>{dupExtra}</b><small>{t("相似度≥50%，合并保留每组第一条", "Similarity ≥50%; merge keeps the first rule in each group")}</small></div>
          {clusters.map((group, gi) => (
            <div className="ruleDupGroup" key={gi}>
              <div className="ruleDupItems">
                {group.map((r, ri) => <span className={`ruleDupChip ${ri === 0 ? "keep" : ""}`} key={r.id} title={localizeText(r.description || "")}>{ri === 0 ? `${t("保留", "Keep")} · ` : ""}{localizeText(r.name)}{r.status === "已批准" ? " ✓" : ""}</span>)}
              </div>
              <button className="secondaryButton sm" onClick={() => mergeCluster(group)}>{t("合并此组", "Merge group")}</button>
            </div>
          ))}
        </div>
      )}
      {!rules.length && (
        <div className="emptyPanel emptyPanelAction">
          <strong>{t("还没有规则草案", "No rule drafts yet")}</strong>
          <button className="secondaryButton" onClick={() => ui.openPanel("knowledgeImport")}>{t("从知识生成", "Generate from knowledge")}</button>
        </div>
      )}
      {rules.map((rule) => {
        const src = (rule.sourceRefs || []).map((id) => sourceMap[id]).filter(Boolean)[0];
        const approved = rule.status === "已批准";
        return (
          <div className="ruleItem" key={rule.id}>
            <div className="ruleItemHead">
              <b>{localizeText(rule.name)}</b>
              <StatusBadge tone={approved ? "ok" : rule.status === "已拒绝" ? "neutral" : "warning"}>{humanize(rule.status, "待审批")}</StatusBadge>
            </div>
            <div className="ruleItemMeta">
              {rule.category && <span className="ruleTag cat">{localizeText(rule.category)}</span>}
              <span className="ruleTag act">{t("动作", "Action")}: {ruleActionLabel(rule.action)}</span>
              {rule.level && <span className="ruleTag lv">{rule.level}</span>}
              {src && <span className="ruleTag src">《{src}》</span>}
            </div>
            {rule.condition && <div className="ruleItemLine"><i>{t("触发条件", "Trigger")}</i>{localizeText(rule.condition)}</div>}
            <div className="ruleItemLine"><i>{t("依据 / 为什么", "Rationale")}</i>{localizeText(rule.description || t("基于专家知识库生成", "Generated from the expert knowledge base"))}</div>
            <div className="ruleItemBtns">
              {!approved && <button className="primaryButton sm" onClick={() => action(`/api/knowledge/rules/${rule.id}/approve`, { approved: true })}>{t("批准", "Approve")}</button>}
              {!approved && rule.status !== "已拒绝" && <button className="secondaryButton sm" onClick={() => action(`/api/knowledge/rules/${rule.id}/approve`, { approved: false })}>{t("拒绝", "Reject")}</button>}
              {approved && <button className="secondaryButton sm" onClick={() => ui.openPanel("riskRules")}>{t("查看风险规则", "View risk rules")}</button>}
              <button className="dangerTextButton sm" title={t("删除该规则草案", "Delete this rule draft")} onClick={async () => { if (await uiConfirm(t(`删除规则「${rule.name}」？`, `Delete rule “${rule.name}”?`))) action(`/api/knowledge/rules/${rule.id}`, {}, "DELETE"); }}><Trash2 size={14} /> {t("删除", "Delete")}</button>
            </div>
          </div>
        );
      })}
      <form className="panelForm compact" onSubmit={createRule}>
        <h3>{t("新增规则草案", "New rule draft")}</h3>
        <label>{t("名称", "Name")}<input value={newRule.name} onChange={(event) => setNewRule((current) => ({ ...current, name: event.target.value }))} placeholder={t("例如：重大事件前禁止高杠杆", "Example: block high leverage before major events")} /></label>
        <label>{t("说明", "Description")}<textarea value={newRule.description} onChange={(event) => setNewRule((current) => ({ ...current, description: event.target.value }))} /></label>
        <div className="formGrid">
          <label>{t("等级", "Level")}<select value={newRule.level} onChange={(event) => setNewRule((current) => ({ ...current, level: event.target.value }))}><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
          <label>{t("动作", "Action")}<select value={newRule.action} onChange={(event) => setNewRule((current) => ({ ...current, action: event.target.value }))}><option value="notify">{t("通知", "Notify")}</option><option value="reject_entry">{t("拒绝当前入场", "Reject this entry")}</option><option value="pause_opening">{t("暂停当前计划开仓", "Pause this plan's entry")}</option></select></label>
        </div>
        <button className="primaryButton" type="submit">{t("提交草案", "Submit draft")}</button>
      </form>
    </div>
  );
}

// 风险事件处理:列出未处理事件(按标题归并去重,给出条数),支持逐条关闭与「全部标记已处理」。
// 只读助手不能改状态,处理入口收在这里。对账类重复告警已在服务端折叠成一条。
export function RiskIncidentsPanel({ data, action, ui }) {
  const open = (data.riskIncidents || []).filter((i) => i.status === "open");
  const groups = [];
  for (const inc of open) {
    const key = inc.title || inc.source || t("风险事件", "Risk incident");
    const g = groups.find((x) => x.key === key);
    if (g) { g.count += 1; g.items.push(inc); if (SEVERITY_RANK(inc.severity) > SEVERITY_RANK(g.severity)) g.severity = inc.severity; }
    else groups.push({ key, count: 1, severity: inc.severity, items: [inc] });
  }
  async function closeOne(id) { await action(`/api/risk/incidents/${id}/close`, {}); }
  async function closeGroup(g) { for (const inc of g.items) await action(`/api/risk/incidents/${inc.id}/close`, {}); ui.notify?.(t(`已处理 ${g.count} 项「${g.key}」`, `Resolved ${g.count} “${g.key}” incidents`)); }
  async function closeAll() { await action(`/api/risk/incidents/close-all`, {}); ui.notify?.(t("已标记全部为已处理", "All incidents marked resolved")); }
  return (
    <div className="panelStack">
      <div className="panelToolbar">
        <span className="fieldHint">{t(`未处理事件 ${open.length} 项${groups.length ? `（${groups.length} 类）` : ""}`, `${open.length} unresolved incident${open.length === 1 ? "" : "s"}${groups.length ? ` in ${groups.length} groups` : ""}`)}</span>
        {open.length > 0 && <button className="secondaryButton sm" onClick={closeAll}>{t("全部标记已处理", "Mark all resolved")}</button>}
      </div>
      {open.length === 0 && <p className="fieldHint">{t("当前没有未处理的风险事件。", "There are no unresolved risk incidents.")}</p>}
      {groups.map((g) => (
        <div className="incidentGroup" key={g.key}>
          <div className="incidentGroupHead">
            <span className={`pill ${SEVERITY_TONE(g.severity)}`}>{humanizeSeverity(g.severity)}</span>
            <b>{localizeText(g.key)}</b>
            {g.count > 1 && <span className="incidentCount">×{g.count}</span>}
          </div>
          <div className="incidentGroupBody">
            <span className="fieldHint">{t("最近", "Latest")} {formatDateTime(g.items[0]?.createdAt)}</span>
            <button className="secondaryButton sm" onClick={() => (g.count > 1 ? closeGroup(g) : closeOne(g.items[0].id))}>
              {g.count > 1 ? t(`处理这 ${g.count} 项`, `Resolve these ${g.count}`) : t("标记已处理", "Mark resolved")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
function SEVERITY_RANK(s) { return { critical: 4, high: 3, medium: 2, low: 1 }[String(s || "").toLowerCase()] || 0; }
function SEVERITY_TONE(s) { const r = SEVERITY_RANK(s); return r >= 3 ? "bad" : r === 2 ? "warn" : "good"; }
function humanizeSeverity(s) { return ({ critical: t("严重", "Critical"), high: t("高", "High"), medium: t("中", "Medium"), low: t("低", "Low") }[String(s || "").toLowerCase()] || t("提示", "Notice")); }

export function SkillImportPanel({ data, action, ui }) {
  const [form, setForm] = useState({ name: "", sourceUrl: "", skillMd: "", kind: "auto" });
  async function submit(event) {
    event.preventDefault();
    if (!form.sourceUrl.trim() && !form.skillMd.trim()) return ui.notify(t("请填写 GitHub/URL 或粘贴 Skill.md", "Enter a GitHub/URL source or paste Skill.md"));
    await action("/api/skills/fetch", {
      name: form.name.trim(),
      sourceUrl: form.sourceUrl.trim(),
      skillMd: form.skillMd,
      // auto → 不传 kind,由后端按 SKILL.md 内容自动判定;显式选择则强制归类。
      ...(form.kind === "auto" ? {} : { kind: form.kind })
    });
    setForm({ name: "", sourceUrl: "", skillMd: "", kind: "auto" });
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <label>{t("Skill 名称", "Skill name")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("可留空，自动读取 SKILL.md 标题", "Optional; the SKILL.md title is used automatically")} /></label>
        <label>{t("归类", "Category")}<select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}>
          <option value="auto">{t("自动判定（含方向/入场/止损则归为策略，否则归为工具）", "Auto-detect (strategy when it contains direction/entry/stop; otherwise tool)")}</option>
          <option value="strategy">{t("策略库（输出方向、入场与止损主张）", "Strategy library (produces direction, entry, and stop claims)")}</option>
          <option value="tool">{t("能力库（供 Agent 调用的分析或执行工具）", "Capability library (analysis or execution tools available to the Agent)")}</option>
        </select></label>
        <label>GitHub / Skill.md URL<input value={form.sourceUrl} onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://github.com/user/skill or https://.../SKILL.md" /></label>
        <label>{t("Skill.md 内容", "Skill.md content")}<textarea className="largeTextarea" value={form.skillMd} onChange={(event) => setForm((current) => ({ ...current, skillMd: event.target.value }))} placeholder="# Skill Name" /></label>
        <button className="primaryButton" type="submit">{t("导入 Skill", "Import skill")}</button>
      </form>
      <p className="fieldHint">{t("按归类保存：策略进入研究中心·策略库；工具进入研究中心·能力库。导入后可扫描、启用、运行、删除或查看详情。", "Items are stored by category: strategies go to Research · Strategies, and tools go to Research · Capabilities. After import, you can scan, enable, run, delete, or inspect them.")}</p>
    </div>
  );
}

export function TaskManagerPanel({ data, action }) {
  const [form, setForm] = useState({ name: "", type: "Every", schedule: "Every 5m", role: t("提醒", "Reminder"), handler: "reminder", kind: "standard", mission: "" });
  const [taskFilter, setTaskFilter] = useState("all");
  const tasks = data.tasks || [];
  const taskTabs = [
    ["all", t("全部", "All"), tasks.length],
    ["Every", "Every", tasks.filter((task) => task.type === "Every").length],
    ["Cron", "Cron", tasks.filter((task) => task.type === "Cron").length],
    ["At", "At", tasks.filter((task) => task.type === "At").length]
  ];
  const visibleTasks = taskFilter === "all" ? tasks : tasks.filter((task) => task.type === taskFilter);
  function updateType(type) {
    // datetime-local 按本地时区解释;直接 toISOString 会差出一个时区(东八区默认值显示成 7 小时前,审计 M5)
    const localAtDefault = () => { const d = new Date(Date.now() + 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
    const schedule = type === "Cron" ? "*/5 * * * *" : type === "At" ? localAtDefault() : "Every 5m";
    setForm((current) => ({ ...current, type, schedule }));
  }
  const isMission = form.kind === "mission";
  async function submit(event) {
    event.preventDefault();
    const name = (form.name || form.mission).trim().slice(0, 40);
    if (!name) return;
    if (isMission && !form.mission.trim()) return;
    const schedule = form.type === "At" ? new Date(form.schedule).toISOString() : form.schedule.trim();
    const payload = { name, type: form.type, schedule, enabled: true, role: isMission ? "intelligence" : form.role, handler: isMission ? "agent_mission" : form.handler };
    if (isMission) payload.mission = form.mission.trim();
    await action("/api/tasks", payload);
    setForm((current) => ({ ...current, name: "", mission: "" }));
  }
  return (
    <div className="panelStack">
      <form className="panelForm" onSubmit={submit}>
        <div className="taskTabs taskKindSwitch">
          <button type="button" className={!isMission ? "active" : ""} onClick={() => setForm((current) => ({ ...current, kind: "standard" }))}>{t("常规任务", "Standard task")}</button>
          <button type="button" className={isMission ? "active" : ""} onClick={() => setForm((current) => ({ ...current, kind: "mission" }))}>{t("情报 · 自由任务", "Intelligence mission")}</button>
        </div>
        <label>{t("任务名称", "Task name")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={isMission ? t("例如：俄乌停战跟踪（留空自动取目标）", "Example: track ceasefire developments (leave blank to use the objective)") : t("例如：行情扫描 / 知识过期检查", "Example: market scan / knowledge freshness check")} /></label>
        {isMission && (
          <label>{t("追踪目标（自然语言）", "Objective (plain language)")}<textarea rows={2} value={form.mission} onChange={(event) => setForm((current) => ({ ...current, mission: event.target.value }))} placeholder={t("例如：每天追踪停战进展并总结市场影响；或：盯 ETH ETF 审批，有变化就产出简报", "Example: track ceasefire developments daily and summarize market impact; or monitor ETH ETF approval and publish a brief when it changes")} /></label>
        )}
        <div className="formGrid">
          <label>{t("触发类型", "Trigger type")}<select value={form.type} onChange={(event) => updateType(event.target.value)}><option>Every</option><option>Cron</option><option>At</option></select></label>
          {!isMission && <label>{t("任务分类", "Task category")}<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} /></label>}
        </div>
        {!isMission && <label>{t("执行内容", "Action")}<select value={form.handler} onChange={(event) => setForm((current) => ({ ...current, handler: event.target.value }))}><option value="reminder">{t("通知中心提醒", "Notification reminder")}</option><option value="accounting_refresh">{t("刷新账务统计", "Refresh accounting")}</option><option value="reconcile">{t("执行账户对账", "Reconcile account")}</option><option value="event_refresh">{t("刷新市场情报", "Refresh market intelligence")}</option><option value="market_signal_refresh">{t("刷新市场信号", "Refresh market signals")}</option><option value="strategy_research">{t("运行策略研究", "Run strategy research")}</option><option value="paper_forward">{t("推进模拟前向", "Advance paper validation")}</option><option value="trade_reflection">{t("生成平仓复盘", "Generate trade reflection")}</option><option value="missed_opportunity_review">{t("复盘错过机会", "Review missed opportunities")}</option></select><small className="fieldHint">{t("任务必须选择真实执行器；不会再用任务名称猜测并把空跑记成成功。", "Each task uses a real handler; names are never guessed and no-op runs are not reported as successful.")}</small></label>}
        <label>{form.type === "At" ? t("运行时间", "Run time") : t("触发表达式", "Schedule expression")}<input type={form.type === "At" ? "datetime-local" : "text"} value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} /></label>
        {isMission && <span className="fieldHint">{t("Agent 会按计划刷新情报、匹配相关事件并产出简报，可在通知与情报中心查看。无 API key 也能运行，配置 LLM 后分析更完整。", "The Agent refreshes intelligence on schedule, matches related events, and publishes briefs in Notifications and Intelligence. It can run without an API key; an LLM provides richer analysis.")}</span>}
        <button className="primaryButton" type="submit">{isMission ? t("派发情报任务", "Create intelligence mission") : t("创建任务", "Create task")}</button>
      </form>
      <div className="taskManagerList">
        <div className="taskManagerHead">
          <strong>{t("已创建任务", "Created tasks")}</strong>
          <div className="taskTabs">{taskTabs.map(([id, label, count]) => <button className={taskFilter === id ? "active" : ""} key={id} onClick={() => setTaskFilter(id)}>{label} {count}</button>)}</div>
        </div>
        <div className="taskManagerScroll">
          {visibleTasks.map((task) => (
            <div className="panelItem" key={task.id}>
              <div><strong>{localizeText(task.name)}{task.systemManaged&&<small> · {t("系统托管", "System-managed")}</small>}</strong><small>{humanize(task.handler||"reminder")} · {task.schedule || "-"} · {t("下次", "Next")} {formatDateTime(task.nextRunAt, t("未排期", "Not scheduled"))}</small>{task.lastBriefing&&<small title={task.lastBriefing}>{t("最近简报", "Latest brief")}: {task.lastBriefing.slice(0,120)}</small>}</div>
              <StatusBadge tone={task.enabled === false ? "warning" : "ok"}>{task.enabled === false ? t("已暂停", "Paused") : humanize(task.status, t("运行中", "Running"))}</StatusBadge>
              <span className="panelActions"><button className="secondaryButton" disabled={task.enabled===false} onClick={() => action(`/api/tasks/${task.id}/run`, {})}>{t("运行", "Run")}</button><button className="secondaryButton" onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? t("恢复", "Resume") : t("暂停", "Pause")}</button>{!task.systemManaged&&<button className="secondaryButton dangerText" onClick={() => action(`/api/tasks/${task.id}`, {}, "DELETE")}>{t("删除", "Delete")}</button>}</span>
            </div>
          ))}
          {!visibleTasks.length && <div className="emptyPanel emptyPanelAction"><strong>{tasks.length ? t("当前类型暂无任务", "No tasks of this type") : t("暂无任务", "No tasks")}</strong><span>{tasks.length ? t("切换上方类型查看其他已创建任务。", "Select another type above to view other tasks.") : t("创建任务后会进入调度器，并在运行日志中留下记录。", "Created tasks enter the scheduler and leave an execution record in the run log.")}</span></div>}
        </div>
      </div>
    </div>
  );
}

export function EventSourcesPanel({ data, action, ui }) {
  const [form, setForm] = useState({ name: "", type: "rss", url: "", trustScore: 80 });
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) {
      ui.notify(t("请填写事件源名称和 URL", "Enter an event source name and URL"));
      return;
    }
    await action("/api/event-sources", { ...form, trustScore: Number(form.trustScore || 80) });
    setForm({ name: "", type: form.type, url: "", trustScore: form.trustScore });
  }
  const sources = data.eventSources || [];
  const host = (u) => { try { return new URL(u).host; } catch { return u || ""; } };
  return (
    <div className="panelStack">
      <button className="primaryButton" onClick={() => action("/api/event-sources/refresh", {})}><RefreshCw size={14} /> {t("刷新事件源", "Refresh sources")}</button>

      <div className="evtSrcList">
        <h3>{t("已配置的事件源", "Configured event sources")} <small>{sources.length}</small></h3>
        {!sources.length && <div className="emptyPanel"><span>{t("还没有事件源。用下面的表单添加 RSS 地址。", "No event sources yet. Add an RSS URL with the form below.")}</span></div>}
        {sources.map((s) => (
          <div className={`evtSrcRow ${s.enabled === false ? "off" : ""}`} key={s.id}>
            <div className="evtSrcMain">
              <strong>{localizeText(s.name || t("未命名源", "Unnamed source"))}</strong>
              <small>{humanize(s.type || "rss")} · {t("可信度", "Trust")} {s.trustScore ?? "-"}{s.url ? ` · ${host(s.url)}` : ""}</small>
              <small className="evtSrcStatus">
                {s.lastStatus === "ok"
                  ? <span className="ok">✓ {s.lastItemCount != null ? t(`上次抓 ${s.lastItemCount} 条`, `${s.lastItemCount} items fetched`) : t("上次抓取成功", "Last fetch succeeded")} · {formatDateTime(s.lastFetchedAt, t("刚刚", "Just now"))}</span>
                  : s.lastStatus === "failed"
                    ? <span className="bad" title={s.lastError || ""}>✗ {t("抓取失败", "Fetch failed")}: {localizeText((s.lastError || t("未知错误", "Unknown error")).slice(0, 40))}</span>
                    : <span className="muted">{t("尚未抓取", "Not fetched yet")}</span>}
              </small>
            </div>
            <button className="secondaryButton" title={t("立即测试连接和解析", "Test connectivity and parsing now")} onClick={() => action(`/api/event-sources/${s.id}/test`, {})}>{t("测试", "Test")}</button>
            <button className="secondaryButton" title={s.enabled === false ? t("启用", "Enable") : t("停用", "Disable")} onClick={() => action(`/api/event-sources/${s.id}`, { enabled: s.enabled === false }, "PATCH")}>{s.enabled === false ? t("启用", "Enable") : t("停用", "Disable")}</button>
            <button className="dangerTextButton" title={t("删除该事件源（已抓取的历史事件会保留）", "Delete this source (previously fetched events are retained)")} onClick={async () => { if (await uiConfirm(t(`删除事件源「${s.name}」？之后不再从它抓取（历史事件保留）。`, `Delete event source “${s.name}”? Future fetching stops; historical events are retained.`))) action(`/api/event-sources/${s.id}`, {}, "DELETE"); }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <form className="panelForm compact" onSubmit={submit}>
        <h3>{t("新增事件源", "New event source")}</h3>
        <label>{t("名称", "Name")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("例如：交易所公告 / 宏观日历 RSS", "Example: exchange announcements / macro calendar RSS")} /></label>
        <label>URL<input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder={t("https://…（优先填写 RSS 地址）", "https://… (RSS preferred)")} /></label>
        <div className="formGrid">
          <label>{t("类型", "Type")}<select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="rss">{t("RSS（推荐）", "RSS (recommended)")}</option><option value="html">{t("HTML 网页", "HTML page")}</option></select></label>
          <label>{t("可信度", "Trust score")}<input type="number" min="1" max="100" value={form.trustScore} onChange={(event) => setForm((current) => ({ ...current, trustScore: event.target.value }))} /></label>
        </div>
        <button className="primaryButton" type="submit">{t("保存事件源", "Save source")}</button>
      </form>
    </div>
  );
}

export function AuditChainPanel({ data }) {
  const latestPlan = data.tradePlans?.[0] || {};
  const latestRisk = data.riskChecks?.[0] || latestPlan.lastRiskCheck || {};
  const latestOrder = data.orders?.[0] || data.executionOrders?.[0] || {};
  const auditHealthy = data.readiness?.checks?.find((item) => item.key === "audit_chain")?.configured === true;
  const wormConfigured = data.readiness?.checks?.find((item) => item.key === "audit_worm")?.configured === true;
  const chainItems = [
    [t("交易权限", "Trading permissions"), latestPlan.mandateId, humanize(data.agentStatus?.activeMandate?.status, t("未授权", "Not authorized"))],
    [t("分析证据包", "Analysis evidence bundle"), latestPlan.analysisBundleId, latestPlan.analysisBundleId ? t("已生成", "Generated") : t("未生成", "Not generated")],
    [t("交易计划", "Trade plan"), latestPlan.id, humanize(latestPlan.status, t("未生成", "Not generated"))],
    [t("风险校验", "Risk check"), latestPlan.riskCheckId || latestRisk.id, humanize(latestRisk.decision || latestRisk.result, t("未检查", "Not checked"))],
    [t("执行", "Execution"), latestOrder.id, humanize(latestOrder.status, t("真实交易关闭", "Live execution off"))],
    [t("结算对账", "Settlement reconciliation"), data.reconciliationReports?.[0]?.id, humanize(data.reconciliationReports?.[0]?.status, t("未对账", "Not reconciled"))],
    [t("复盘审查", "Trade review"), data.reviews?.[0]?.id, data.reviews?.[0]?.id ? t("已记录", "Recorded") : t("未生成", "Not generated")]
  ];
  return (
    <div className="panelStack">
      <div className="panelItem">
        <div><strong>{t("本地审计哈希链", "Local audit hash chain")}</strong><small>{auditHealthy ? t("完整性校验通过", "Integrity verification passed") : t("校验失败，已阻止新开仓", "Verification failed; new entries are blocked")}</small></div>
        <StatusBadge tone={auditHealthy ? "good" : "bad"}>{auditHealthy ? t("正常", "Healthy") : t("断链", "Broken")}</StatusBadge>
      </div>
      <div className="panelItem">
        <div><strong>{t("外部不可篡改归档", "External immutable archive")}</strong><small>{wormConfigured ? t("WORM 接收端已配置", "WORM endpoint configured") : t("尚未配置；不影响本地校验，但不具备外部不可篡改保证", "Not configured; local verification remains available without external immutability")}</small></div>
        <StatusBadge tone={wormConfigured ? "good" : "warning"}>{wormConfigured ? t("已配置", "Configured") : t("未配置", "Not configured")}</StatusBadge>
      </div>
      {chainItems.map(([label, value, state], index) => (
        <div className="panelItem" key={label}>
          <div><strong>{index + 1}. {label}</strong><small>{value || t("未生成 ID", "No ID generated")}</small></div>
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
        <RiskLine label={t("订单 ID", "Order ID")} value={latestOrder.id || t("未生成", "Not generated")} />
        <RiskLine label={t("交易计划 ID", "Trade plan ID")} value={latestPlan.id || t("未生成", "Not generated")} />
        <RiskLine label={t("风险校验 ID", "Risk check ID")} value={latestPlan.riskCheckId || latestRisk.id || t("未生成", "Not generated")} />
        <RiskLine label={t("交易对", "Pair")} value={latestPlan.symbol || latestOrder.symbol || "-"} />
        <RiskLine label={t("方向 / 类型", "Side / type")} value={`${humanize(latestPlan.direction || latestOrder.side, "-")} / ${humanize(latestOrder.type || latestPlan.entry?.type, "-")}`} />
        <RiskLine label={t("执行状态", "Execution status")} value={humanize(latestOrder.status, t("真实交易关闭", "Live execution off"))} />
        <RiskLine label={t("对账结果", "Reconciliation",)} value={humanize(data.reconciliationReports?.[0]?.status, t("未对账", "Not reconciled"))} />
      </div>
      {!latestOrder.id && !latestPlan.id && <div className="emptyPanel emptyPanelAction"><strong>{t("暂无执行对象", "No execution item")}</strong><span>{t("生成交易计划并通过风控后，这里会展示订单、风险校验和对账详情。", "After a trade plan passes risk checks, its order, risk, and reconciliation details appear here.")}</span></div>}
    </div>
  );
}

// 实盘写入与灰度发布(独立组件):按用户要求从「系统设置」整体迁到「风控与授权」页——
// 灰度的每一项(额度/人工确认/安全闸)本质都是风控边界,放风控页更合理。
export function LiveGrayPanel({ data, action, ui }) {
  const live = data.config?.liveTrading || {};
  const buildLiveForm = () => ({
    liveTradingEnabled: Boolean(live.liveTradingEnabled),
    acknowledged: Boolean(live.acknowledged),
    orderWriteEnabled: Boolean(live.orderWriteEnabled),
    grayEnabled: Boolean(live.grayEnabled),
    grayRequiresApproval: live.grayRequiresApproval !== false,
    allowedSymbols: Array.isArray(live.grayAllowedSymbols) ? live.grayAllowedSymbols : [],
    maxNotionalUsdt: live.maxNotionalUsdt || 50
  });
  const [liveForm, setLiveForm] = useState(buildLiveForm);
  useEffect(() => { setLiveForm(buildLiveForm()); }, [live.liveTradingEnabled, live.acknowledged, live.orderWriteEnabled, live.grayEnabled, live.grayRequiresApproval, live.maxNotionalUsdt, JSON.stringify(live.grayAllowedSymbols || [])]);
  function updateLive(key, value) {
    setLiveForm((current) => ({ ...current, [key]: value }));
  }
  async function saveLive(event) {
    event.preventDefault();
    if (liveForm.liveTradingEnabled && !liveForm.acknowledged) {
      ui?.notify?.(t("开启实盘前必须勾选风险确认", "Acknowledge the live-trading risk before enabling live trading"));
      return;
    }
    await action("/api/config/live-trading", {
      ...liveForm,
      maxNotionalUsdt: Number(liveForm.maxNotionalUsdt || 50)
    });
  }
  const snapshotOk = data.readiness?.checks?.find((c) => c.key === "private_rest_positions")?.configured ?? false;
  const mandateOk = Boolean(data.agentStatus?.activeMandate);
  const withdrawOk = data.readiness?.checks?.find((c) => c.key === "withdraw_permission_detection")?.configured ?? false;
  // 安全门缺数据时默认"未通过"(false),不再 ?? true 把未知当已通过。
  const auditOk = data.readiness?.checks?.find((c) => c.key === "audit_chain")?.configured ?? false;
  const gates = [
    { ok: Boolean(live.liveTradingEnabled), label: t("实盘交易总开关", "Live trading enabled"), short: t("实盘交易", "Live trading"), hint: t("开启“实盘交易”", "Enable Live trading") },
    { ok: Boolean(live.acknowledged), label: t("已确认真实资金风险", "Real-money risk acknowledged"), short: t("风险确认", "Risk acknowledged"), hint: t("确认真实资金交易风险", "Acknowledge real-money trading risk") },
    { ok: Boolean(live.orderWriteEnabled), label: t("允许发送真实订单", "Real order submission enabled"), short: t("真实订单", "Order submission"), hint: t("开启“允许发送真实订单”", "Enable real order submission") },
    { ok: Boolean(live.grayEnabled), label: t("小额实盘验证", "Small-size live validation"), short: t("小额验证", "Small-size validation"), hint: t("开启小额实盘验证并设置额度和币种", "Enable small-size validation and set its amount and pairs") },
    { ok: mandateOk, label: t("有效交易权限", "Active trading permissions"), short: t("交易权限", "Permissions"), hint: t("先创建并启用交易权限", "Create and activate trading permissions") },
    { ok: snapshotOk, label: t("账户已同步", "Account synced"), short: t("账户同步", "Account sync"), hint: t("配置 OKX 后同步账户", "Configure OKX and sync the account") },
    { ok: withdrawOk, label: t("已确认禁止提现", "Withdrawals confirmed disabled"), short: t("禁止提现", "No withdrawals"), hint: t("在交易所连接中确认 API Key 无提现权限", "Confirm that the OKX API key cannot withdraw") },
    { ok: !data.system?.killSwitch, label: t("未触发紧急停止", "Emergency stop is clear"), short: t("可运行", "Not stopped"), hint: t("解除顶部“紧急停止”", "Clear the emergency stop") },
    { ok: auditOk, label: t("审计链正常", "Audit chain healthy"), short: t("审计链", "Audit chain"), hint: t("先修复审计链异常", "Resolve the audit-chain issue") }
  ];
  const pass = gates.filter((g) => g.ok).length;
  const failing = gates.filter((g) => !g.ok);
  const marks = "①②③④⑤⑥⑦⑧⑨";
  const hintLine = failing.length
    ? `${t("还差", "Still needed:")} ${failing.length} ${t("项", "items")} → ` + failing.map((g, i) => `${marks[i] || "·"}${g.hint}`).join(t("；", "; "))
    : t("全部就绪，系统可以按当前执行方式发送真实订单。", "All checks passed. The system can submit live orders under the selected execution mode.");
  return (
          <form className="panelForm liveGrayForm" onSubmit={saveLive}>
            {/* 就绪清单：9 项压成一排彩色胶囊 + 一句"还差什么" */}
            <div className="lgReady">
              <div className="lgReadyHead">
                <span>{t("实盘交易检查 · 全部通过后才会发送真实订单", "Live trading checks · real orders require every check to pass")}</span>
                <b className={pass === gates.length ? "ok" : "warn"}>{pass}/{gates.length} {t("通过", "passed")}</b>
              </div>
              <div className="lgGates">
                {gates.map((g) => (
                  <span key={g.label} className={`lgGate ${g.ok ? "ok" : "bad"}`} title={g.ok ? g.label : g.hint}>
                    {g.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{g.short}
                  </span>
                ))}
              </div>
              <p className={`lgHint ${failing.length ? "" : "ok"}`}>{hintLine}</p>
            </div>
            {/* 两组开关并排成两列，压缩高度使本卡与 MANDATE 卡齐平 */}
            <div className="lgGroups">
              <div className="lgGroup">
                <div className="lgGroupHead"><span className="dot" /> {t("真实订单权限 · 三项必须全部开启", "Live-order permissions · all three are required")}</div>
                <div className="lgSwitches">
                  <label className="lgSw"><input type="checkbox" checked={liveForm.liveTradingEnabled} onChange={(event) => updateLive("liveTradingEnabled", event.target.checked)} /><span>{t("开启实盘交易", "Enable live trading")}<span className="sub">{t("允许系统进入真实资金交易流程", "Allow the system to enter the real-money workflow")}</span></span></label>
                  <label className="lgSw"><input type="checkbox" checked={liveForm.acknowledged} onChange={(event) => updateLive("acknowledged", event.target.checked)} /><span>{t("确认真实资金风险", "Acknowledge real-money risk")}<span className="sub">{t("我了解真实订单可能造成资金损失", "I understand that live orders can lose money")}</span></span></label>
                  <label className="lgSw"><input type="checkbox" checked={liveForm.orderWriteEnabled} onChange={(event) => updateLive("orderWriteEnabled", event.target.checked)} /><span>{t("允许发送真实订单", "Allow real order submission")}<span className="sub">{t("关闭时仅记录决策，不向 OKX 发单", "When off, decisions are recorded but no order is sent to OKX")}</span></span></label>
                </div>
              </div>
              <div className="lgGroup">
                <div className="lgGroupHead"><span className="dot" /> {t("小额验证与确认方式", "Small-size validation & approvals")}</div>
                <div className="lgSwitches">
                  <label className="lgSw"><input type="checkbox" checked={liveForm.grayEnabled} onChange={(event) => updateLive("grayEnabled", event.target.checked)} /><span>{t("启用小额实盘验证", "Enable small-size live validation")}<span className="sub">{t("先用较小额度验证真实执行链路", "Validate the live execution path with smaller orders first")}</span></span></label>
                  <label className="lgSw"><input type="checkbox" checked={liveForm.grayRequiresApproval} onChange={(event) => updateLive("grayRequiresApproval", event.target.checked)} /><span>{t("每笔交易需要确认", "Require approval for each trade")}<span className="sub">{t("关闭后，额度内计划可自动执行", "When off, eligible plans within the limit may execute automatically")}</span></span></label>
                </div>
                <label className="symbolLabel lgSymbols">{t("小额验证交易对", "Pairs allowed for small-size validation")}<SymbolMultiSelect value={liveForm.allowedSymbols} onChange={(next) => updateLive("allowedSymbols", next)} /></label>
                <div className="lgHint">{liveForm.allowedSymbols?.length
                  ? t(`只允许这 ${liveForm.allowedSymbols.length} 个交易对进行小额实盘验证；其他交易对会被阻止。`, `Only these ${liveForm.allowedSymbols.length} pairs may enter small-size live validation; all others are blocked.`)
                  : t("留空表示不增加额外币种限制，仍受交易权限和单笔额度约束。", "Leave blank to add no extra pair restriction; trading permissions and the per-trade amount still apply.")}</div>
              </div>
            </div>
            {/* 用后端唯一真相 automationState.mode 判定,别再自己拿 2 个开关猜(审计 gating:
                旧横幅只看 live+gray,实盘写入没开/自主暂停/熔断照样喊"已开启")。*/}
            {data.automationState?.mode === "full_auto_small" ? (
              <div className="autoTradeBanner on">🤖 {t("自动执行已开启：符合交易权限和风险限制的计划可在单笔额度内自动下单，超出额度仍需确认。", "Automatic execution is on. Eligible plans may trade within the per-trade limit; larger trades still require approval.")}</div>
            ) : (
              <div className="autoTradeBanner off">{t("当前执行方式：", "Current mode: ")}{localizeText(data.automationState?.label,t("逐笔确认", "Per-trade approval"))}{t("。", ". ")}{data.automationState?.blockers?.length ? `${t("仍需完成", "Still required")}: ${data.automationState.blockers.map(localizeText).join(t("、", ", "))}` : t("AI 提出计划后，由你确认再下单。", "The AI proposes a plan and waits for your approval before ordering.")}</div>
            )}
            <div className="lgFoot">
              <label className="lgAmt">{t("单笔最高金额", "Max amount per trade")}<input type="number" min="1" value={liveForm.maxNotionalUsdt} onChange={(event) => updateLive("maxNotionalUsdt", event.target.value)} /> USDT</label>
              <button className="primaryButton" type="submit"><Zap size={14} /> {t("保存实盘设置", "Save live trading settings")}</button>
            </div>
            <div className="lgHint">{data.notionalLimits?.effectiveOrderMax != null
              ? t(`当前最终有效单笔上限 ${data.notionalLimits.effectiveOrderMax} USDT = 灰度 ${data.notionalLimits.grayOrderMax ?? "—"} 与交易权限 ${data.notionalLimits.mandateOrderMax ?? "—"} 取较小值。`, `Current effective order limit is ${data.notionalLimits.effectiveOrderMax} USDT: the lower of live validation ${data.notionalLimits.grayOrderMax ?? "—"} and trading permissions ${data.notionalLimits.mandateOrderMax ?? "—"}.`)
              : t("最终有效额度将在实盘灰度和交易权限都配置后显示。", "The effective limit appears after both live validation and trading permissions are configured.")}</div>
          </form>
  );
}
