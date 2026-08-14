import { normalizePositionsForUi } from "./positionView.mjs";
import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";

const PRESENTATION_SCHEMA_VERSION = 1;
const DISPLAY_TIMEFRAMES = ["15m", "1h", "4h"];

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const clip = (value, length = 120) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

function extractHeadline(content = "") {
  const lines = String(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.、)]\s+/, "")
      .replace(/^\*\*(.+)\*\*[:：]?$/, "$1")
      .replace(/\*\*/g, "")
      .trim());
  const conclusionIndex = lines.findIndex((line) => /^(结论|当前结论|决策|判断|Conclusion|Decision)[:：]?$/i.test(line));
  const candidate = conclusionIndex >= 0
    ? lines.slice(conclusionIndex + 1).find((line) => !/^(依据|风险|下一步|Evidence|Risk|Next Step)[:：]?$/i.test(line))
    : lines.find((line) => !/^(结论|当前结论|依据|风险|下一步|Conclusion|Evidence|Risk|Next Step)[:：]?$/i.test(line));
  const cleaned = String(candidate || "本轮决策分析")
    .replace(/^>\s*/, "")
    .replace(/^(结论|当前结论|判断|Conclusion)[:：]\s*/i, "")
    .trim();
  const sentences = cleaned.match(/[^。！？!?]+[。！？!?]?/g) || [cleaned];
  let headline = "";
  for (const sentence of sentences) {
    if (headline && `${headline}${sentence}`.length > 150) break;
    headline += sentence;
    if (headline.length >= 22) break;
  }
  // 优先保留完整判断句；只有模型输出一整段且没有任何句界时才做安全截断。
  return headline.length > 180 ? clip(headline, 180) : headline;
}

function normalizedDirection(value) {
  const direction = String(value || "").toLowerCase();
  if (["long", "up", "bullish", "buy", "多"].includes(direction)) return "long";
  if (["short", "down", "bearish", "sell", "空"].includes(direction)) return "short";
  return "neutral";
}

function latestStructureSnapshot(run, symbol) {
  const structures = run?.presentationFacts?.structures || {};
  // Never attach another market's structure to the primary symbol. Multi-symbol
  // runs can legitimately have partial tool coverage; showing "insufficient" is
  // safer than silently relabeling ETH evidence as BTC evidence.
  if (symbol) return structures[symbol] || null;
  return Object.values(structures).sort((a, b) => new Date(b.analyzedAt || 0) - new Date(a.analyzedAt || 0))[0] || null;
}

function nextActionFor({ kind, state, plan, watch, order }) {
  if (kind === "error") return { code: "review_error", detail: null };
  if (kind === "risk_blocked") return { code: "rebuild_plan", detail: plan?.lastRiskCheck?.summary || order?.setupReview?.reason || null };
  if (state === "awaiting_approval") return { code: "approve_or_reject", detail: null };
  if (state === "armed") return { code: "wait_for_trigger", detail: null };
  if (state === "entry_pending") return { code: "wait_for_fill", detail: null };
  if (["entry_filled", "protecting"].includes(state)) return { code: "monitor_position", detail: null };
  if (state === "closed") return { code: "review_closed_trade", detail: null };
  if (["failed", "blocked", "setup_rejected", "protection_failed"].includes(state)) return { code: "inspect_execution_block", detail: order?.setupReview?.reason || null };
  if (watch) return { code: "watch_primary_condition", detail: null };
  if (kind === "position_management") return { code: "monitor_position", detail: null };
  return { code: "analysis_only", detail: null };
}

function decisionStateFor(plan, order, watch, errorText) {
  if (errorText) return "failed";
  if (order?.status) return String(order.status);
  if (plan?.status) return String(plan.status);
  if (watch) return "watching";
  return "analysis_only";
}

