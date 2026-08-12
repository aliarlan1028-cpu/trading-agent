import { scanOpportunities } from "./opportunityScanner.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { buildOpportunitySetupSnapshot } from "./opportunitySetup.mjs";

const CONFIG = Object.freeze({
  sampleIntervalMs: Number(process.env.OPPORTUNITY_SAMPLE_INTERVAL_MS || 5_000),
  bufferMs: Number(process.env.OPPORTUNITY_BUFFER_MS || 20 * 60_000),
  candidateTtlMs: Number(process.env.OPPORTUNITY_CANDIDATE_TTL_MS || 30 * 60_000),
  signalCooldownMs: Number(process.env.OPPORTUNITY_SIGNAL_COOLDOWN_MS || 10 * 60_000),
  minHistoryMs: Number(process.env.OPPORTUNITY_MIN_HISTORY_MS || 30_000),
  minScore: Number(process.env.OPPORTUNITY_MIN_SCORE || 55),
  broadMinScore: Number(process.env.OPPORTUNITY_BROAD_MIN_SCORE || 72),
  maxPendingSignals: 12
});

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function normalizeSymbol(value) {
  const raw = String(value || "").toUpperCase().replace(/-SWAP$/, "");
  if (raw.includes("/")) return raw;
  if (raw.includes("-")) return raw.replace("-", "/");
  return raw.endsWith("USDT") ? `${raw.slice(0, -4)}/USDT` : raw;
}

function sampleAtOrBefore(samples, timestamp, maxLagMs) {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (samples[i].t <= timestamp) {
      return timestamp - samples[i].t <= maxLagMs ? samples[i] : null;
    }
  }
  return null;
}

function returnPct(price, reference) {
  return finite(price) && finite(reference) && Number(reference) > 0
    ? ((Number(price) - Number(reference)) / Number(reference)) * 100
    : null;
}

