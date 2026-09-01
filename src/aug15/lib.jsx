import { humanize } from "../lib.jsx";
import { t } from "../i18n.js";

export * from "../lib.jsx";

export function formatMoney(value, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function humanizePhase(value, fallback = "-") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) return fallback;
  if (normalized.includes("mandate") && normalized.includes("check")) return t("交易权限检查", "Trading permission check");
  if (normalized.includes("risk") && normalized.includes("check")) return t("风控检查", "Risk check");
  if (normalized.includes("observ")) return t("观察市场", "Monitoring market");
  if (normalized.includes("analy")) return t("生成分析", "Analyzing");
  if (normalized.includes("plan")) return t("生成计划", "Building trade plan");
  if (normalized.includes("execut")) return t("执行交易", "Executing trade");
  if (normalized.includes("reconcil")) return t("账户对账", "Reconciling account");
  if (normalized.includes("review")) return t("复盘审查", "Reviewing");
  return humanize(value, fallback);
}

export function systemStatus(data) {
  if (data?.system?.killSwitch) return { label: t("紧急停止中", "Emergency stop active"), tone: "danger" };
  if ((data?.exchangeAccounts || []).length && (data?.exchangeAccounts || []).every((account) => !account.readEnabled)) {
    return { label: t("待配置", "Setup required"), tone: "warning" };
  }
  if (!data?.system?.autonomyEnabled) return { label: t("自主运行已暂停", "Autonomy paused"), tone: "warning" };
  if (data?.agentStatus?.state === "risk_paused") return { label: t("风控暂停", "Paused by risk controls"), tone: "warning" };
  const raw = data?.system?.riskStatus || "正常";
  return {
    label: humanize(raw, raw === "正常" ? t("正常", "Healthy") : raw),
    tone: /正常|运行|healthy|running/i.test(raw) ? "ok" : /熔断|高|halt|critical/i.test(raw) ? "danger" : "warning"
  };
}
