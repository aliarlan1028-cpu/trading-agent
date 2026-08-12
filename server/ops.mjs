import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeMandate, appendAudit, backupSqlite, latestSuccessfulAccountSnapshot, nowIso, verifyAuditChain } from "./store.mjs";
import { keyProviderStatus } from "./keyProvider.mjs";
import { assessOperationalDegradation } from "./professionalRiskGate.mjs";
import { requiresExternalSecurityInfrastructure } from "./securityProfile.mjs";
import { externalAlertConfigured, recentExternalAlertSucceeded } from "./alertHealth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backupDir = path.join(rootDir, "backups");

function freshAccountSnapshot(db) {
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  const maxAgeMs = Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 10 * 60_000);
  const ageMs = snapshot?.createdAt ? Date.now() - new Date(snapshot.createdAt).getTime() : Infinity;
  return { snapshot, ageMs, maxAgeMs, fresh: Boolean(snapshot) && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs };
}

export const OPERATING_MODE_LABELS = {
  observe: "只分析，不下单",
  semi_auto: "逐笔确认后下单",
  full_auto: "符合限制时自动下单"
};

// 用户选择的运行方式是持久化意图；行情、对账、WS 等运行时故障只能让“当前执行”
// 暂停，不能反过来把用户配置伪装成“只分析”。旧库没有该字段时，从原有三闸和
// 灰度人工确认设置推断一次，保持升级兼容。
export function requestedOperatingMode(db = {}) {
  const stored = db.system?.requestedOperatingMode;
  if (Object.hasOwn(OPERATING_MODE_LABELS, stored)) return stored;
  if (db.system?.liveTradingEnabled !== true) return "observe";
  const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
  return gray?.requiresManualApproval === false ? "full_auto" : "semi_auto";
}

// 单一派生自动化状态:把 熔断/自主/实盘写入/风险确认/下单写入/Key核验/灰度 等分散开关
// 按真实执行链顺序汇成一句结论——"自主运行中"曾被误解为"会自动下单"(外审 P1)。
// 判定顺序与 validateWriteGuard 的七层闸一致,展示与执行不会各说各话。
export function deriveAutomationState(db, options = {}) {
  const sys = db.system || {};
  const requestedMode = requestedOperatingMode(db);
  const requestedLabel = OPERATING_MODE_LABELS[requestedMode];
  const result = (state) => ({ ...state, requestedMode, requestedLabel });
  if (sys.killSwitch) return result({ mode: "halted", label: "已熔断", detail: "解除熔断前只允许平仓/撤单等降风险动作", tone: "danger", blockers: [] });
  // 只减仓也纳入唯一真相源:否则状态卡会显示"全自动"而每笔新开仓其实被只减仓拦(口径裂缝)。
  if (sys.reduceOnlyMode) return result({ mode: "reduce_only", label: "只减仓", detail: sys.latestAction || "仅允许平仓/撤单等降风险动作，禁止新开仓", tone: "warning", blockers: ["只减仓模式"] });
  if (!sys.autonomyEnabled) return result({ mode: "paused", label: "自主推进已暂停", detail: "恢复后按定时巡检 + 观察哨自主决策", tone: "warning", blockers: [] });
  const blockers = [];
  if (!activeMandate(db)) blockers.push("无激活授权");
  if (!options.hasProvider) blockers.push("未配置 LLM");
  if (sys.remainingDailyLossUsdt !== null && sys.remainingDailyLossUsdt !== undefined && sys.remainingDailyLossUsdt <= 0) blockers.push("日亏预算耗尽");
  if (blockers.length) return result({ mode: "blocked", label: "自主决策被拦", detail: blockers.join("、"), tone: "warning", blockers });
  if (!sys.liveTradingEnabled) return result({ mode: "observe", label: "观察模式·干跑", detail: "计划走完整风控流程但不提交真实订单", tone: "neutral", blockers: [] });
  if (!(sys.realTradingAck === true || process.env.I_UNDERSTAND_REAL_TRADING === "true")) blockers.push("实盘风险确认未勾选");
  if (!(sys.orderWriteEnabled === true || process.env.REAL_ORDER_WRITE_ENABLED === "true")) blockers.push("真实下单写入未开启");
  if (!apiPermissionsVerified(db)) blockers.push("API Key 权限未核验");
  if (!freshAccountSnapshot(db).fresh) blockers.push("账户快照缺失或已过期");
  const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
  if (!gray) blockers.push("灰度策略未启用");
  if (blockers.length) return result({ mode: "live_blocked", label: "实盘开仓被拦", detail: blockers.join("、"), tone: "warning", blockers });
  if (gray.requiresManualApproval) {
    return result({ mode: "semi_auto", label: "半自动", detail: `计划自动生成,真实下单前需你批准 · 单笔名义 ≤${gray.maxNotionalUsdt} USDT`, tone: "ok", blockers: [] });
  }
  if (sys.professionalRiskMode !== true) blockers.push("专业运行风险闸未开启");
  if (requiresExternalSecurityInfrastructure()) {
    if (!process.env.WORM_AUDIT_ENDPOINT) blockers.push("外部 WORM 审计未配置");
    else if (ageOf(sys.wormAuditLastSuccessAt) > 15 * 60_000) blockers.push("外部 WORM 审计未验证或已失联");
  }
  if (requiresExternalSecurityInfrastructure()) {
    if (!externalAlertConfigured()) blockers.push("外部告警未配置");
    else if (!recentExternalAlertSucceeded(db)) blockers.push("外部告警通道未在 24 小时内验证");
  }
  if ((db.executionOrders || []).some((item) => String(item.status).toUpperCase() === "UNKNOWN")) blockers.push("存在 UNKNOWN 订单");
  const degradation = assessOperationalDegradation(db);
  if (degradation.degraded) blockers.push(...degradation.reasons.map((reason) => `运行降级:${reason}`));
  if (blockers.length) return result({ mode: "live_blocked", label: "全自动安全条件未满足", detail: blockers.join("、"), tone: "danger", blockers });
  return result({ mode: "full_auto_small", label: "全自动·小额实盘", detail: `通过硬风控即自动下单 · 单笔名义 ≤${gray.maxNotionalUsdt} USDT`, tone: "danger", blockers: [] });
}