export function computeEarlyOpportunityFeatures(samples = [], market = {}, now = Date.now()) {
  const latest = samples.at(-1);
  if (!latest || samples.length < 2) return { ready: false, reason: "insufficient_samples" };
  const oldest = samples[0];
  if (now - oldest.t < CONFIG.minHistoryMs) return { ready: false, reason: "warming_up", ageMs: now - oldest.t };
  // 目标窗口附近必须真有样本。断线十分钟后恢复的第一跳不能冒充“15 秒涨幅”。
  const at15s = sampleAtOrBefore(samples, now - 15_000, 10_000);
  const at30s = sampleAtOrBefore(samples, now - 30_000, 10_000);
  const at1m = sampleAtOrBefore(samples, now - 60_000, 15_000);
  const at3m = sampleAtOrBefore(samples, now - 3 * 60_000, 30_000);
  const at5m = sampleAtOrBefore(samples, now - 5 * 60_000, 45_000);
  const ret15s = returnPct(latest.p, at15s?.p);
  const ret30s = returnPct(latest.p, at30s?.p);
  const ret1m = returnPct(latest.p, at1m?.p);
  const ret3m = returnPct(latest.p, at3m?.p);
  const ret5m = returnPct(latest.p, at5m?.p);
  const directionBasis = finite(ret5m) ? ret5m : finite(ret3m) ? ret3m : finite(ret1m) ? ret1m : finite(ret30s) ? ret30s : ret15s;
  if (!finite(directionBasis) || Number(directionBasis) === 0) return { ready: false, reason: "no_direction" };
  const direction = Number(directionBasis) > 0 ? "long" : "short";
  const sign = direction === "long" ? 1 : -1;
  const directional15s = finite(ret15s) ? Number(ret15s) * sign : 0;
  const directional30s = finite(ret30s) ? Number(ret30s) * sign : 0;
  const directional1m = finite(ret1m) ? Number(ret1m) * sign : 0;
  const directional3m = finite(ret3m) ? Number(ret3m) * sign : 0;
  const directional5m = finite(ret5m) ? Number(ret5m) * sign : 0;
  const expectedShortMove = Math.abs(directional30s) / 2;
  const acceleration = expectedShortMove > 0 ? Math.abs(directional15s) / expectedShortMove : null;
  const oiBase = at3m?.oi ?? at30s?.oi;
  const volumeBase = at3m?.v ?? at30s?.v;
  const oiChange3mPct = returnPct(latest.oi, oiBase);
  const volumeChange3mPct = returnPct(latest.v, volumeBase);
  const high = Number(market.high24h), low = Number(market.low24h), price = Number(latest.p);
  const rangePosition24h = finite(high) && finite(low) && high > low ? clamp((price - low) / (high - low), 0, 1) : null;
  const spreadBps = finite(market.spreadBps) ? Number(market.spreadBps) : null;

  let score = 0;
  score += clamp(directional15s / 0.2, 0, 1) * 20;
  score += clamp(directional30s / 0.45, 0, 1) * 25;
  score += clamp(directional1m / 0.8, 0, 1) * 20;
  score += clamp(directional3m / 1.5, 0, 1) * 15;
  score += clamp(directional5m / 2.5, 0, 1) * 5;
  if (finite(acceleration)) score += clamp((Number(acceleration) - 1) / 1, 0, 1) * 5;
  if (finite(oiChange3mPct) && Number(oiChange3mPct) > 0) score += clamp(Number(oiChange3mPct) / 0.5, 0, 1) * 5;
  if (finite(volumeChange3mPct) && Number(volumeChange3mPct) > 0) score += clamp(Number(volumeChange3mPct) / 0.1, 0, 1) * 2.5;
  if (rangePosition24h != null) {
    const proximity = direction === "long" ? rangePosition24h : 1 - rangePosition24h;
    score += clamp((proximity - 0.7) / 0.3, 0, 1) * 1.25;
  }
  if (spreadBps != null) score += spreadBps <= 8 ? 1.25 : spreadBps <= 15 ? 0.5 : 0;

  const evidenceCount = [
    directional15s >= 0.1,
    directional30s >= 0.2,
    directional1m >= 0.2,
    directional3m >= 0.35,
    directional5m >= 0.6,
    finite(acceleration) && Number(acceleration) >= 1.35,
    finite(oiChange3mPct) && Number(oiChange3mPct) >= 0.2,
    finite(volumeChange3mPct) && Number(volumeChange3mPct) >= 0.05
  ].filter(Boolean).length;
  return {
    ready: true,
    direction,
    score: Number(clamp(score, 0, 100).toFixed(1)),
    evidenceCount,
    ret15sPct: finite(ret15s) ? Number(Number(ret15s).toFixed(3)) : null,
    ret30sPct: finite(ret30s) ? Number(Number(ret30s).toFixed(3)) : null,
    ret1mPct: finite(ret1m) ? Number(Number(ret1m).toFixed(3)) : null,
    ret3mPct: finite(ret3m) ? Number(Number(ret3m).toFixed(3)) : null,
    ret5mPct: finite(ret5m) ? Number(Number(ret5m).toFixed(3)) : null,
    acceleration: finite(acceleration) ? Number(Number(acceleration).toFixed(2)) : null,
    oiChange3mPct: finite(oiChange3mPct) ? Number(Number(oiChange3mPct).toFixed(3)) : null,
    volumeChange3mPct: finite(volumeChange3mPct) ? Number(Number(volumeChange3mPct).toFixed(3)) : null,
    rangePosition24h: rangePosition24h == null ? null : Number(rangePosition24h.toFixed(3)),
    spreadBps,
    price,
    observedAt: new Date(now).toISOString()
  };
}

