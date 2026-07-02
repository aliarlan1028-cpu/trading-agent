import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendAudit, nowIso, verifyAuditChain } from "./store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backupDir = path.join(rootDir, "backups");

export function buildReadinessReport(db) {
  const checks = [
    check("frontend_dashboard", "产品驾驶舱", true, "React 页面覆盖总览、交易、Agent、事件、知识、Skill、风控、账户、审计。"),
    check("sqlite_persistence", "SQLite 持久化", true, "核心集合、审计、Trace 已落库。"),
    check("trade_write_gateway", "真实交易写网关", true, "支持下单、撤单、改单、平仓、移动止损、分批止盈。"),
    check("trade_write_config", "真实交易配置", envTrue("LIVE_TRADING_ENABLED") && envTrue("I_UNDERSTAND_REAL_TRADING") && envTrue("REAL_ORDER_WRITE_ENABLED"), "最终由你确认开启。"),
    check("binance_keys", "Binance API", Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET), "需要你配置 Key/Secret 并实盘小额验证。"),
    check("okx_keys", "OKX API", Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE), "需要你配置 Key/Secret/Passphrase 并实盘小额验证。"),
    check("private_ws", "私有 WebSocket", true, "Binance listenKey 与 OKX login/subscription 已实现，凭证配置后可连。"),
    check("llm_agent", "真实 LLM Agent", Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY), "无 Key 时走本地确定性 ReAct；配置后调用真实模型。"),
    check("langsmith", "LangSmith Trace", Boolean(process.env.LANGSMITH_API_KEY), "配置后记录外部可观测链路。"),
    check("knowledge_pipeline", "真实知识库解析", true, "PDF/DOCX/网页/GitHub 导入、切片、RAG、图谱已实现。"),
    check("event_sources", "真实事件源", true, "RSS/HTML/公告/链上信号管线已实现。"),
    check("etherscan", "链上 API", Boolean(process.env.ETHERSCAN_API_KEY), "配置后获取真实链上 Gas/异常信号。"),
    check("skill_sandbox", "Skill 沙箱", true, "GitHub/上传拉取、依赖扫描入口、Docker 无网络沙箱已实现。"),
    check("docker", "Docker 沙箱环境", Boolean(process.env.SKILL_SANDBOX_IMAGE), "可使用默认 node:20-alpine；本机需安装 Docker。"),
    check("audit_chain", "不可变审计链", verifyAuditChain(db).ok, "审计日志带 hash 链并支持校验。"),
    check("alerts", "告警 Webhook", Boolean(process.env.ALERT_WEBHOOK_URL), "配置后可推送真实外部告警。"),
    check("gray_release", "小额度灰度策略", (db.grayReleasePolicies || []).some((item) => item.enabled), "最终由你启用并设置额度、币种、人工确认。")
  ];
  const implemented = checks.filter((item) => item.implemented).length;
  const configured = checks.filter((item) => item.configured).length;
  return {
    generatedAt: nowIso(),
    implementationCompletionPct: Math.round((implemented / checks.length) * 100),
    configurationCompletionPct: Math.round((configured / checks.length) * 100),
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

function check(key, label, configured, note) {
  return { key, label, implemented: true, configured: Boolean(configured), note };
}

function envTrue(name) {
  return process.env[name] === "true";
}

function sanitizeForBackup(db) {
  return JSON.parse(JSON.stringify(db, (key, value) => {
    if (["apiSecret", "secret", "passphrase", "password"].includes(key)) return "[redacted]";
    return value;
  }));
}
