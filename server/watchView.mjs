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

const DIRECTION_LABELS = {
  long: "做多情景",
  short: "做空情景",
  neutral: "中性观察"
};

const DIRECTION_LABELS_EN = {
  long: "Long scenario",
  short: "Short scenario",
  neutral: "Neutral watch"
};

function explicitDirection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["long", "多", "做多", "bullish"].includes(raw)) return "long";
  if (["short", "空", "做空", "bearish"].includes(raw)) return "short";
  if (["neutral", "中性", "observe"].includes(raw)) return "neutral";
  return null;
}

/**
 * New watches persist direction explicitly. The text/condition inference keeps
 * legacy active watches understandable until the next analysis replaces them;
 * it must never turn an ambiguous zone into a directional claim.
 */
export function watchDirection(watch = {}) {
  const stored = explicitDirection(watch.direction || watch.bias);
  if (stored) return stored;
  const context = [watch.thesis, watch.analysisTitle, watch.triggerMeaning, watch.note].filter(Boolean).join(" ");
  const longText = /做多|偏多|多头|看涨|\blong\b|\bbullish\b/i.test(context);
  const shortText = /做空|偏空|空头|看跌|\bshort\b|\bbearish\b/i.test(context);
  if (longText !== shortText) return longText ? "long" : "short";
  if (watch.purpose === "invalidation") {
    if (watch.kind === "price_below") return "long";
    if (watch.kind === "price_above") return "short";
  }
  if (["decision", "confirmation"].includes(watch.purpose)) {
    if (watch.kind === "price_above") return "long";
    if (watch.kind === "price_below") return "short";
  }
  return "neutral";
}

export function watchDirectionLabel(watch = {}, language = "zh") {
  const direction = watchDirection(watch);
  return language === "en" ? DIRECTION_LABELS_EN[direction] : DIRECTION_LABELS[direction];
}

export function watchThesis(watch = {}, language = "zh") {
  const stored = String(watch.thesis || watch.analysisTitle || "").replace(/\s+/g, " ").trim();
  if (stored && (language !== "en" || !/[\u3400-\u9fff]/.test(stored))) return stored;
  const direction = watchDirection(watch);
  if (language === "en") {
    if (direction === "long") return "The current analysis is monitoring a long setup; no position is implied.";
    if (direction === "short") return "The current analysis is monitoring a short setup; no position is implied.";
    return "The current analysis has no confirmed trade direction yet.";
  }
  if (direction === "long") return "当前分析偏向做多，但尚未形成新的入场结论。";
  if (direction === "short") return "当前分析偏向做空，但尚未形成新的入场结论。";
  return "当前方向尚未确认，正在等待关键条件提供新的决策依据。";
}

export function watchTriggerMeaning(watch = {}, language = "zh") {
  const stored = String(watch.triggerMeaning || watch.note || "").replace(/\s+/g, " ").trim();
  if (stored && (language !== "en" || !/[\u3400-\u9fff]/.test(stored))) return stored;
  const direction = watchDirection(watch);
  const sideZh = direction === "long" ? "做多" : direction === "short" ? "做空" : "方向";
  const sideEn = direction === "long" ? "long" : direction === "short" ? "short" : "directional";
  if (language === "en") {
    if (watch.purpose === "confirmation") return `This would strengthen the ${sideEn} setup, but still requires fresh market confirmation.`;
    if (watch.purpose === "invalidation") return `This would invalidate the current ${sideEn} thesis; do not keep using the old view.`;
    if (watch.purpose === "alternative") return `This would activate an alternative ${sideEn} scenario for fresh analysis.`;
    return `This is the next decision point for the ${sideEn} scenario and requires fresh analysis.`;
  }
  if (watch.purpose === "confirmation") return `命中后说明${sideZh}情景获得一项确认，但仍需结合最新结构与量能重新判断。`;
  if (watch.purpose === "invalidation") return `命中后说明原${sideZh}判断失效，不能继续沿用旧逻辑。`;
  if (watch.purpose === "alternative") return `命中后启用${sideZh}备选情景，并重新分析是否成立。`;
  return `这是${sideZh}情景的下一决策点，命中后必须基于最新行情重新分析。`;
}

export function presentWatch(watch = {}) {
  const direction = watchDirection(watch);
  const normalized = { ...watch, direction };
  return {
    ...normalized,
    displayDirection: watchDirectionLabel(normalized),
    displayDirectionEn: watchDirectionLabel(normalized, "en"),
    displayThesis: watchThesis(normalized),
    displayThesisEn: watchThesis(normalized, "en"),
    displayTriggerMeaning: watchTriggerMeaning(normalized),
    displayTriggerMeaningEn: watchTriggerMeaning(normalized, "en")
  };
}

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
    const decorate = (watch, isPrimary) => {
      const presented = presentWatch(watch);
      return {
        ...presented,
        isPrimary,
        displayRole: isPrimary ? "主观察哨" : watchPurposeLabel(watch),
        displayRoleEn: isPrimary ? "Primary watch" : watchPurposeLabel(watch, "en")
      };
    };
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