// 短周期异常波动评估：只使用已落库的 OKX WebSocket 样本、已核验快讯和事件。
// “风险升高”不是价格预测；只有真实 5 分钟涨跌达到阈值才标记为“已经发生”。
export function assessAbnormalVolatility(db, symbolInput, options = {}) {
  const symbol = normalizeSymbol(symbolInput);
  const now = Number(options.now || Date.now());
  const thresholdPct = clamp(Number(options.thresholdPct || 5), 0.5, 30);
  const state = db.marketFeatureState?.[symbol] || {};
  const market = (db.markets || []).find((row) => normalizeSymbol(row.symbol) === symbol) || {};
  const features = computeEarlyOpportunityFeatures(state.samples || [], market, now);
  const base = symbol.split("/")[0];
  const isRelated = (item = {}) => {
    const symbols = item.symbols || item.relatedSymbols || item.values?.symbols || [];
    if ((Array.isArray(symbols) ? symbols : [symbols]).some((value) => normalizeSymbol(value).startsWith(`${base}/`) || String(value).toUpperCase() === base)) return true;
    const text = `${item.title || ""} ${item.summary || ""}`.toUpperCase();
    return new RegExp(`(^|[^A-Z0-9])${base}([^A-Z0-9]|$)`).test(text);
  };
  const freshNews = (db.marketIntelligenceFacts || [])
    .filter((item) => item.category === "flash_news" && isRelated(item) && now - new Date(item.publishedAt || item.createdAt || 0).getTime() <= 30 * 60_000)
    .slice(0, 3)
    .map((item) => ({ id: item.id, title: item.title, publishedAt: item.publishedAt, important: item.values?.important === true, source: item.sourceName || item.source }));
  const upcomingEvents = [...(db.events || []), ...(db.marketCalendarEvents || [])]
    .filter((item) => {
      const at = new Date(item.due || item.startAt || item.releaseAt || 0).getTime();
      const highImpact = Number(item.impact || 0) >= 70 || item.importance === "high";
      return highImpact && at >= now && at - now <= 60 * 60_000 && (isRelated(item) || !(item.relatedSymbols || item.symbols));
    })
    .slice(0, 3)
    .map((item) => ({ id: item.id, title: item.title || item.shortTitle, due: item.due || item.startAt || item.releaseAt, impact: item.impact ?? item.importance }));

  const ret5m = features.ready && finite(features.ret5mPct) ? Number(features.ret5mPct) : null;
  const realized = ret5m != null && Math.abs(ret5m) >= thresholdPct;
  const accelerationRisk = features.ready && (
    Number(features.score || 0) >= 72
    || Math.abs(Number(features.ret1mPct || 0)) >= thresholdPct * 0.3
    || Math.abs(Number(features.ret3mPct || 0)) >= thresholdPct * 0.6
  );
  const catalystRisk = freshNews.some((item) => item.important) || upcomingEvents.length > 0;
  const evidence = [];
  if (features.ready) {
    evidence.push({ type: "okx_returns", observedAt: features.observedAt, ret1mPct: features.ret1mPct, ret3mPct: features.ret3mPct, ret5mPct: features.ret5mPct });
    evidence.push({ type: "okx_acceleration", score: features.score, acceleration: features.acceleration, oiChange3mPct: features.oiChange3mPct, volumeChange3mPct: features.volumeChange3mPct });
  }
  if (freshNews.length) evidence.push({ type: "verified_flash_news", items: freshNews });
  if (upcomingEvents.length) evidence.push({ type: "upcoming_high_impact_event", items: upcomingEvents });
  const status = realized ? "confirmed" : (accelerationRisk || catalystRisk) ? "elevated" : features.ready ? "normal" : "insufficient_data";
  const riskScore = realized ? 100 : Math.round(clamp(
    (features.ready ? Number(features.score || 0) * 0.72 : 0)
      + (freshNews.some((item) => item.important) ? 18 : freshNews.length ? 8 : 0)
      + (upcomingEvents.length ? 10 : 0),
    0, 99
  ));
  const caveat = status === "confirmed"
    ? `OKX 实测 5 分钟绝对涨跌已达到 ${thresholdPct}% 阈值。`
    : status === "elevated"
      ? "存在短周期加速或事件催化证据，只表示异常波动风险升高，不代表一定发生，也不直接生成交易方向。"
      : status === "insufficient_data"
        ? "连续 OKX 短周期样本不足，不能判断；系统不得用知识库或猜测补齐。"
        : `OKX 实测尚未达到 5 分钟 ${thresholdPct}% 阈值，当前也没有足够的升温证据。`;
  const caveatEn = status === "confirmed"
    ? `The observed absolute OKX move over 5 minutes has reached the ${thresholdPct}% threshold.`
    : status === "elevated"
      ? "Short-window acceleration or an event catalyst is present. This indicates elevated risk, not a prediction, and it does not set a trade direction."
      : status === "insufficient_data"
        ? "There are not enough continuous short-window OKX samples to assess the move. The system must not fill the gap with model knowledge or guesses."
        : `The observed OKX move has not reached the ${thresholdPct}% five-minute threshold, and there is not enough evidence of acceleration.`;
  return {
    symbol,
    windowMinutes: 5,
    thresholdPct,
    status,
    riskScore,
    direction: features.ready ? features.direction : null,
    realizedMovePct: ret5m,
    observedAt: features.observedAt || state.updatedAt || null,
    sampleAgeMs: state.updatedAt ? Math.max(0, now - new Date(state.updatedAt).getTime()) : null,
    evidence,
    caveat,
    caveatEn
  };
}