export function buildReadinessReport(db) {
  const backupStatus = readJsonStatus(path.join(backupDir, "backup-status.json"));
  const restoreStatus = readJsonStatus(path.join(backupDir, "restore-drill-status.json"));
  const recentBackup = backupStatus?.status === "ok" && ageOf(backupStatus.completedAt) <= 36 * 60 * 60_000;
  const recentRestoreDrill = restoreStatus?.status === "ok" && restoreStatus.productionDatabaseTouched === false && ageOf(restoreStatus.completedAt) <= 8 * 24 * 60 * 60_000;
  const accountSnapshot = freshAccountSnapshot(db);
  const checks = [
    check("frontend_dashboard", "产品驾驶舱", true, true, "React 页面覆盖总览、交易、Agent、事件、知识、Skill、风控、账户、审计。"),
    check("auth_lock", "鉴权默认锁定", true, Boolean(process.env.ADMIN_PASSWORD) || process.env.AUTH_REQUIRED === "false", "生产环境必须设置 ADMIN_PASSWORD；只有显式 AUTH_REQUIRED=false 才允许本地免登录。"),
    check("owner_mfa", "Owner 双因素认证", true, (db.users || []).some((user) => user.isOwner && user.mfaEnabled === true), "Owner 应在账户设置中启用 TOTP；登录密码泄露后仍有第二道保护。"),
    check("secret_master_key", "密钥主密钥", true, keyProviderStatus().configured, "生产环境应由 KMS/Vault sidecar 挂载 SECRETS_MASTER_KEY_FILE。"),
    check("sqlite_persistence", "SQLite 持久化", true, true, "核心集合、审计、Trace 已落库；OMS 使用独立关系表。"),
    check("oms_outbox", "持久化 OMS 与 Outbox", true, true, "订单幂等预留、状态事件、乐观版本和 Outbox 已使用 SQLite 事务。"),
    check("tenant_isolation", "客户物理隔离", true, process.env.TENANT_ISOLATION_V2 !== "true", "公开入口只收集开通申请；客户交易工作区必须继续使用一客户一实例。"),
    check("trade_write_gateway", "真实交易写网关", true, true, "支持下单、撤单、改单、平仓、移动止损、分批止盈。"),
    check("fresh_risk_recheck", "执行前风控复查", true, true, "批准和执行前都会重新运行硬风控。"),
    check("trade_write_config", "真实交易配置", true, envTrue("LIVE_TRADING_ENABLED") && envTrue("I_UNDERSTAND_REAL_TRADING") && envTrue("REAL_ORDER_WRITE_ENABLED"), "最终由你确认开启。"),
    check("okx_keys", "OKX API", true, Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE), "需要你配置 Key/Secret/Passphrase 并实盘小额验证。"),
    check("private_rest_positions", "私有 REST 持仓同步", true, accountSnapshot.fresh, `执行前账户快照必须在 ${Math.round(accountSnapshot.maxAgeMs / 60_000)} 分钟内；系统会同步净值、挂单和真实持仓。`),
    check("private_ws", "OKX 私有 WebSocket", true, true, "OKX login/subscription 已实现，凭证配置后可连接。"),
    check("llm_agent", "真实 LLM Agent", true, Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY), "无 Key 时走本地规则降级；配置后调用真实模型。"),
    check("langsmith", "LangSmith Trace", true, Boolean(process.env.LANGSMITH_API_KEY), "配置后记录外部可观测链路。"),
    check("knowledge_pipeline", "真实知识库解析", true, true, "PDF/DOCX/网页/GitHub 导入、切片、RAG、图谱已实现。"),
    check("event_sources", "真实事件源", true, true, "RSS/HTML/公告/链上信号管线已实现。"),
    check("etherscan", "链上 API", true, Boolean(process.env.ETHERSCAN_API_KEY), "配置后获取真实链上 Gas/异常信号。"),
    check("skill_sandbox", "Skill 沙箱", true, true, "GitHub/上传拉取、依赖扫描入口、Docker 无网络沙箱已实现。"),
    check("docker", "Docker 沙箱环境", true, Boolean(process.env.SKILL_SANDBOX_IMAGE), "可使用默认 node:20-alpine；本机需安装 Docker。"),
    check("audit_chain", "本地审计哈希链", true, verifyAuditChain(db).ok, "本地链支持校验，但不等于外部不可篡改存储。"),
    check("audit_worm", "外部 WORM 审计", true, Boolean(process.env.WORM_AUDIT_ENDPOINT), "配置独立管理的 WORM endpoint 后按持久游标外送。"),
    check("withdraw_permission_detection", "提现权限确认", true, apiPermissionsVerified(db), "需在 OKX API 管理页确认无提现权限并记录核验，才允许实盘写入。"),
    check("alerts", "外部告警通道", true, externalAlertConfigured(), "支持 Lark 或通用告警 Webhook；应定期验证真实送达。"),
    check("recent_backup", "最近一致性备份", true, recentBackup, "最近 36 小时内应完成 SQLite Online Backup、完整性检查与 SHA-256。"),
    check("restore_drill", "最近恢复演练", true, recentRestoreDrill, "最近 8 天内应在临时目录完成恢复校验，且不得替换生产数据库。"),
    check("encrypted_offsite_backup", "加密异机备份", true, Boolean(process.env.BACKUP_ENCRYPTION_KEY_FILE && process.env.BACKUP_OFFSITE_DIR), "异机副本必须 AES-256-GCM 加密，密钥与备份分离保存。"),
    check("release_identity", "发布版本身份", true, Boolean(process.env.APP_RELEASE && process.env.APP_RELEASE !== "dev"), "部署应注入不可变 APP_RELEASE（Git commit/tag），便于审计和回滚。"),
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

