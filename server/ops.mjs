import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeMandate, appendAudit, latestSuccessfulAccountSnapshot, nowIso, verifyAuditChain } from "./store.mjs";
import { createVerifiedBackup } from "./backupService.mjs";
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
  observe: "只分析",
  semi_auto: "逐笔确认",
  full_auto: "自动交易"
};

const REDUCE_ONLY_REASON_LABELS = {
  kill_switch: "紧急停止已开启",
  emergency_flatten: "一键平仓安全锁待确认",
  liquidation_emergency: "强平风险处置待收口",
  protection_emergency: "止损保护异常待收口",
  audit_chain_integrity: "审计链完整性异常",
  oms_recovery: "订单状态恢复对账中",
  armed_setup_recovery: "条件交易恢复对账中",
  financial_reconciliation_pending: "账户核算基线或费用对账未完成",
  professional_risk_gate: "专业运行风险闸降级",
  entry_reconciliation_pending: "入场订单对账中",
  cancel_reconciliation_pending: "撤单结果对账中",
  close_reconciliation_pending: "平仓结果对账中",
  protection_failure_reconciliation: "保护失败处置对账中",
  orphan_order_cancel_pending: "交易所孤儿挂单撤单中",
  credential_decryption_failed: "凭证解密失败"
};

function reduceOnlyReasonLabel(code = "") {
  if (REDUCE_ONLY_REASON_LABELS[code]) return REDUCE_ONLY_REASON_LABELS[code];
  if (code.startsWith("execution:")) {
    const status = code.slice("execution:".length);
    const statusLabels = {
      entry_unknown_pending: "入场订单结果未知",
      entry_partial: "入场部分成交待处置",
      cancel_pending: "撤单确认中",
      cancel_unknown_pending: "撤单结果未知",
      protection_failure_cancel_pending: "保护失败撤单中",
      close_pending: "平仓确认中",
      close_unknown_pending: "平仓结果未知",
      close_reconciliation_pending: "平仓成交对账中",
      group_close_pending: "组合平仓确认中",
      recovery_pending_reconciliation: "远端效果恢复对账中",
      emergency_close_pending: "紧急平仓确认中"
    };
    return statusLabels[status] || `执行状态待收口：${status}`;
  }
  return code ? `安全原因待解除：${code}` : "新开仓安全检查未完成";
}

const DEGRADATION_REASON_LABELS = {
  market_data_stale: "实时价格超过新鲜度要求",
  microstructure_data_stale: "盘口与微观结构数据已过期",
  private_ws_disconnected: "OKX 私有实时连接已断开",
  private_ws_credential_mismatch: "OKX 私有连接与当前 API Key 不一致",
  unknown_order_state: "存在结果未知的交易所订单",
  reconciliation_unhealthy: "OMS 与 OKX 对账已过期或异常",
  audit_chain_invalid: "审计记录链校验失败",
  worm_audit_unhealthy: "外部不可篡改审计通道不可用",
  external_alert_unhealthy: "外部告警通道不可用"
};

