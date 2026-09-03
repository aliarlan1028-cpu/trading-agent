import React from "react";
import { localizeText } from "./lib.jsx";
import { t } from "./i18n.js";
import { CockpitHeader } from "./tradingCockpit/shared.jsx";
import { OverviewPage } from "./tradingCockpit/OverviewPage.jsx";
import { MarketPage } from "./tradingCockpit/MarketPage.jsx";
import { PositionsPage } from "./tradingCockpit/PositionsPage.jsx";
import { ReviewPage } from "./tradingCockpit/ReviewPage.jsx";
import { LedgerPage } from "./tradingCockpit/LedgerPage.jsx";
import "./tradingCockpit.css";

// Presentation selectors centralize buildPositionView and buildExecutionView joins.

const statusTone = (value) => /fail|error|reject|cancel|liquid|异常|失败|拒绝|取消/i.test(String(value || "")) ? "negative" : /pending|wait|pause|review|待|暂停|警告/i.test(String(value || "")) ? "warning" : /fill|complete|active|success|approved|已|运行/i.test(String(value || "")) ? "positive" : "neutral";

function accountHealth(data) {
  if (data.system?.killSwitch) return [t("紧急停止", "Emergency stop"), "negative"];
  if (data.automationState?.label) return [localizeText(data.automationState.label), statusTone(data.automationState.mode)];
  return [t("交易状态待同步", "Trading state pending"), "neutral"];
}

export function TradingCockpitShell({ data, active, onChange, ui, children }) {
  const [healthLabel, healthTone] = accountHealth(data);
  return <div className="tradingCockpit" data-cockpit-shell="desktop" data-cockpit-view={active}>
    <CockpitHeader data={data} active={active} onChange={onChange} ui={ui} healthLabel={healthLabel} healthTone={healthTone}/>
    <main className="cockpitCanvas">{children}</main>
  </div>;
}

export function TradingCockpitPage({ active, data, action, ui, initialReviewId = "", onReviewSelect }) {
  if (active === "market") return <MarketPage data={data} action={action} ui={ui}/>;
  if (active === "positions") return <PositionsPage data={data} action={action} ui={ui}/>;
  if (active === "execution") return <ReviewPage data={data} action={action} ui={ui} initialReviewId={initialReviewId} onReviewSelect={onReviewSelect}/>;
  if (active === "ledger") return <LedgerPage data={data} action={action} ui={ui}/>;
  return <OverviewPage data={data} action={action} ui={ui}/>;
}