export function abnormalVolatilityBoard(db, options = {}) {
  const mandate = activeMandate(db);
  const symbols = [...new Set([
    ...(mandate?.allowedSymbols || []),
    ...(db.watchlist || []),
    ...(db.positions || []).map((row) => row.symbol)
  ].filter(Boolean).map(normalizeSymbol))];
  return symbols.map((symbol) => assessAbnormalVolatility(db, symbol, options))
    .sort((a, b) => (b.status === "confirmed") - (a.status === "confirmed") || b.riskScore - a.riskScore);
}

// 极值反转启动探测：不是“低位=做多/高位=做空”，而是要求先有一段反向运动，
// 随后从滚动极值回收、短窗口动量翻向，并处在相应 24h 位置。它只唤起 AI 深度验证，绝不直接下单。
export function computeEarlyReversalFeatures(samples = [], market = {}, now = Date.now()) {
  const latest = samples.at(-1);
  if (!latest || samples.length < 3 || now - samples[0].t < CONFIG.minHistoryMs) return { ready: false, qualified: false, reason: "warming_up" };
  const window = samples.filter((row) => now - row.t <= 5 * 60_000);
  if (window.length < 3) return { ready: false, qualified: false, reason: "insufficient_samples" };
  const at15s = sampleAtOrBefore(window, now - 15_000, 10_000);
  const at30s = sampleAtOrBefore(window, now - 30_000, 10_000);
  const ret15s = returnPct(latest.p, at15s?.p);
  const ret30s = returnPct(latest.p, at30s?.p);
  const prices = window.map((row) => Number(row.p)).filter(Number.isFinite);
  const rollingLow = Math.min(...prices), rollingHigh = Math.max(...prices);
  const lowIndex = prices.lastIndexOf(rollingLow), highIndex = prices.lastIndexOf(rollingHigh);
  const priorDropPct = returnPct(rollingLow, prices[0]);
  const priorRisePct = returnPct(rollingHigh, prices[0]);
  const reboundPct = returnPct(latest.p, rollingLow);
  const rejectionPct = returnPct(latest.p, rollingHigh);
  const high24h = Number(market.high24h), low24h = Number(market.low24h);
  const rangePosition24h = finite(high24h) && finite(low24h) && high24h > low24h
    ? clamp((Number(latest.p) - low24h) / (high24h - low24h), 0, 1) : null;
  const volumeBase = window[0]?.v;
  const volumeChangePct = returnPct(latest.v, volumeBase);
  const book = finite(market.bookImbalancePct) ? Number(market.bookImbalancePct) : null;

  const longChecks = {
    lowerLocation: rangePosition24h != null && rangePosition24h <= 0.35,
    priorDownLeg: finite(priorDropPct) && Number(priorDropPct) <= -0.3,
    reclaimedLow: lowIndex < prices.length - 1 && finite(reboundPct) && Number(reboundPct) >= 0.2,
    momentumFlip: Math.max(Number(ret15s || 0), Number(ret30s || 0)) >= 0.08,
    activityExpansion: finite(volumeChangePct) && Number(volumeChangePct) > 0,
    bookFlip: book != null && book >= 55
  };
  const shortChecks = {
    upperLocation: rangePosition24h != null && rangePosition24h >= 0.65,
    priorUpLeg: finite(priorRisePct) && Number(priorRisePct) >= 0.3,
    rejectedHigh: highIndex < prices.length - 1 && finite(rejectionPct) && Number(rejectionPct) <= -0.2,
    momentumFlip: Math.min(Number(ret15s || 0), Number(ret30s || 0)) <= -0.08,
    activityExpansion: finite(volumeChangePct) && Number(volumeChangePct) > 0,
    bookFlip: book != null && book <= 45
  };
  const essentialLong = ["lowerLocation", "priorDownLeg", "reclaimedLow", "momentumFlip"];
  const essentialShort = ["upperLocation", "priorUpLeg", "rejectedHigh", "momentumFlip"];
  const scoreChecks = (checks, essentials) => {
    const confirmations = Object.entries(checks).filter(([, passed]) => passed).map(([name]) => name);
    const essentialCount = essentials.filter((name) => checks[name]).length;
    const optionalCount = confirmations.length - essentialCount;
    return { confirmations, essentialCount, score: Math.min(100, essentialCount * 22 + optionalCount * 6) };
  };
  const long = scoreChecks(longChecks, essentialLong);
  const short = scoreChecks(shortChecks, essentialShort);
  const selected = long.score >= short.score
    ? { direction: "long", checks: longChecks, essentials: essentialLong, ...long }
    : { direction: "short", checks: shortChecks, essentials: essentialShort, ...short };
  const qualified = selected.essentialCount === selected.essentials.length && selected.score >= CONFIG.minScore;
  const missing = selected.essentials.filter((name) => !selected.checks[name]);
  return {
    ready: true,
    qualified,
    setupType: "reversal_reclaim",
    direction: selected.direction,
    score: selected.score,
    evidenceCount: selected.confirmations.length,
    confirmations: selected.confirmations,
    missing,
    ret15sPct: finite(ret15s) ? Number(Number(ret15s).toFixed(3)) : null,
    ret30sPct: finite(ret30s) ? Number(Number(ret30s).toFixed(3)) : null,
    priorLegPct: selected.direction === "long" ? priorDropPct : priorRisePct,
    reclaimPct: selected.direction === "long" ? reboundPct : Math.abs(Number(rejectionPct || 0)),
    rangePosition24h: rangePosition24h == null ? null : Number(rangePosition24h.toFixed(3)),
    price: Number(latest.p),
    observedAt: new Date(now).toISOString()
  };
}

