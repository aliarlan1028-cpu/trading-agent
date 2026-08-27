import { CircleDollarSign, Clock3, Menu, Radar, ShieldCheck, WalletCards } from "lucide-react";

const unavailable = "Unavailable";
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
  return ["normal", "ok", "healthy"].includes(risk.toLowerCase()) ? "风险正常" : risk;
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

const FACTS = Object.freeze([
  { key: "equity", label: "总权益", icon: CircleDollarSign, value: (truth) => numericText(truth.equity), modes: ["full", "compact"] },
  { key: "available", label: "可用", icon: WalletCards, value: (truth) => numericText(truth.available), modes: ["full"] },
  { key: "exposure", label: "敞口", icon: Radar, value: (truth) => numericText(truth.exposure), modes: ["full", "compact"] },
  { key: "runtime", label: "运行", icon: Radar, value: (truth) => runtimeText(truth.runtime), modes: ["full", "compact", "critical"] },
  { key: "risk", label: "风控", icon: ShieldCheck, value: (truth) => riskText(truth.risk), modes: ["full", "compact", "critical"] },
  { key: "freshness", label: "数据", icon: Clock3, value: (truth) => freshnessText(truth.freshness), modes: ["full", "compact", "critical"] }
]);

export function AccountTruth({ truth = {} }) {
  const mode = ["full", "compact", "critical"].includes(truth.mode) ? truth.mode : "full";
  const facts = FACTS.filter((fact) => fact.modes.includes(mode));
  return (
    <section className="kordynV2AccountTruth" data-kordyn-v2-account-truth-mode={mode} aria-label="账户事实">
      <span className="kordynV2TruthMenu" aria-hidden="true"><Menu size={20} /></span>
      {facts.map((fact) => {
        const Icon = fact.icon;
        return (
          <div className={`kordynV2TruthFact is-${fact.key}`} key={fact.key} data-kordyn-v2-truth-fact={fact.key}>
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>{fact.label}</span>
            <strong>{fact.value(truth)}</strong>
          </div>
        );
      })}
      <span className="kordynV2TruthPulse" aria-label="实时连接正常" />
    </section>
  );
}
