const PURPOSE_LABELS = {
  decision: "核心决策点",
  confirmation: "确认条件",
  invalidation: "失效条件",
  alternative: "备选情景"
};

const PURPOSE_LABELS_EN = {
  decision: "Core decision",
  confirmation: "Confirmation",
  invalidation: "Invalidation",
  alternative: "Alternative scenario"
};

export function describeWatch(watch = {}, language = "zh") {
  const fmt = (value) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (language === "en") {
    if (watch.kind === "price_above") return `${watch.symbol} breaks above ${fmt(watch.level)}`;
    if (watch.kind === "price_below") return `${watch.symbol} breaks below ${fmt(watch.level)}`;
    return `${watch.symbol} enters the ${fmt(watch.levelLow)}–${fmt(watch.levelHigh)} zone`;
  }
  if (watch.kind === "price_above") return `${watch.symbol} 向上突破 ${fmt(watch.level)}`;
  if (watch.kind === "price_below") return `${watch.symbol} 向下跌破 ${fmt(watch.level)}`;
  return `${watch.symbol} 回踩进入 ${fmt(watch.levelLow)}-${fmt(watch.levelHigh)} 区间`;
}

export function watchPurposeLabel(watch = {}, language = "zh") {
  const key = PURPOSE_LABELS[watch.purpose] ? watch.purpose : (watch.priority === "primary" ? "decision" : "alternative");
  return language === "en" ? PURPOSE_LABELS_EN[key] : PURPOSE_LABELS[key];
}

function timeValue(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function primaryFirst(left, right) {
  const priority = Number(right.priority === "primary") - Number(left.priority === "primary");
  if (priority) return priority;
  const purposeRank = { decision: 4, confirmation: 3, invalidation: 2, alternative: 1 };
  const purpose = (purposeRank[right.purpose] || 0) - (purposeRank[left.purpose] || 0);
  if (purpose) return purpose;
  return timeValue(right.updatedAt || right.createdAt) - timeValue(left.updatedAt || left.createdAt);
}

/**
 * 给页面、Telegram 和提示词使用的唯一观察哨视图。
 * 同一币种只暴露一个主观察哨，其余条件明确标为辅助情景，避免平铺后看不出主次。
 */
export function buildWatchBoard(db = {}) {
  const groups = new Map();
  for (const watch of db.watchTriggers || []) {
    if (watch.status !== "active" || !watch.symbol) continue;
    const rows = groups.get(watch.symbol) || [];
    rows.push(watch);
    groups.set(watch.symbol, rows);
  }

  return [...groups.entries()].map(([symbol, rows]) => {
    const sorted = [...rows].sort(primaryFirst);
    const primary = sorted[0];
    const decorate = (watch, isPrimary) => ({
      ...watch,
      isPrimary,
      displayRole: isPrimary ? "主观察哨" : watchPurposeLabel(watch),
      displayRoleEn: isPrimary ? "Primary watch" : watchPurposeLabel(watch, "en")
    });
    const latest = [...rows].sort((a, b) => timeValue(b.analysisAt || b.createdAt) - timeValue(a.analysisAt || a.createdAt))[0];
    return {
      symbol,
      count: rows.length,
      analysisId: latest.analysisId || null,
      analysisAt: latest.analysisAt || latest.createdAt || null,
      analysisTitle: latest.analysisTitle || null,
      primary: decorate(primary, true),
      secondary: sorted.slice(1).map((watch) => decorate(watch, false))
    };
  }).sort((a, b) => timeValue(b.analysisAt) - timeValue(a.analysisAt));
}

export function watchBoardForSymbol(db, symbol) {
  return buildWatchBoard(db).find((group) => group.symbol === symbol) || null;
}