function classifyKind({ plan, order, watch, position, content, errorText, trigger }) {
  if (errorText) return "error";
  if (plan?.status === "risk_rejected" || ["blocked", "failed", "setup_rejected", "protection_failed"].includes(order?.status)) return "risk_blocked";
  if (order) return order.status === "closed" ? "closed_trade" : "execution_update";
  if (plan) return "trade_plan";
  if (position && /(持仓|仓位|止损|止盈|保本|减仓|平仓|position|stop|take profit|break even)/i.test(content)) return "position_management";
  if (watch || trigger === "watch_trigger") return "watch_update";
  return "market_analysis";
}

function primaryWatchFor(db, run, symbol) {
  const rows = (db.watchTriggers || []).filter((row) => row.analysisId === run?.id && row.status === "active");
  return rows.find((row) => row.priority === "primary" && (!symbol || row.symbol === symbol))
    || rows.find((row) => !symbol || row.symbol === symbol)
    || null;
}

function evidenceCoverage(row, bundle, { includeAccount = false, requireAccount = includeAccount } = {}) {
  const components = [
    ["ticker", row?.ticker],
    ["candles", row?.candles],
    ["microstructure", row?.microstructure],
    ["contract_spec", row?.contractSpec],
    ["smart_money", row?.smartMoney],
    ["medium_term", row?.mediumTerm]
  ];
  if (includeAccount) components.push(["account", bundle?.account || null]);
  const passedEvidence = ([, value]) => value?.quality === "passed" && (!value.status || value.status === "fresh");
  const passed = components.filter(passedEvidence).length;
  // Smart-money and medium-term statistics are valuable but supplemental in the
  // deterministic trade gate. Keep them in the visible ratio without claiming
  // that an unavailable supplemental feed invalidates fresh ticker/candle/book/
  // contract evidence. Account becomes required when this reply discusses it.
  const requiredNames = new Set(["ticker", "candles", "microstructure", "contract_spec", ...(requireAccount ? ["account"] : [])]);
  const required = components.filter(([name]) => requiredNames.has(name));
  return {
    passed,
    total: components.length,
    complete: components.length > 0 && passed === components.length,
    criticalReady: required.length > 0 && required.every(passedEvidence),
    tradeReady: bundle?.criticalReady === true,
    unavailable: components.filter(([, value]) => value?.quality !== "passed" || (value.status && value.status !== "fresh")).map(([name]) => name),
    generatedAt: bundle?.generatedAt || null
  };
}

function btcRiskSnapshot(mediumTerm) {
  const candidates = ["7d", "3d", "24h"];
  const window = candidates.find((key) => mediumTerm?.btcRisk?.[key]?.status === "ok");
  if (!window) return { status: "insufficient", window: null, correlation: null, beta: null };
  const row = mediumTerm.btcRisk[window];
  return { status: "ok", window, correlation: numberOrNull(row.correlation), beta: numberOrNull(row.beta) };
}

function timeframesFor(structure, mediumTerm) {
  return DISPLAY_TIMEFRAMES.map((timeframe) => {
    const frame = structure?.frames?.[timeframe] || null;
    const flow = mediumTerm?.windows?.[timeframe] || null;
    const structureAvailable = frame?.available === true;
    const flowAvailable = flow?.status === "ok";
    return {
      timeframe,
      status: structureAvailable && flowAvailable ? "complete" : structureAvailable || flowAvailable ? "partial" : "insufficient",
      structure: structureAvailable ? {
        direction: normalizedDirection(frame.trend?.direction),
        sequence: frame.trend?.sequence || null,
        phase: frame.phase || null,
        event: frame.latestEvent ? {
          kind: frame.latestEvent.kind || null,
          direction: normalizedDirection(frame.latestEvent.direction),
          level: numberOrNull(frame.latestEvent.level)
        } : null,
        volumeState: frame.volume?.state || null,
        lastClosedAt: frame.lastClosedAt || null
      } : null,
      flow: flowAvailable ? {
        priceChangePct: numberOrNull(flow.priceChangePct),
        oiChangePct: numberOrNull(flow.oiChangePct),
        fundingEndPct: numberOrNull(flow.fundingEndPct),
        fundingChangePp: numberOrNull(flow.fundingChangePp),
        leverageState: flow.leverageState || null,
        cvd: numberOrNull(flow.cvd),
        cvdImbalancePct: numberOrNull(flow.cvdImbalancePct),
        flowCoveragePct: numberOrNull(flow.flowCoveragePct),
        divergence: flow.divergence || null
      } : null
    };
  });
}