function pushOpportunityEvent(db, event) {
  db.opportunityEvents ||= [];
  db.opportunityEvents.unshift({ id: id("oppevt"), createdAt: nowIso(), ...event });
  if (db.opportunityEvents.length > 1000) db.opportunityEvents.length = 1000;
}

function upsertCandidate(db, payload, now = Date.now()) {
  db.opportunityCandidates ||= [];
  const symbol = normalizeSymbol(payload.symbol);
  let candidate = db.opportunityCandidates.find((row) =>
    row.symbol === symbol && row.direction === payload.direction
      && ["DISCOVERED", "ANALYZING", "QUALIFIED", "ARMED"].includes(row.status)
  );
  const created = !candidate;
  if (!candidate) {
    candidate = {
      id: id("opp"), symbol, direction: payload.direction, status: "DISCOVERED",
      firstDetectedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), history: []
    };
    db.opportunityCandidates.unshift(candidate);
  }
  const sourcePriority = (source) => String(source || "").includes("WS_EARLY") ? 2 : 1;
  const lowerPriorityUpdate = !created && sourcePriority(payload.source) < sourcePriority(candidate.source);
  if (lowerPriorityUpdate) {
    candidate.broadContext = { score: Number(payload.score || 0), features: payload.features || null, reason: payload.reason || null, observedAt: new Date(now).toISOString() };
  } else {
    candidate.source = payload.source;
    candidate.score = Number(payload.score || 0);
    candidate.features = payload.features || null;
    candidate.reason = payload.reason || null;
    candidate.lastDetectedAt = new Date(now).toISOString();
    candidate.updatedAt = candidate.lastDetectedAt;
    candidate.expiresAt = new Date(now + CONFIG.candidateTtlMs).toISOString();
    candidate.history ||= [];
    candidate.history.push({ at: candidate.updatedAt, score: candidate.score, price: payload.features?.price ?? payload.price ?? null });
    if (candidate.history.length > 20) candidate.history = candidate.history.slice(-20);
  }
  if (created) pushOpportunityEvent(db, { type: "DISCOVERED", candidateId: candidate.id, symbol, direction: candidate.direction, score: candidate.score, source: candidate.source });
  return { candidate, created, primaryUpdated: !lowerPriorityUpdate };
}

