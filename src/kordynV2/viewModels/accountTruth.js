const unavailable = "Unavailable";
const firstKnown = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
const fact = (...values) => firstKnown(...values, unavailable);
const financialFact = (...values) => {
  const value = fact(...values);
  return typeof value === "number" && !Number.isFinite(value) ? unavailable : value;
};

export function buildAccountTruth(data = {}, mode = "full") {
  const portfolio = data.portfolio || {};
  const risk = data.portfolioRisk || {};
  const latestSnapshot = Array.isArray(data.accountSnapshots) ? data.accountSnapshots[0] : null;
  return Object.freeze({
    mode,
    equity: financialFact(portfolio.totalEquityUsdt, latestSnapshot?.totalEquityUsdt),
    available: financialFact(portfolio.availableMarginUsdt, latestSnapshot?.availableMarginUsdt),
    exposure: financialFact(portfolio.exposureUsdt, risk.grossExposureUsdt, risk.exposureUsdt),
    freshness: fact(latestSnapshot?.createdAt, portfolio.asOf, data.accountFreshness?.asOf),
    runtime: fact(data.system?.runtimeStatus, data.system?.executionStatus, data.system?.status),
    risk: fact(risk.status, data.system?.riskStatus)
  });
}
