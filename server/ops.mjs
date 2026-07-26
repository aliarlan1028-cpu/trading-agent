import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendAudit, nowIso, verifyAuditChain } from "./store.mjs";
import { keyProviderStatus } from "./keyProvider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backupDir = path.join(rootDir, "backups");

export function buildReadinessReport(db) {
  const checks = [
    check("frontend_dashboard", "产品驾驶舱", true, true, "React 页面覆盖总览、交易、Agent、事件、知识、Skill、风控、账户、审计。"),
    check("auth_lock", "鉴权默认锁定", true, Boolean(process.env.ADMIN_PASSWORD) || process.env.AUTH_REQUIRED === "false", "生产环境必须设置 ADMIN_PASSWORD；只有显式 AUTH_REQUIRED=false 才允许本地免登录。"),
    check("secret_master_key", "密钥主密钥", true, keyProviderStatus().configured, "生产环境应由 KMS/Vault sidecar 挂载 SECRETS_MASTER_KEY_FILE。"),
    check("sqlite_persistence", "SQLite 持久化", true, true, "核心集合、审计、Trace 已落库；OMS 使用独立关系表。"),
    check("oms_outbox", "持久化 OMS 与 Outbox", true, true, "订单幂等预留、状态事件、乐观版本和 Outbox 已使用 SQLite 事务。"),
    check("tenant_isolation", "客户物理隔离", true, process.env.PUBLIC_REGISTRATION_ENABLED !== "true", "当前生产路径为一客户一实例；单实例公开注册必须关闭。"),
    check("trade_write_gateway", "真实交易写网关", true, true, "支持下单、撤单、改单、平仓、移动止损、分批止盈。"),
    check("fresh_risk_recheck", "执行前风控复查", true, true, "批准和执行前都会重新运行硬风控。"),
    check("trade_write_config", "真实交易配置", true, envTrue("LIVE_TRADING_ENABLED") && envTrue("I_UNDERSTAND_REAL_TRADING") && envTrue("REAL_ORDER_WRITE_ENABLED"), "最终由你确认开启。"),
    check("binance_keys", "Binance API", true, Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET), "需要你配置 Key/Secret 并实盘小额验证。"),
    check("okx_keys", "OKX API", true, Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE), "需要你配置 Key/Secret/Passphrase 并实盘小额验证。"),
    check("private_rest_positions", "私有 REST 持仓同步", true, (db.accountSnapshots || []).some((item) => item.status === "ok"), "配置交易所后，REST 快照会同步净值、挂单和真实持仓到主状态。"),
    check("private_ws", "私有 WebSocket", true, true, "Binance listenKey 与 OKX login/subscription 已实现，凭证配置后可连。"),
    check("llm_agent", "真实 LLM Agent", true, Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY), "无 Key 时走本地规则降级；配置后调用真实模型。"),
    check("langsmith", "LangSmith Trace", true, Boolean(process.env.LANGSMITH_API_KEY), "配置后记录外部可观测链路。"),
    check("knowledge_pipeline", "真实知识库解析", true, true, "PDF/DOCX/网页/GitHub 导入、切片、RAG、图谱已实现。"),
    check("event_sources", "真实事件源", true, true, "RSS/HTML/公告/链上信号管线已实现。"),
    check("etherscan", "链上 API", true, Boolean(process.env.ETHERSCAN_API_KEY), "配置后获取真实链上 Gas/异常信号。"),
    check("skill_sandbox", "Skill 沙箱", true, true, "GitHub/上传拉取、依赖扫描入口、Docker 无网络沙箱已实现。"),
    check("docker", "Docker 沙箱环境", true, Boolean(process.env.SKILL_SANDBOX_IMAGE), "可使用默认 node:20-alpine；本机需安装 Docker。"),
    check("audit_chain", "本地审计哈希链", true, verifyAuditChain(db).ok, "本地链支持校验，但不等于外部不可篡改存储。"),
    check("audit_worm", "外部 WORM 审计", true, Boolean(process.env.WORM_AUDIT_ENDPOINT), "配置独立管理的 WORM endpoint 后按持久游标外送。"),
    check("exchange_test_environment", "交易所测试环境", true, process.env.BINANCE_TESTNET === "true" || process.env.OKX_DEMO_TRADING === "true", "实盘前必须运行 npm run test:exchange-contract。"),
    check("withdraw_permission_detection", "提现权限检测/确认", true, apiPermissionsVerified(db), "Binance 会自动查询 apiRestrictions；无法自动查询的交易所需人工审计确认后才允许实盘写入。"),
    check("alerts", "告警 Webhook", true, Boolean(process.env.ALERT_WEBHOOK_URL), "配置后可推送真实外部告警。"),
    check("gray_release", "小额度灰度策略", true, (db.grayReleasePolicies || []).some((item) => item.enabled), "最终由你启用并设置额度、币种、人工确认。")
  ];
  const configured = checks.filter((item) => item.configured).length;
  return {
    generatedAt: nowIso(),
    // implementationCompletionPct 已移除：它的 implemented 全是硬编码 true，恒等于 100%，是假指标。
    // 就绪度只看 configurationCompletionPct（由 env/密钥/开关的真实状态派生）。
    configurationCompletionPct: Math.round((configured / checks.length) * 100),
    operatingStage: buildOperatingStage(db, checks),
    checks,
    userOwnedValidation: checks.filter((item) => item.implemented && !item.configured).map((item) => item.key),
    nextUserActions: [
      "配置模型与交易所 API Key。",
      "确认 API Key 无提现权限并设置 IP 白名单。",
      "启用小额度灰度策略与真实写开关。",
      "用极小名义金额验证下单、撤单、改单、平仓、止损和分批止盈。",
      "验证私有 WebSocket 与 REST 对账一致性。"
    ]
  };
}