function queueSignal(db, candidate, now = Date.now()) {
  db.system ||= {};
  db.system.pendingOpportunitySignals ||= [];
  prunePendingOpportunitySignals(db, now);
  // 已经形成结构化计划（待批/武装/执行）的候选不再重复唤起 LLM。
  if (candidate.planId) return false;
  const duplicate = db.system.pendingOpportunitySignals.some((row) => row.candidateId === candidate.id);
  const lastQueued = candidate.lastQueuedAt ? new Date(candidate.lastQueuedAt).getTime() : 0;
  if (duplicate || now - lastQueued < CONFIG.signalCooldownMs) return false;
  const signal = {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    direction: candidate.direction,
    score: candidate.score,
    features: candidate.features,
    source: candidate.source,
    detectedAt: candidate.firstDetectedAt,
    queuedAt: new Date(now).toISOString()
  };
  db.system.pendingOpportunitySignals.push(signal);
  db.system.pendingOpportunitySignals = db.system.pendingOpportunitySignals.slice(-CONFIG.maxPendingSignals);
  candidate.lastQueuedAt = signal.queuedAt;
  pushOpportunityEvent(db, { type: "QUEUED_FOR_AI", candidateId: candidate.id, symbol: candidate.symbol, direction: candidate.direction, score: candidate.score });
  appendAudit(db, `早期机会进入 AI 复核：${candidate.symbol} ${candidate.direction} score=${candidate.score}`, candidate.id, "OpportunityEngine", "info");
  return true;
}

function supersedeOppositeEarlySignals(db, symbol, direction, now = Date.now()) {
  const supersededIds = new Set();
  const at = new Date(now).toISOString();
  for (const candidate of db.opportunityCandidates || []) {
    if (candidate.symbol !== symbol || candidate.direction === direction) continue;
    // 已形成计划或已经武装的候选交给执行/撤单链路处理；这里只清理尚未闭环的早期发现，
    // 防止同一品种“旧趋势空 + 新反转多”同时留在 AI 待办里。
    if (candidate.planId || !["DISCOVERED", "ANALYZING"].includes(candidate.status)) continue;
    if (!String(candidate.source || "").includes("WS_EARLY")) continue;
    candidate.status = "SUPERSEDED";
    candidate.closeReason = `被更新的 ${direction} 反转回收证据取代`;
    candidate.closedAt = at;
    candidate.updatedAt = at;
    supersededIds.add(candidate.id);
    pushOpportunityEvent(db, {
      type: "SUPERSEDED",
      candidateId: candidate.id,
      symbol,
      direction: candidate.direction,
      supersededByDirection: direction
    });
  }
  if (supersededIds.size && db.system?.pendingOpportunitySignals) {
    db.system.pendingOpportunitySignals = db.system.pendingOpportunitySignals
      .filter((signal) => !supersededIds.has(signal.candidateId));
  }
  return supersededIds.size;
}

