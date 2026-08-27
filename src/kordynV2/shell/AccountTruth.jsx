import { CircleDollarSign, Clock3, Menu, Radar, ShieldCheck, WalletCards } from "lucide-react";

const unavailable = "Unavailable";
const GOOD_RISK_STATES = Object.freeze(["normal", "ok", "healthy"]);
const ADVERSE_RISK_STATES = Object.freeze([
  "critical", "high", "danger", "elevated", "breached", "blocked", "failed", "error",
  "kill_switch", "reduce_only", "emergency", "halted"
]);
const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const numericText = (value) => typeof value === "number" && Number.isFinite(value)
  ? money.format(value)
  : unavailable;

const primitiveText = (value) => (
  typeof value === "string" && value !== "" ? value : unavailable
);

function runtimeText(value) {
  const runtime = primitiveText(value);
  if (runtime === unavailable) return unavailable;
  return ({
    full_auto_small: "自动交易",
    semi_auto: "逐笔确认",
    observe: "只分析",
    halted: "紧急停止",
    reduce_only: "仅减仓",
    paused: "已暂停"
  })[runtime] || runtime;
}

function riskText(value) {
  const risk = primitiveText(value);
  if (risk === unavailable) return unavailable;
  const normalized = risk.toLowerCase();
  if (GOOD_RISK_STATES.includes(normalized)) return "风险正常";
  return ADVERSE_RISK_STATES.includes(normalized) ? risk : unavailable;
}

function freshnessText(value) {
  const freshness = primitiveText(value);
  if (freshness === unavailable || !Number.isFinite(Date.parse(freshness))) return unavailable;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(freshness));
}

function runtimeTone(value) {
  const runtime = primitiveText(value).toLowerCase();
  if (runtime === unavailable.toLowerCase()) return "unavailable";
  if (["halted", "paused", "reduce_only", "failed", "error", "blocked", "emergency", "kill"].some((token) => runtime.includes(token))) {
    return "danger";
  }
  if (["full_auto", "semi_auto", "observe", "running", "active", "normal"].some((token) => runtime.includes(token))) {
    return "mint";
  }
  return "unavailable";
}

function riskTone(value) {
  const risk = primitiveText(value).toLowerCase();
  if (risk === unavailable.toLowerCase()) return "unavailable";
  if (GOOD_RISK_STATES.includes(risk)) return "mint";
  if (ADVERSE_RISK_STATES.includes(risk)) return "danger";
  return "unavailable";
}

function realtimeTone(truth, state) {
  const kind = typeof state?.kind === "string" ? state.kind : "not_loaded";
  if (["failed", "forbidden", "stale", "degraded", "disabled"].includes(kind)) return "danger";
  if (kind !== "ready") return "unavailable";
  const freshnessState = primitiveText(truth.freshnessState).toLowerCase();
  if (["fresh", "realtime", "current", "live"].includes(freshnessState)) return "mint";
  if (["stale", "failed", "error", "disconnected", "offline", "degraded", "delayed"].includes(freshnessState)) return "danger";
  return "unavailable";
}

const FACTS = Object.freeze([
  { key: "equity", label: "总权益", icon: CircleDollarSign, value: (truth) => numericText(truth.equity), modes: ["full", "compact"] },
  { key: "available", label: "可用", icon: WalletCards, value: (truth) => numericText(truth.available), modes: ["full"] },
  { key: "exposure", label: "敞口", icon: Radar, value: (truth) => numericText(truth.exposure), modes: ["full", "compact"] },
  { key: "runtime", label: "运行", icon: Radar, value: (truth) => runtimeText(truth.runtime), modes: ["full", "compact", "critical"] },
  { key: "risk", label: "风控", icon: ShieldCheck, value: (truth) => riskText(truth.risk), modes: ["full", "compact", "critical"] },
  { key: "freshness", label: "数据", icon: Clock3, value: (truth) => freshnessText(truth.freshness), modes: ["full", "compact", "critical"] }
]);

export function AccountTruth({ truth = {}, state }) {
  const mode = ["full", "compact", "critical"].includes(truth.mode) ? truth.mode : "full";
  const facts = FACTS.filter((fact) => fact.modes.includes(mode));
  const realtime = realtimeTone(truth, state);
  return (
    <section className="kordynV2AccountTruth" data-kordyn-v2-account-truth-mode={mode} aria-label="账户事实">
      <span className="kordynV2TruthMenu" aria-hidden="true"><Menu size={20} /></span>
      {facts.map((fact) => {
        const Icon = fact.icon;
        const value = fact.value(truth);
        const healthTone = fact.key === "runtime"
          ? runtimeTone(truth.runtime)
          : fact.key === "risk"
            ? riskTone(truth.risk)
            : null;
        return (
          <div
            className={`kordynV2TruthFact is-${fact.key}`}
            key={fact.key}
            data-kordyn-v2-truth-fact={fact.key}
            data-health-tone={healthTone || undefined}
            role={healthTone ? "status" : undefined}
            aria-label={healthTone ? `${fact.label}状态：${value}` : undefined}
          >
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>{fact.label}</span>
            <strong>{value}</strong>
          </div>
        );
      })}
      <span
        className="kordynV2TruthPulse"
        data-health-tone={realtime}
        role="status"
        aria-label={`实时连接：${realtime === "mint" ? "正常" : realtime === "danger" ? "异常" : unavailable}`}
      />
    </section>
  );
}