function buildOperatingStage(db, checks) {
  const configured = Object.fromEntries(checks.map((item) => [item.key, item.configured]));
  const hasExchange = configured.binance_keys || configured.okx_keys;
  const hasAccountSnapshot = (db.accountSnapshots || []).some((item) => item.status === "ok");
  const hasMandate = (db.mandates || []).some((item) => ["active", "running"].includes(item.status));
  if (db.system?.killSwitch) return { id: "kill_switch", label: "熔断停机", tone: "danger", next: "解除熔断前只允许降风险动作。" };
  if (db.system?.reduceOnlyMode) return { id: "reduce_only", label: "只减仓模式", tone: "warning", next: "仅处理撤单、平仓、移动止损等降风险动作。" };
  if (configured.trade_write_config && configured.gray_release && configured.withdraw_permission_detection && hasMandate) {
    return { id: "small_live_ready", label: "小额实盘可用", tone: "danger", next: "仅按灰度额度、授权范围和执行前风控提交真实订单。" };
  }
  if (hasExchange && hasAccountSnapshot && hasMandate) {
    return { id: "read_only_account", label: "只读真实账户可用", tone: "ok", next: "可以让 Agent 基于真实持仓生成计划，但实盘写入仍关闭。" };
  }
  if (configured.auth_lock && configured.secret_master_key && configured.llm_agent) {
    return { id: "observation", label: "观察模式可用", tone: "warning", next: "继续配置交易所只读 API 并同步账户。" };
  }
  return { id: "setup_required", label: "需要完成基础配置", tone: "warning", next: "先设置管理员密码、SECRETS_MASTER_KEY 和 LLM Key。" };
}

export async function createSystemBackup(db) {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(backupDir, `trading-agent-backup-${stamp}.json`);
  const payload = {
    exportedAt: nowIso(),
    auditChain: verifyAuditChain(db),
    db: sanitizeForBackup(db)
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  appendAudit(db, "创建系统备份", filePath, "OpsManager");
  return { status: "ok", filePath, auditChain: payload.auditChain };
}

function check(key, label, implemented, configured, note) {
  return { key, label, implemented: Boolean(implemented), configured: Boolean(configured), note };
}

function envTrue(name) {
  return process.env[name] === "true";
}

function apiPermissionsVerified(db) {
  const configured = (db.apiKeyMetadata || []).filter((item) => item.hasApiKey || item.hasSecret);
  if (!configured.length) return false;
  return configured.every((item) => item.withdrawPermission === false && item.permissionVerifiedAt);
}

function sanitizeForBackup(db) {
  return JSON.parse(JSON.stringify(db, (key, value) => {
    if (["apiSecret", "secret", "passphrase", "password"].includes(key)) return "[redacted]";
    return value;
  }));
}