export function prunePendingOpportunitySignals(db, now = Date.now()) {
  db.system ||= {};
  const candidates = new Map((db.opportunityCandidates || []).map((row) => [row.id, row]));
  const removed = [];
  db.system.pendingOpportunitySignals = (db.system.pendingOpportunitySignals || []).filter((signal) => {
    const queuedAt = new Date(signal.queuedAt || signal.detectedAt || 0).getTime();
    const candidate = candidates.get(signal.candidateId);
    const stale = !Number.isFinite(queuedAt) || now - queuedAt > CONFIG.candidateTtlMs;
    const terminal = candidate && !["DISCOVERED", "ANALYZING"].includes(candidate.status);
    if (stale || !candidate || terminal) {
      removed.push(signal);
      if (candidate && stale && ["DISCOVERED", "ANALYZING"].includes(candidate.status)) {
        candidate.status = "EXPIRED";
        candidate.closedAt = new Date(now).toISOString();
        candidate.updatedAt = candidate.closedAt;
      }
      return false;
    }
    return true;
  });
  return removed;
}

export function recordOpportunityTick(db, symbolInput, tick = {}, now = Date.now()) {
  const symbol = normalizeSymbol(symbolInput);
  const price = Number(tick.price);
  if (!finite(price) || price <= 0) return { status: "invalid_price" };
  db.marketFeatureState ||= {};
  const state = db.marketFeatureState[symbol] ||= { samples: [] };
  const sample = {
    t: now,
    p: price,
    oi: finite(tick.openInterest) ? Number(tick.openInterest) : null,
    v: finite(tick.volume24h) ? Number(tick.volume24h) : null
  };
  const last = state.samples.at(-1);
  if (last && now - last.t < CONFIG.sampleIntervalMs) state.samples[state.samples.length - 1] = sample;
  else state.samples.push(sample);
  state.samples = state.samples.filter((row) => now - row.t <= CONFIG.bufferMs);
  state.updatedAt = new Date(now).toISOString();
  const market = (db.markets || []).find((row) => row.symbol === symbol) || tick;
  const features = computeEarlyOpportunityFeatures(state.samples, market, now);
  state.features = features;
  const reversal = computeEarlyReversalFeatures(state.samples, market, now);
  state.reversal = reversal;
  const candles = market?.candlesByTf?.["1h"]?.candles || market?.candles || [];
  state.setupSnapshot = buildOpportunitySetupSnapshot({ market: { ...market, price }, candles, early: features, reversal });
  market.opportunitySetup = state.setupSnapshot;
  const momentumQualified = features.ready && features.score >= CONFIG.minScore && features.evidenceCount >= 2;
  const reversalQualified = reversal.qualified === true;
  if (!momentumQualified && !reversalQualified) {
    return { status: features.ready || reversal.ready ? "below_threshold" : features.reason, features, reversal, setupSnapshot: state.setupSnapshot };
  }
  // 极值处出现完整“反向腿→极值回收→短动量翻向”时，优先把反转候选交给 AI；
  // 避免旧趋势分仍高而继续把低位反弹误标成追空候选。
  const selected = reversalQualified ? reversal : { ...features, setupType: "momentum_start" };
  if (reversalQualified) supersedeOppositeEarlySignals(db, symbol, selected.direction, now);
  const result = upsertCandidate(db, {
    symbol,
    direction: selected.direction,
    score: selected.score,
    features: { ...selected, trendContext: features.ready ? { direction: features.direction, score: features.score } : null, setupSnapshot: state.setupSnapshot },
    source: reversalQualified ? "OKX_WS_EARLY_REVERSAL" : "OKX_WS_EARLY"
  }, now);
  const mandate = activeMandate(db);
  const inWhitelist = Boolean(mandate?.allowedSymbols?.includes(symbol));
  const queued = inWhitelist ? queueSignal(db, result.candidate, now) : false;
  return { status: result.created ? "discovered" : "updated", candidate: result.candidate, queued, inWhitelist, features: selected, reversal, setupSnapshot: state.setupSnapshot };
}