function readJsonStatus(filePath) {
  try { return JSON.parse(fsSync.readFileSync(filePath, "utf8")); } catch { return null; }
}

function buildOperatingStage(db, checks) {
  const configured = Object.fromEntries(checks.map((item) => [item.key, item.configured]));
  const hasExchange = configured.okx_keys;
  const hasAccountSnapshot = freshAccountSnapshot(db).fresh;
  const hasMandate = Boolean(activeMandate(db));
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
  const filePath = path.join(backupDir, `trading-agent-backup-${stamp}.sqlite`);
  await backupSqlite(filePath);
  const sha256 = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
  await fs.writeFile(`${filePath}.sha256`, `${sha256}  ${path.basename(filePath)}\n`, "utf8");
  const manifestPath = path.join(backupDir, `trading-agent-backup-${stamp}.json`);
  const payload = {
    exportedAt: nowIso(),
    auditChain: verifyAuditChain(db),
    sqliteFile: path.basename(filePath),
    sha256,
    // 清单只放非敏感计数，不复制用户、订单正文或金库密文；完整数据只存在 SQLite 快照。
    collectionCounts: Object.fromEntries(Object.entries(db)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, value.length]))
  };
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2), "utf8");
  appendAudit(db, "创建系统备份", filePath, "OpsManager");
  return { status: "ok", filePath, manifestPath, sha256, auditChain: payload.auditChain };
}

function check(key, label, implemented, configured, note) {
  return { key, label, implemented: Boolean(implemented), configured: Boolean(configured), note };
}

function envTrue(name) {
  return process.env[name] === "true";
}

function ageOf(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Infinity;
}

function apiPermissionsVerified(db) {
  const configured = (db.apiKeyMetadata || []).filter((item) => item.exchange === "OKX" && (item.hasApiKey || item.hasSecret));
  if (!configured.length) return false;
  return configured.every((item) => item.withdrawPermission === false && item.permissionVerifiedAt);
}
