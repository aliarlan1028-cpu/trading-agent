const SHANGHAI = "Asia/Shanghai";

function shanghaiYearMonth(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI, year: "numeric", month: "numeric"
  }).formatToParts(new Date(at));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value)
  };
}

export function daysInShanghaiMonth(at = new Date()) {
  const { year, month } = shanghaiYearMonth(at);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function deriveMonthlyGoalUsdt(dailyGoalUsdt, at = new Date()) {
  const daily = Number(dailyGoalUsdt);
  if (!Number.isFinite(daily) || daily <= 0) return null;
  return Math.round((daily * daysInShanghaiMonth(at) + Number.EPSILON) * 100) / 100;
}

export function applyDerivedProfitGoals(system = {}, at = new Date()) {
  const days = daysInShanghaiMonth(at);
  const daily = Number(system.dailyGoalUsdt);
  system.dailyGoalUsdt = Number.isFinite(daily) && daily > 0 ? daily : null;
  system.monthlyGoalUsdt = deriveMonthlyGoalUsdt(system.dailyGoalUsdt, at);
  system.monthlyGoalDays = days;
  system.monthlyGoalDerived = true;
  const { year, month } = shanghaiYearMonth(at);
  system.monthlyGoalPeriod = `${year}-${String(month).padStart(2, "0")}`;
  return system;
}

export function profitGoalSnapshot(system = {}, at = new Date()) {
  return applyDerivedProfitGoals({ ...system }, at);
}