export function peekOpportunitySignals(db, limit = 2) {
  prunePendingOpportunitySignals(db);
  return [...(db.system?.pendingOpportunitySignals || [])]
    .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || String(a.queuedAt || "").localeCompare(String(b.queuedAt || "")))
    .slice(0, Math.max(1, Number(limit || 1)));
}

export function consumeOpportunitySignals(db, limit = 2) {
  db.system ||= {};
  const consumed = peekOpportunitySignals(db, limit);
  const consumedIds = new Set(consumed.map((row) => row.candidateId));
  db.system.pendingOpportunitySignals = (db.system.pendingOpportunitySignals || []).filter((row) => !consumedIds.has(row.candidateId));
  for (const signal of consumed) {
    const candidate = (db.opportunityCandidates || []).find((row) => row.id === signal.candidateId);
    if (candidate) {
      candidate.status = "ANALYZING";
      candidate.analysisStartedAt = nowIso();
      candidate.updatedAt = candidate.analysisStartedAt;
    }
  }
  return consumed;
}

export function expireOpportunityCandidates(db, now = Date.now()) {
  const expired = [];
  for (const candidate of db.opportunityCandidates || []) {
    if (!["DISCOVERED", "ANALYZING", "QUALIFIED"].includes(candidate.status)) continue;
    if (new Date(candidate.expiresAt || 0).getTime() > now) continue;
    candidate.status = "EXPIRED";
    candidate.closedAt = new Date(now).toISOString();
    candidate.updatedAt = candidate.closedAt;
    expired.push(candidate);
  }
  return expired;
}

export async function runBroadOpportunityScan(db, options = {}) {
  expireOpportunityCandidates(db);
  const mandate = activeMandate(db);
  const scan = await scanOpportunities(db, { limit: options.limit || 20, direction: "both", whitelist: mandate?.allowedSymbols || [] });
  const queued = [];
  for (const row of scan.candidates || []) {
    const result = upsertCandidate(db, {
      symbol: row.symbol,
      direction: row.side,
      score: row.score,
      source: "OKX_REST_BROAD",
      price: row.last,
      features: {
        price: row.last,
        change24hPct: row.changePct24h,
        rangePosition24h: row.rangePos,
        volatility24hPct: row.volatilityPct,
        quoteVolUsdtM: row.quoteVolUsdtM,
        observedAt: scan.scannedAt
      },
      reason: row.reason
    });
    if (result.primaryUpdated && row.inWhitelist && row.score >= CONFIG.broadMinScore && queueSignal(db, result.candidate)) queued.push(result.candidate.id);
  }
  appendTrace(db, "opportunity_scan", `全市场 ${scan.universe || 0} 个，候选 ${scan.candidates?.length || 0}，进入 AI ${queued.length}`, scan.error ? "warning" : "ok");
  return { status: scan.error ? "degraded" : "ok", universe: scan.universe || 0, candidates: scan.candidates?.length || 0, queued, error: scan.error || null };
}

export function opportunityEngineStatus(db) {
  const candidates = db.opportunityCandidates || [];
  return {
    pendingSignals: db.system?.pendingOpportunitySignals?.length || 0,
    activeCandidates: candidates.filter((row) => ["DISCOVERED", "ANALYZING", "QUALIFIED"].includes(row.status)).length,
    armedSetups: (db.armedSetups || []).filter((row) => ["ARMED", "TRIGGERED", "FAST_VALIDATING", "EXECUTING", "RECOVERY_PENDING_RECONCILIATION"].includes(row.status)).length,
    trackedSymbols: Object.keys(db.marketFeatureState || {}).length
  };
}