function eventVolatilitySnapshot(bundle) {
  return Object.entries(bundle?.mediumTermEventVolatility?.byType || {})
    .filter(([, row]) => row?.status === "usable")
    .sort((a, b) => Number(b[1].samples || 0) - Number(a[1].samples || 0))
    .slice(0, 3)
    .map(([type, row]) => ({
      type,
      samples: Number(row.samples || 0),
      post1hVolPct: numberOrNull(row.avgPost1hRealizedVolPct),
      expansionRatio: numberOrNull(row.medianPost1hVolExpansionRatio),
      reaction: row.typicalReaction || null,
      confidence: row.confidence || null
    }));
}

export function buildChatPresentation({ db = {}, run = {}, content = "", evidenceBundle = null, errorText = "" } = {}) {
  const narrativeSystemReply = /本地系统说明回答|KORDYN 内置系统说明|本地说明模式/i.test(content)
    && !run.tradePlanId;
  const plan = (db.tradePlans || []).find((row) => row.id === run.tradePlanId) || null;
  const preliminarySymbol = plan?.symbol || (!narrativeSystemReply ? evidenceBundle?.symbols?.[0]?.symbol : null) || run.decisionContext?.symbols?.[0] || null;
  const watch = primaryWatchFor(db, run, preliminarySymbol);
  const symbol = preliminarySymbol || watch?.symbol || null;
  const order = plan ? (db.executionOrders || []).find((row) => row.planId === plan.id) || null : null;
  const orderFills = order ? (db.fills || []).filter((row) => row.executionOrderId === order.id || (!row.executionOrderId && row.tradePlanId === plan?.id)) : [];
  const entryFills = orderFills.filter((row) => row.kind === "entry");
  const closeFills = orderFills.filter((row) => row.kind === "close");
  const entryQuantity = entryFills.reduce((sum, row) => sum + Math.abs(Number(row.quantity || 0)), 0);
  const entryNotional = entryFills.reduce((sum, row) => sum + Math.abs(Number(row.price || 0) * Number(row.quantity || 0)), 0);
  const actualEntryPrice = entryQuantity > 0 ? entryNotional / entryQuantity : numberOrNull(order?.filledPrice);
  const closedLifecycles = groupClosedTradeLifecycles(orderFills);
  const grossRealizedPnl = closedLifecycles.length
    ? closedLifecycles.reduce((sum, lifecycle) => sum + Number(lifecycle.realizedPnl), 0)
    : null;
  const netRealizedPnl = closedLifecycles.length
    ? closedLifecycles.reduce((sum, lifecycle) => sum + Number(lifecycle.netRealizedPnl), 0)
    : null;
  const position = symbol ? normalizePositionsForUi(db.positions || []).find((row) => row.symbol === symbol && Number(row.quantity ?? row.size ?? row.pos ?? 0) !== 0) || null : null;
  const kind = classifyKind({ plan, order, watch, position, content, errorText, trigger: run.decisionContext?.trigger });
  const state = decisionStateFor(plan, order, watch, errorText);
  const structure = latestStructureSnapshot(run, symbol);
  // A plan may target a symbol that is missing from a partial evidence bundle.
  // Never relabel the first available market's flow as the plan symbol's flow.
  const evidenceRow = symbol
    ? evidenceBundle?.symbols?.find((row) => row.symbol === symbol) || null
    : evidenceBundle?.symbols?.[0] || null;
  const mediumTerm = evidenceRow?.mediumTerm?.data || null;
  const direction = normalizedDirection(plan?.direction || structure?.bias || position?.direction || position?.side);
  const role = plan?.traderRole || structure?.selectedRole || null;
  const primaryTimeframe = plan?.timeframe || (role === "day_trader" ? "15m" : role === "swing_trader" ? "4h" : "1h");
  const accountRequested = /(账户|余额|净值|保证金|持仓|仓位|account|balance|equity|margin|position)/i.test(content);
  const coverage = evidenceCoverage(evidenceRow, evidenceBundle, {
    includeAccount: Boolean(plan || order || position || accountRequested),
    requireAccount: Boolean(db.system?.liveTradingEnabled || position || accountRequested)
  });
  const symbols = [...new Set([
    plan?.symbol,
    ...(evidenceBundle?.symbols || []).map((row) => row.symbol),
    ...(run.decisionContext?.symbols || []),
    watch?.symbol
  ].filter(Boolean))];
  const presentation = {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    layout: !narrativeSystemReply && (symbol || plan || order || watch || position || evidenceRow) ? "decision_brief" : "narrative",
    kind,
    generatedAt: run.completedAt || new Date().toISOString(),
    headline: extractHeadline(content),
    symbol,
    symbols,
    decision: {
      state,
      direction,
      role,
      primaryTimeframe,
      hasOrder: Boolean(order),
      hasPosition: Boolean(position)
    },
    nextAction: null,
    timeframes: timeframesFor(structure, mediumTerm),
    evidence: {
      coverage,
      btcRisk: btcRiskSnapshot(mediumTerm),
      eventVolatility: eventVolatilitySnapshot(evidenceBundle),
      supportingFactors: (plan?.decisionContext?.supportingFactors || []).map((item) => clip(item, 160)).slice(0, 6),
      conflictingFactors: (plan?.decisionContext?.conflictingFactors || []).map((item) => clip(item, 160)).slice(0, 6)
    },
    linked: {
      planId: plan?.id || null,
      executionOrderId: order?.id || null,
      watchId: watch?.id || null,
      evidenceBundleId: evidenceBundle?.id || run.evidenceBundleId || null,
      analysisBundleId: run.analysisBundleId || null
    },
    watch: watch ? {
      kind: watch.kind,
      level: numberOrNull(watch.level),
      levelLow: numberOrNull(watch.levelLow),
      levelHigh: numberOrNull(watch.levelHigh),
      purpose: watch.purpose || "decision",
      expiresAt: watch.expiresAt || null,
      note: clip(watch.note, 180)
    } : null,
    position: position ? {
      direction: normalizedDirection(position.direction || position.side),
      size: numberOrNull(position.quantity ?? position.size ?? position.pos),
      entryPrice: numberOrNull(position.entry ?? position.entryPrice ?? position.avgPx),
      markPrice: numberOrNull(position.mark ?? position.markPrice),
      unrealizedPnl: numberOrNull(position.pnl ?? position.unrealizedPnl),
      leverage: numberOrNull(position.leverage)
    } : null,
    execution: order ? {
      status: order.status || null,
      quantity: numberOrNull(order.quantity),
      notionalUsdt: numberOrNull(order.notionalUsdt),
      filledPrice: actualEntryPrice,
      plannedEntryPrice: numberOrNull(order.entryPrice),
      grossRealizedPnl,
      netRealizedPnl,
      // 兼容旧展示字段，但其语义统一为完整交易生命周期净值。
      realizedPnl: netRealizedPnl,
      protection: order.protection || null,
      updatedAt: order.updatedAt || order.completedAt || order.createdAt || null
    } : null
  };
  presentation.nextAction = nextActionFor({ kind, state, plan, watch, order });
  return presentation;
}

export { PRESENTATION_SCHEMA_VERSION };