function reduceOnlyBlockers(db = {}) {
  const system = db.system || {};
  const raw = Array.isArray(system.reduceOnlyReasons) && system.reduceOnlyReasons.length
    ? system.reduceOnlyReasons
    : system.reduceOnlyBy ? [system.reduceOnlyBy] : [];
  const details = [...new Set(raw.filter(Boolean))].map((code) => {
    const base = { code, label: reduceOnlyReasonLabel(code), updatedAt: system.updatedAt || null };
    if (code === "financial_reconciliation_pending") {
      const portfolio = db.portfolio || {};
      const today = Number(portfolio.pendingFinancialReconciliationToday || 0);
      const week = Number(portfolio.pendingFinancialReconciliationWeek || 0);
      const dailyStatus = portfolio.dailyBaselineStatus || "unknown";
      const weekStatus = portfolio.weekBaselineStatus || "unknown";
      const pending = [today > 0 ? `今日 ${today} 项` : null, week > 0 ? `近 7 日 ${week} 项` : null].filter(Boolean).join("、") || "状态待重新核验";
      return {
        ...base,
        label: base.label,
        detail: `待完成：${pending}。今日基线：${dailyStatus}；近 7 日基线：${weekStatus}。绩效只统计已完整归集开仓费、平仓费与资金费的交易。`,
        recovery: weekStatus === "period_start_snapshot_missing"
          ? "系统会继续回补成交费用并积累权威账户快照；形成可验证的周期起点且待处理项归零后自动恢复。"
          : "系统会持续回补成交、手续费、资金费和账户快照；待处理项归零后自动恢复。"
      };
    }
    if (code === "professional_risk_gate") {
      const assessment = assessOperationalDegradation(db);
      const reasons = assessment.reasons.map((reason) => DEGRADATION_REASON_LABELS[reason] || reason);
      return {
        ...base,
        label: reasons.length ? `运行数据暂不满足开仓要求（${reasons.join("、")}）` : base.label,
        detail: reasons.length ? `当前检测到：${reasons.join("、")}。这不会停止行情分析、撤单、平仓或已有仓位保护。` : "专业运行风险闸正在等待下一次健康检查。",
        recovery: "行情、连接或对账恢复后，系统会在下一次健康检查中自动解除，不需要重新选择自动交易。",
        updatedAt: assessment.assessedAt || base.updatedAt
      };
    }
    return { ...base, recovery: "对应的权威状态确认完成后，系统会自动重新评估是否恢复新开仓。" };
  });
  return details.length ? details : [{ code: "opening_paused", label: "新开仓安全检查未完成" }];
}

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
  const result = (state) => {
    const runtimeStatus = state.runtimeStatus || (
      state.mode === "halted" ? "emergency_stopped"
        : ["reduce_only", "paused", "blocked", "live_blocked"].includes(state.mode) ? "opening_paused"
          : "normal"
    );
    const runtimeLabel = state.runtimeLabel || ({
      emergency_stopped: "紧急停止",
      opening_paused: "暂停新开仓",
      normal: "正常运行"
    })[runtimeStatus];
    return {
      ...state,
      selectedMode: requestedMode,
      selectedModeLabel: requestedLabel,
      runtimeStatus,
      runtimeLabel,
      resumesAutomatically: runtimeStatus === "opening_paused" && state.mode !== "paused",
    blockerDetails: state.blockerDetails || (state.blockers || []).map((label) => ({ code: null, label })),
    requestedMode,
    requestedLabel
    };
  };
  if (sys.killSwitch) return result({ mode: "halted", label: "已熔断", detail: "解除熔断前只允许平仓/撤单等降风险动作", tone: "danger", blockers: ["紧急停止已开启"], blockerDetails: [{ code: "kill_switch", label: "紧急停止已开启" }] });
  if (!sys.autonomyEnabled) return result({ mode: "paused", label: "运行已暂停", detail: `AI 暂不自主分析或推进计划；重新选择「${requestedLabel}」后恢复`, tone: "warning", blockers: ["AI 自主运行已暂停"], blockerDetails: [{ code: "autonomy_paused", label: "AI 自主运行已暂停" }], resumesAutomatically: false });
  const blockers = [];
  if (!options.hasProvider) blockers.push("未配置 LLM");
  // 只分析本来就不会开仓，因此内部的账户/费用/OMS 开仓闸不能把它伪装成
  // “暂停新开仓”。这些原因继续保留在服务端，切换到交易模式时再如实展示。
  if (requestedMode === "observe") {
    if (blockers.length) return result({
      mode: "analysis_blocked",
      label: "分析暂不可用",
      detail: `${blockers.join("、")}；配置完成后恢复行情分析，期间始终不会下单`,
      tone: "warning",
      blockers,
      runtimeStatus: "analysis_unavailable",
      runtimeLabel: "分析暂不可用",
      resumesAutomatically: false
    });
    return result({ mode: "observe", label: "只分析", detail: "Gemini 会持续分析并生成判断，但不会向 OKX 提交真实订单", tone: "neutral", blockers: [] });
  }
  // 开仓安全限制也纳入唯一真相源：否则状态卡显示“自动交易”，每笔新开仓却被内部闸拦截。
  if (sys.reduceOnlyMode) {
    const blockerDetails = reduceOnlyBlockers(db);
    return result({
      mode: "reduce_only",
      label: "暂停新开仓",
      detail: `${blockerDetails.map((item) => item.label).join("、")}；当前仍会管理已有仓位并允许撤单、平仓，原因解除后自动恢复「${requestedLabel}」`,
      tone: "warning",
      blockers: blockerDetails.map((item) => item.label),
      blockerDetails
    });
  }
  if (!activeMandate(db)) blockers.push("无激活交易权限");
  if (sys.remainingDailyLossUsdt !== null && sys.remainingDailyLossUsdt !== undefined && sys.remainingDailyLossUsdt <= 0) blockers.push("日亏预算耗尽");
  if (blockers.length) return result({ mode: "blocked", label: "暂停新开仓", detail: `${blockers.join("、")}；分析仍可继续，条件恢复后重新评估新计划`, tone: "warning", blockers });
  if (!sys.liveTradingEnabled) return result({ mode: "live_blocked", label: "暂停新开仓", detail: `已选择「${requestedLabel}」，但实盘通道尚未完成启用`, tone: "warning", blockers: ["实盘通道未启用"] });
  if (!(sys.realTradingAck === true || process.env.I_UNDERSTAND_REAL_TRADING === "true")) blockers.push("实盘风险确认未勾选");
  if (!(sys.orderWriteEnabled === true || process.env.REAL_ORDER_WRITE_ENABLED === "true")) blockers.push("真实下单写入未开启");
  if (!apiPermissionsVerified(db)) blockers.push("API Key 权限未核验");
  if (!freshAccountSnapshot(db).fresh) blockers.push("账户快照缺失或已过期");
  const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
  if (!gray) blockers.push("灰度策略未启用");
  if (blockers.length) return result({ mode: "live_blocked", label: "暂停新开仓", detail: `${blockers.join("、")}；分析和持仓管理仍会继续`, tone: "warning", blockers });
  if (gray.requiresManualApproval) {
    return result({ mode: "semi_auto", label: "逐笔确认", detail: `计划通过审查和硬风控后等待你确认 · 单笔名义 ≤${gray.maxNotionalUsdt} USDT`, tone: "ok", blockers: [] });
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
  if (blockers.length) return result({ mode: "live_blocked", label: "暂停新开仓", detail: `${blockers.join("、")}；条件恢复后自动继续「${requestedLabel}」`, tone: "warning", blockers });
  return result({ mode: "full_auto_small", label: "自动交易", detail: `通过 Gemini 决策、DeepSeek 审查和硬风控后自动下单 · 单笔名义 ≤${gray.maxNotionalUsdt} USDT`, tone: "ok", blockers: [] });
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
    check("llm_agent", "Gemini 主模型 + DeepSeek 独立审查", true, Boolean(process.env.OPENROUTER_API_KEY && process.env.DEEPSEEK_API_KEY), "实盘提案要求 OpenRouter Gemini 与 DeepSeek 官网 API 同时可用。"),
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
  if (db.system?.reduceOnlyMode && requestedOperatingMode(db) !== "observe") return { id: "reduce_only", label: "暂停新开仓", tone: "warning", next: "继续管理已有仓位；原因解除后自动恢复所选运行模式。" };
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
  const result = await createVerifiedBackup({ backupDir });
  const auditChain = verifyAuditChain(db);
  appendAudit(db, "创建并验证系统备份", result.sqliteFile, "OpsManager");
  return {
    status: result.status, verified: result.verified, integrity: result.integrity,
    sqliteFile: result.sqliteFile, encryptedFile: result.encryptedFile,
    offsiteFile: result.offsiteFile, bytes: result.bytes, sha256: result.sha256,
    retention: result.retention, auditChain
  };
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
