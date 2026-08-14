import { fetchTickerQuiet } from "./exchangeConnector.mjs";
import { createNotification } from "./notificationStore.mjs";
import { runTask } from "./scheduler.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { queueWatchTelegramEvent } from "./telegramWatchNotifier.mjs";
import { describeWatch, watchDirectionLabel, watchThesis, watchTriggerMeaning } from "./watchView.mjs";

export { buildWatchBoard, describeWatch, presentWatch, watchDirectionLabel, watchThesis, watchTriggerMeaning } from "./watchView.mjs";

// ---------------------------------------------------------------------------
// 观察哨（Watch Sentinel）：AI 交易员把"若 X 发生则重新评估"登记成结构化价格条件，
// 哨兵每分钟用真实行情机械核对；命中后通过现有巡检任务（同一把并发锁、同一条
// propose_trade_plan → 硬风控链路）立即触发一轮完整分析。哨兵本身绝不下单。
//
// 四条硬要求的实现方式：
// 1. 不漏触发 —— 穿越判定用"上次已知价 vs 本次价"比较，行情拉取失败只会迟到、不会错过；
// 2. 不重复触发 —— 一次性哨（触发即离场），且登记时条件已成立会被拒绝（防止即挂即爆）；
// 3. 不失控烧钱 —— 全局 8 哨/单币 3 哨上限、每小时最多 4 次哨兵触发的 LLM 巡检、上限外排队等下轮；
// 4. 不绕过风控 —— 触发只调用 runTask(agent_cycle)：与定时巡检共用锁、授权、日亏预算、风控引擎。
// ---------------------------------------------------------------------------

export const WATCH_LIMITS = {
  maxActive: 8,
  maxPerSymbol: 3,
  defaultTtlHours: 24,
  maxTtlHours: 48,
  maxLevelDeviationPct: 15,   // 条件价距现价超过 ±15% 视为笔误，拒绝
  upsertTolerancePct: 0.3,    // 同币同向、价位差 0.3% 以内视为同一哨，更新而非新增
  maxTriggeredCyclesPerHour: 4
};

const KINDS = new Set(["price_above", "price_below", "enter_zone"]);
const PURPOSES = new Set(["decision", "confirmation", "invalidation", "alternative"]);
const DIRECTIONS = new Set(["long", "short", "neutral"]);

// 条件在 price 下是否"已经成立"（登记时用：已成立说明不该挂哨，该直接分析）
export function conditionAlreadyTrue(watch, price) {
  if (watch.kind === "price_above") return price >= watch.level;
  if (watch.kind === "price_below") return price <= watch.level;
  return price >= watch.levelLow && price <= watch.levelHigh;
}

// 穿越判定（纯函数）：从"上次未成立"到"本次成立"才算触发，静态高于/低于不触发
export function crossed(watch, prevPrice, price) {
  if (!Number.isFinite(prevPrice) || !Number.isFinite(price)) return false;
  if (watch.kind === "price_above") return prevPrice < watch.level && price >= watch.level;
  if (watch.kind === "price_below") return prevPrice > watch.level && price <= watch.level;
  const wasInside = prevPrice >= watch.levelLow && prevPrice <= watch.levelHigh;
  const isInside = price >= watch.levelLow && price <= watch.levelHigh;
  return !wasInside && isInside;
}

export function listActiveWatches(db) {
  return (db.watchTriggers || []).filter((w) => w.status === "active");
}

function analysisGroup(watch = {}) {
  return watch.analysisId || "legacy";
}

function normalizePrimaryWatch(db, symbol, groupId = null) {
  const matches = (db.watchTriggers || []).filter((watch) => ["active", "pending_analysis"].includes(watch.status) && watch.symbol === symbol
    && (groupId == null || analysisGroup(watch) === groupId));
  if (!matches.length) return;
  const explicit = matches.find((watch) => watch.priority === "primary") || matches[0];
  for (const watch of matches) watch.priority = watch.id === explicit.id ? "primary" : "secondary";
}

function supersedeOlderAnalysis(db, symbol, nextAnalysisId, actor) {
  if (!nextAnalysisId) return [];
  const closedAt = nowIso();
  const superseded = listActiveWatches(db).filter((watch) => watch.symbol === symbol && watch.analysisId !== nextAnalysisId);
  for (const watch of superseded) {
    watch.wasPrimary = watch.priority === "primary";
    watch.status = "superseded";
    watch.closedAt = closedAt;
    watch.closeReason = "已由该币种的最新市场分析取代";
    watch.supersededByAnalysisId = nextAnalysisId;
  }
  if (superseded.length) {
    appendAudit(db, `${symbol} 旧分析的 ${superseded.length} 个观察哨已由最新分析取代`, nextAnalysisId, actor);
  }
  return superseded;
}

// 盯盘闸(纯函数):把"看"和"做"分开。
// - killSwitch 熔断 → 全停(紧急语义:连盯盘都停,恢复后重新定基,避免基于熔断期行情误触发)。
// - autonomy 只决定触发后要不要【自动唤起 AI 分析/下单】,绝不影响"盯盘+穿越检测+通知"本身——
//   盯盘是只读、安全动作;用户关掉自动交易恰恰是想自己决策,但仍然要收到"价格到位了"的提醒。
//   (旧 bug:autonomy 关时整个 runWatchSentinel 直接 paused,挂了哨也不响、快速异动也熄火。)
export function sentinelGate(system = {}) {
  if (system.killSwitch) return { monitor: false, autoAnalyze: false };
  return { monitor: true, autoAnalyze: Boolean(system.autonomyEnabled) };
}

export function registerWatch(db, args = {}, currentPrice, actor = "AI 交易员") {
  const mandate = activeMandate(db);
  if (!mandate) return { ok: false, error: "当前无激活授权，观察哨只在授权生效期内可登记。" };
  const symbol = String(args.symbol || "").trim().toUpperCase();
  if (!mandate.allowedSymbols?.includes(symbol)) {
    return { ok: false, error: `${symbol || "(空)"} 不在授权白名单（${(mandate.allowedSymbols || []).join("、")}）内。` };
  }
  const kind = String(args.kind || "");
  if (!KINDS.has(kind)) return { ok: false, error: "kind 必须是 price_above / price_below / enter_zone。" };
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "无法获取该币现价，暂不能登记观察哨。" };

  const watch = {
    id: id("watch"),
    symbol,
    kind,
    level: Number(args.level),
    levelLow: Number(args.levelLow),
    levelHigh: Number(args.levelHigh),
    note: String(args.note || "").slice(0, 200),
    direction: DIRECTIONS.has(String(args.direction || "").toLowerCase()) ? String(args.direction).toLowerCase() : null,
    thesis: String(args.thesis || "").replace(/\s+/g, " ").trim().slice(0, 220) || null,
    triggerMeaning: String(args.triggerMeaning || "").replace(/\s+/g, " ").trim().slice(0, 220) || null,
    purpose: PURPOSES.has(String(args.purpose || "")) ? String(args.purpose) : null,
    priority: args.priority === "primary" ? "primary" : "secondary",
    setupType: String(args.setupType || "").slice(0, 80) || null,
    traderRole: String(args.traderRole || "").slice(0, 40) || null,
    analysisId: String(args.analysisId || "").slice(0, 120) || null,
    analysisAt: args.analysisAt || null,
    analysisTitle: String(args.analysisTitle || "").replace(/\s+/g, " ").slice(0, 120) || null,
    reviewOfWatchIds: [...new Set((Array.isArray(args.reviewOfWatchIds) ? args.reviewOfWatchIds : []).map(String).filter(Boolean))].slice(0, 8),
    parentWatchId: String(args.parentWatchId || "").slice(0, 120) || null,
    rootWatchId: String(args.rootWatchId || "").slice(0, 120) || null,
    reviewDepth: Number.isFinite(Number(args.reviewDepth)) ? Math.max(0, Number(args.reviewDepth)) : 0,
    reviewReasonCode: String(args.reviewReasonCode || "").slice(0, 80) || null,
    lineageVersion: Number.isFinite(Number(args.lineageVersion)) ? Math.max(1, Number(args.lineageVersion)) : 1,
    lineageStartedAt: args.lineageStartedAt || null,
    thesisFingerprint: String(args.thesisFingerprint || "").slice(0, 120) || null,
    structureFingerprint: String(args.structureFingerprint || "").slice(0, 120) || null,
    structureEvidenceRef: String(args.structureEvidenceRef || "").slice(0, 180) || null,
    previousRootWatchId: String(args.previousRootWatchId || "").slice(0, 120) || null,
    lineageResetReason: String(args.lineageResetReason || "").slice(0, 80) || null,
    lineageResetEvidenceRef: String(args.lineageResetEvidenceRef || "").slice(0, 180) || null,
    rearmWindowHours: Number.isFinite(Number(args.rearmWindowHours)) ? Number(args.rearmWindowHours) : null,
    status: args.deferTelegram === true ? "pending_analysis" : "active",
    version: 1,
    createdAt: nowIso(),
    createdBy: actor,
    lastPrice: price,
    priceAtCreation: price
  };
  watch.rootWatchId ||= watch.id;
  watch.lineageStartedAt ||= watch.createdAt;
  if (kind === "enter_zone") {
    if (!Number.isFinite(watch.levelLow) || !Number.isFinite(watch.levelHigh) || watch.levelLow <= 0 || watch.levelHigh <= watch.levelLow) {
      return { ok: false, error: "enter_zone 需要 levelLow < levelHigh 且均为正数。" };
    }
  } else if (!Number.isFinite(watch.level) || watch.level <= 0) {
    return { ok: false, error: "level 必须为正数价格。" };
  }

  // 条件已成立 → 不挂哨（挂上下一 tick 也不会触发，穿越语义要求先离开条件区）
  if (conditionAlreadyTrue(watch, price)) {
    return { ok: false, error: `条件当前已成立（现价 ${price}），不需要观察哨——请直接基于现状分析决策。` };
  }
  // 价位离现价过远 → 疑似笔误
  const refLevel = kind === "enter_zone" ? (price > watch.levelHigh ? watch.levelHigh : watch.levelLow) : watch.level;
  const deviationPct = Math.abs(refLevel - price) / price * 100;
  if (deviationPct > WATCH_LIMITS.maxLevelDeviationPct) {
    return { ok: false, error: `条件价距现价 ${deviationPct.toFixed(1)}%（上限 ${WATCH_LIMITS.maxLevelDeviationPct}%），疑似笔误，请核对后重试。` };
  }

  const ttlHours = Math.min(WATCH_LIMITS.maxTtlHours, Math.max(1, Number(args.ttlHours) || WATCH_LIMITS.defaultTtlHours));
  watch.expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

  db.watchTriggers ||= [];
  // 同币同向、价位相近 → 更新已有哨（防止每轮巡检重复登记堆积）
  const twin = db.watchTriggers.find((w) => ["active", "pending_analysis"].includes(w.status) && w.symbol === symbol && w.kind === kind
    && (!watch.analysisId || w.analysisId === watch.analysisId)
    && Math.abs(((kind === "enter_zone" ? w.levelLow : w.level) - (kind === "enter_zone" ? watch.levelLow : watch.level)) / price) * 100 <= WATCH_LIMITS.upsertTolerancePct);
  if (twin) {
    twin.version = Number(twin.version || 1) + 1;
    twin.note = watch.note || twin.note;
    twin.direction = watch.direction || twin.direction || null;
    twin.thesis = watch.thesis || twin.thesis || null;
    twin.triggerMeaning = watch.triggerMeaning || twin.triggerMeaning || null;
    twin.expiresAt = watch.expiresAt;
    twin.level = watch.level;
    twin.levelLow = watch.levelLow;
    twin.levelHigh = watch.levelHigh;
    twin.analysisId = watch.analysisId || twin.analysisId || null;
    twin.analysisAt = watch.analysisAt || twin.analysisAt || twin.createdAt;
    twin.analysisTitle = watch.analysisTitle || twin.analysisTitle || null;
    twin.setupType = watch.setupType || twin.setupType || null;
    twin.traderRole = watch.traderRole || twin.traderRole || null;
    twin.reviewOfWatchIds = watch.reviewOfWatchIds.length ? watch.reviewOfWatchIds : (twin.reviewOfWatchIds || []);
    twin.parentWatchId = watch.parentWatchId || twin.parentWatchId || null;
    twin.rootWatchId = watch.rootWatchId || twin.rootWatchId || twin.id;
    twin.reviewDepth = Math.max(Number(twin.reviewDepth || 0), Number(watch.reviewDepth || 0));
    twin.reviewReasonCode = watch.reviewReasonCode || twin.reviewReasonCode || null;
    twin.lineageVersion = Math.max(Number(twin.lineageVersion || 1), Number(watch.lineageVersion || 1));
    twin.lineageStartedAt = watch.lineageStartedAt || twin.lineageStartedAt || twin.createdAt;
    twin.thesisFingerprint = watch.thesisFingerprint || twin.thesisFingerprint || null;
    twin.structureFingerprint = watch.structureFingerprint || twin.structureFingerprint || null;
    twin.structureEvidenceRef = watch.structureEvidenceRef || twin.structureEvidenceRef || null;
    twin.previousRootWatchId = watch.previousRootWatchId || twin.previousRootWatchId || null;
    twin.lineageResetReason = watch.lineageResetReason || twin.lineageResetReason || null;
    twin.lineageResetEvidenceRef = watch.lineageResetEvidenceRef || twin.lineageResetEvidenceRef || null;
    twin.rearmWindowHours = watch.rearmWindowHours || twin.rearmWindowHours || null;
    twin.purpose = watch.purpose || twin.purpose || (twin.priority === "primary" ? "decision" : "alternative");
    if (args.deferTelegram === true) twin.status = "pending_analysis";
    if (args.priority === "primary") {
      for (const other of listActiveWatches(db)) {
        if (other.symbol === symbol && analysisGroup(other) === analysisGroup(twin)) other.priority = other.id === twin.id ? "primary" : "secondary";
      }
    }
    normalizePrimaryWatch(db, symbol, analysisGroup(twin));
    appendAudit(db, `观察哨更新：${describeWatch(twin)}`, twin.id, actor);
    if (args.deferTelegram !== true) queueWatchTelegramEvent(db, twin, "updated");
    return { ok: true, watch: twin, updated: true };
  }

  const activeBeforeReplacement = listActiveWatches(db);
  const replacedIds = new Set(watch.analysisId
    ? activeBeforeReplacement.filter((item) => item.symbol === symbol && item.analysisId !== watch.analysisId).map((item) => item.id)
    : []);
  const pendingForAnalysis = (db.watchTriggers || []).filter((item) => item.status === "pending_analysis" && item.analysisId === watch.analysisId);
  const active = [...activeBeforeReplacement.filter((item) => !replacedIds.has(item.id)), ...pendingForAnalysis];
  if (active.length >= WATCH_LIMITS.maxActive) {
    return { ok: false, error: `活跃观察哨已达上限 ${WATCH_LIMITS.maxActive} 个，请先用 cancel_watch 撤掉不再需要的哨。当前：${active.map(describeWatch).join("；")}` };
  }
  if (active.filter((w) => w.symbol === symbol).length >= WATCH_LIMITS.maxPerSymbol) {
    return { ok: false, error: `${symbol} 的观察哨已达上限 ${WATCH_LIMITS.maxPerSymbol} 个，请先撤掉一个。` };
  }

  const sameAnalysis = active.filter((item) => item.symbol === symbol && analysisGroup(item) === analysisGroup(watch));
  if (!sameAnalysis.some((item) => item.priority === "primary")) watch.priority = "primary";
  if (watch.priority === "primary") {
    for (const other of sameAnalysis) other.priority = "secondary";
  }
  watch.purpose ||= watch.priority === "primary" ? "decision" : "alternative";

  // 非 Agent/非延迟登记沿用即时生效；Agent 工具登记先保持 pending_analysis，
  // 等整轮 LLM 成功完成后再原子取代旧分析，避免半轮失败留下半成品。
  if (watch.status === "active") supersedeOlderAnalysis(db, symbol, watch.analysisId, actor);
  db.watchTriggers.unshift(watch);
  if (db.watchTriggers.length > 100) db.watchTriggers = db.watchTriggers.slice(0, 100);
  appendAudit(db, `观察哨登记：${describeWatch(watch)}（现价 ${price}）`, watch.id, actor);
  if (args.deferTelegram !== true) queueWatchTelegramEvent(db, watch, "registered");
  return { ok: true, watch };
}

export function finalizeWatchAnalysis(db, analysisId, details = {}) {
  if (!analysisId) return { finalized: 0, symbols: [] };
  const watches = (db.watchTriggers || []).filter((watch) => watch.analysisId === analysisId && ["pending_analysis", "active"].includes(watch.status));
  const at = details.analysisAt || nowIso();
  const title = String(details.analysisTitle || "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const bySymbol = new Map();
  const symbols = [...new Set(watches.map((watch) => watch.symbol))];
  for (const symbol of symbols) normalizePrimaryWatch(db, symbol, analysisId);
  for (const symbol of symbols) supersedeOlderAnalysis(db, symbol, analysisId, details.actor || "AI 交易员");
  for (const watch of watches) {
    watch.status = "active";
    watch.analysisAt = at;
    watch.analysisTitle = title || watch.analysisTitle || null;
    watch.updatedAt = at;
    if (!bySymbol.has(watch.symbol) || watch.priority === "primary") bySymbol.set(watch.symbol, watch);
  }
  for (const watch of bySymbol.values()) queueWatchTelegramEvent(db, watch, "updated", { analysisCompleted: true });
  return { finalized: watches.length, symbols: [...bySymbol.keys()] };
}

export function abortWatchAnalysis(db, analysisId, reason = "AI 分析未完成") {
  if (!analysisId) return { aborted: 0 };
  const pending = (db.watchTriggers || []).filter((watch) => watch.analysisId === analysisId && watch.status === "pending_analysis");
  const at = nowIso();
  for (const watch of pending) {
    watch.status = "invalidated";
    watch.closedAt = at;
    watch.closeReason = reason;
  }
  return { aborted: pending.length };
}

export function cancelWatch(db, watchId, actor = "AI 交易员", reason = "") {
  const watch = (db.watchTriggers || []).find((w) => w.id === watchId && w.status === "active");
  if (!watch) return { ok: false, error: "未找到该活跃观察哨（可能已触发/过期/撤销）。" };
  watch.wasPrimary = watch.priority === "primary";
  watch.status = "cancelled";
  watch.closedAt = nowIso();
  watch.closeReason = reason || "手动撤销";
  appendAudit(db, `观察哨撤销：${describeWatch(watch)}${reason ? `（${reason}）` : ""}`, watch.id, actor);
  normalizePrimaryWatch(db, watch.symbol, analysisGroup(watch));
  queueWatchTelegramEvent(db, watch, "cancelled");
  return { ok: true, watch };
}

// 巡检消费触发的哨：只在已确定进入 LLM 决策后调用；
// patrol_only 必须保留 pending，等熔断/配置/待批准等阻塞解除后再处理。
export function consumeTriggeredWatches(db) {
  const pending = (db.watchTriggers || []).filter((w) => w.status === "triggered" && !w.triggerHandled);
  for (const w of pending) w.triggerHandled = true;
  return pending;
}

// 每分钟哨兵扫描（纯逻辑部分，行情由调用方传入便于测试）：
// 返回 { triggered, expired, invalidated, changed }
export function sweepWatches(db, prices = new Map(), now = Date.now()) {
  const mandate = activeMandate(db);
  const triggered = [];
  const expired = [];
  const invalidated = [];
  let changed = false;
  const changedGroups = new Set();
  for (const watch of listActiveWatches(db)) {
    if (new Date(watch.expiresAt).getTime() <= now) {
      watch.wasPrimary = watch.priority === "primary";
      watch.status = "expired";
      watch.closedAt = nowIso();
      expired.push(watch);
      changed = true;
      changedGroups.add(`${watch.symbol}\0${analysisGroup(watch)}`);
      continue;
    }
    if (!mandate || !mandate.allowedSymbols?.includes(watch.symbol)) {
      watch.wasPrimary = watch.priority === "primary";
      watch.status = "cancelled";
      watch.closedAt = nowIso();
      watch.closeReason = "授权变更，已不在白名单";
      invalidated.push(watch);
      changed = true;
      changedGroups.add(`${watch.symbol}\0${analysisGroup(watch)}`);
      continue;
    }
    const price = Number(prices.get(watch.symbol));
    if (!Number.isFinite(price)) continue; // 行情缺失：baseline 不动，下次成功时仍能检出穿越（迟到不漏）
    if (watch.lastPrice === null || watch.lastPrice === undefined) {
      // 暂停恢复后的重新定基：暂停期间价位已越过 → 作废并说明，避免基于过期结构触发
      if (conditionAlreadyTrue(watch, price)) {
        watch.wasPrimary = watch.priority === "primary";
        watch.status = "invalidated";
        watch.closedAt = nowIso();
        watch.closeReason = "系统暂停期间价位已越过条件，需重新评估";
        invalidated.push(watch);
        changed = true;
        changedGroups.add(`${watch.symbol}\0${analysisGroup(watch)}`);
      } else {
        watch.lastPrice = price;
      }
      continue;
    }
    if (crossed(watch, watch.lastPrice, price)) {
      watch.wasPrimary = watch.priority === "primary";
      watch.status = "triggered";
      watch.triggeredAt = nowIso();
      watch.triggerPrice = price;
      watch.triggerHandled = false;
      triggered.push(watch);
      changed = true;
      changedGroups.add(`${watch.symbol}\0${analysisGroup(watch)}`);
    } else {
      watch.lastPrice = price;
    }
  }
  for (const key of changedGroups) {
    const [symbol, groupId] = key.split("\0");
    normalizePrimaryWatch(db, symbol, groupId);
  }
  return { triggered, expired, invalidated, changed };
}

// 实时 WebSocket 与每分钟哨兵必须走同一条通知链。过去实时行情会先把观察哨
// 改成 triggered，却只写站内通知、没有写 Telegram outbox；分钟哨兵随后看见
// 它已经不再 active，因而永久漏推。把所有 sweep 后副作用集中到这里，避免两条
// 行情入口今后再次出现行为漂移。
export function publishWatchSweep(db, sweep = {}, options = {}) {
  const autoAnalyze = options.autoAnalyze === true;
  const actor = options.actor || "WatchSentinel";
  const realtime = options.realtime === true;
  const telegram = [];
  for (const watch of sweep.triggered || []) {
    if (realtime) watch.realtimeNotifiedAt = nowIso();
    appendAudit(db, `观察哨${realtime ? "实时" : ""}价格条件命中：${describeWatch(watch)}（触发价 ${watch.triggerPrice}；量能/收盘/形态待复核）`, watch.id, actor, "warning");
    createNotification(db, {
      eventType: "watch_trigger",
      severity: "warning",
      title: `${watch.symbol} · ${watchDirectionLabel(watch)}价格条件命中`,
      body: `确认状态：仅价格到位；量能、K线收盘、形态与盈亏比尚未确认。原判断：${watchThesis(watch)} 价格条件：${describeWatch(watch)}，触发价 ${watch.triggerPrice}。待复核含义：${watchTriggerMeaning(watch)} ${autoAnalyze ? "已进入 AI 复核队列。" : "自动复核当前关闭，请人工重新分析后再决策。"}`
    });
    telegram.push(queueWatchTelegramEvent(db, watch, "triggered", { autoAnalyze, triggerPrice: watch.triggerPrice }));
  }
  for (const watch of sweep.expired || []) {
    appendTrace(db, "watch_sentinel", `观察哨过期：${describeWatch(watch)}`, "ok");
    telegram.push(queueWatchTelegramEvent(db, watch, "expired"));
  }
  for (const watch of sweep.invalidated || []) {
    appendTrace(db, "watch_sentinel", `观察哨作废：${describeWatch(watch)}（${watch.closeReason}）`, "warning");
    createNotification(db, {
      eventType: "watch_invalidated",
      severity: "warning",
      title: `${watch.symbol} · 原${watchDirectionLabel(watch)}观察判断已失效`,
      body: `原判断：${watchThesis(watch)} 作废条件：${describeWatch(watch)}。原因：${watch.closeReason || "原场景已经失效"}。系统已停止盯这条条件，等待新的分析。`
    });
    telegram.push(queueWatchTelegramEvent(db, watch, watch.status === "cancelled" ? "cancelled" : "invalidated", { reason: watch.closeReason }));
  }
  return {
    triggered: (sweep.triggered || []).length,
    expired: (sweep.expired || []).length,
    invalidated: (sweep.invalidated || []).length,
    telegram
  };
}

// 无条件快速异动探测:不依赖 AI 事先挂哨——每分钟对授权币维护滚动价格缓冲,
// 若某币在回看窗内相对窗内高/低点急速异动超阈值,就生成一条待处理异动,唤起 AI 立即评估。
// (用户实锤:ADA 一小时跌 4%,系统靠 15 分钟定时巡检+空哨,没能及时反应。)
export const FAST_MOVE = {
  pct: Number(process.env.FAST_MOVE_PCT || 2.5),   // 阈值:窗内高→现价 或 低→现价 变动百分比
  lookbackMs: 15 * 60_000,                          // 回看窗 15 分钟
  minSampleAgeMs: 5 * 60_000,                       // 至少要有 5 分钟前的样本才判(否则还在预热)
  cooldownMs: 20 * 60_000,                          // 同币触发后冷却,避免持续行情里刷屏
  bufferMs: 20 * 60_000
};

export function detectFastMoves(db, prices, now = Date.now()) {
  db.system.priceBuffer ||= {};
  db.system.fastMoveCooldownAt ||= {};
  const events = [];
  for (const [symbol, price] of prices) {
    if (!Number.isFinite(price) || price <= 0) continue;
    const buf = (db.system.priceBuffer[symbol] || []).filter((s) => now - s.t <= FAST_MOVE.bufferMs);
    buf.push({ t: now, p: price });
    db.system.priceBuffer[symbol] = buf;
    const window = buf.filter((s) => now - s.t <= FAST_MOVE.lookbackMs);
    const oldest = window[0];
    if (!oldest || now - oldest.t < FAST_MOVE.minSampleAgeMs) continue; // 预热不足,不误报
    const high = Math.max(...window.map((s) => s.p));
    const low = Math.min(...window.map((s) => s.p));
    const dropPct = high > 0 ? ((high - price) / high) * 100 : 0;   // 自窗内高点下跌
    const risePct = low > 0 ? ((price - low) / low) * 100 : 0;      // 自窗内低点上涨
    const down = dropPct >= risePct;
    const movePct = down ? dropPct : risePct;
    if (movePct < FAST_MOVE.pct) continue;
    if (now - (db.system.fastMoveCooldownAt[symbol] || 0) < FAST_MOVE.cooldownMs) continue; // 冷却中
    db.system.fastMoveCooldownAt[symbol] = now;
    events.push({ symbol, direction: down ? "down" : "up", movePct: Number(movePct.toFixed(2)), price, refPrice: down ? high : low, windowMin: Math.round((now - oldest.t) / 60_000) });
  }
  return events;
}

// 哨兵触发的 LLM 巡检限频：每小时最多 N 次（超出的触发保持 pending，由下一轮定时巡检兜底处理）
export function sentinelCycleAllowed(db, now = Date.now()) {
  db.system.sentinelCycleAt = (db.system.sentinelCycleAt || []).filter((iso) => now - new Date(iso).getTime() < 3_600_000);
  return db.system.sentinelCycleAt.length < WATCH_LIMITS.maxTriggeredCyclesPerHour;
}

// WebSocket 发现机会/观察哨穿越后可直接调用；复用分钟哨兵相同的 autonomy、限频和任务锁。
// pending 事实由 agent_cycle 进入后消费，锁冲突或限频时仍保留，由后续定时任务兜底。
export async function requestPendingAgentCycle(db, saveDb, source = "sentinel") {
  const gate = sentinelGate(db.system);
  const watchPending = (db.watchTriggers || []).some((w) => w.status === "triggered" && !w.triggerHandled);
  const movePending = (db.system?.pendingFastMoves || []).length > 0;
  const opportunityPending = (db.system?.pendingOpportunitySignals || []).length > 0;
  const newsPending = (db.system?.pendingNewsSignals || []).length > 0;
  if (!(watchPending || movePending || opportunityPending || newsPending)) return { status: "nothing_pending" };
  if (!gate.autoAnalyze) return { status: "auto_analysis_disabled" };
  if ((db.tradePlans || []).some((plan) => plan.status === "awaiting_approval")) return { status: "decision_deferred_pending_approval" };
  if (!sentinelCycleAllowed(db)) return { status: "rate_limited" };
  const cycle = await runTask(db, "task_sys_agent_cycle", saveDb, source);
  // 只统计真正进入决策且成功返回的轮次。并发锁、任务失败和 patrol_only
  // 都没有消耗 LLM 分析额度，不能白白占用每小时上限。
  const output = String(cycle?.run?.output || "");
  const completedDecision = cycle?.run?.status === "ok" && !/patrol_only/i.test(output);
  if (completedDecision) db.system.sentinelCycleAt.push(nowIso());
  return cycle;
}

// 调度任务入口：每 1 分钟一跳
export async function runWatchSentinel(db, saveDb) {
  db.watchTriggers ||= [];
  const active = listActiveWatches(db);
  const mandate = activeMandate(db);
  const gate = sentinelGate(db.system);
  // 仅熔断才全停：清空基线待恢复后重新定基,避免基于熔断期(不连续行情)误触发。
  if (!gate.monitor) {
    for (const w of active) w.lastPrice = null;
    db.system.priceBuffer = {}; // 熔断期价格不连续,清空快速异动缓冲避免恢复后误判
    return { status: "paused", skipPersist: true };
  }
  // autonomy 关时仍照常盯盘/通知,只是触发后不自动唤起 AI(让用户自己来决策)。
  const autoAnalyze = gate.autoAnalyze;
  // 授权失效则无事可做
  if (!mandate?.allowedSymbols?.length && !active.length) return { status: "idle", skipPersist: true };

  // 无论有没有挂哨,都对授权币 + 已挂哨币拉现价——快速异动探测不依赖事先挂哨。
  const prices = new Map();
  const symbols = [...new Set([...active.map((w) => w.symbol), ...(mandate?.allowedSymbols || [])])].slice(0, 6);
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const ticker = await fetchTickerQuiet(symbol);
      if (Number.isFinite(Number(ticker?.price))) prices.set(symbol, Number(ticker.price));
    } catch { /* 该币本 tick 跳过，穿越语义保证不漏 */ }
  }));

  // 快速异动:窗内急速涨跌超阈值 → 生成待处理异动,注入下一轮巡检唤起 AI
  const fastMoves = detectFastMoves(db, prices);
  if (fastMoves.length) {
    db.system.pendingFastMoves = [...(db.system.pendingFastMoves || []), ...fastMoves.map((e) => ({ ...e, at: nowIso() }))].slice(-12);
    for (const e of fastMoves) {
      const dir = e.direction === "down" ? "快速下跌" : "快速上涨";
      appendAudit(db, `快速异动:${e.symbol} ${e.windowMin}分钟内${dir} ${e.movePct}%(现价 ${e.price})`, "fast_move", "WatchSentinel", "warning");
      createNotification(db, { eventType: "fast_move", severity: "warning", title: "快速异动", body: `${e.symbol} ${e.windowMin} 分钟内${dir} ${e.movePct}%${autoAnalyze ? "，已唤起 AI 交易员立即评估。" : "，请打开 App 让 AI 评估或自行处理（自动巡检当前关闭）。"}` });
    }
  }

  const result = sweepWatches(db, prices);
  publishWatchSweep(db, result, { autoAnalyze, actor: "WatchSentinel" });

  // 观察哨触发 或 快速异动 → 立即请求一轮完整巡检（同一任务、同一并发锁、同一风控链）。
  // 锁被占 / 限频超额时不丢：哨保持 pending / 异动留在 pendingFastMoves，下一 tick 或定时巡检兜底。
  // 触发/异动后的"自动唤起 AI 完整巡检(可能自动下单)"——这才是 autonomy 该管的动作。
  // autonomy 关时:哨已触发、用户已收到通知,但不自动唤起 AI;待处理的哨/异动留 pending,
  // 用户开 App 或打开自主巡检后由下一轮兜底消费,不丢。
  let cycle = null;
  const opportunityPending = (db.system.pendingOpportunitySignals || []).length > 0;
  if (autoAnalyze) cycle = await requestPendingAgentCycle(db, saveDb, "sentinel");
  const changed = result.changed || fastMoves.length > 0;
  return {
    status: fastMoves.length ? "fast_move" : result.triggered.length ? "triggered" : opportunityPending ? "opportunity_pending" : "watched",
    watched: active.length,
    triggered: result.triggered.map((w) => describeWatch(w)),
    fastMoves: fastMoves.map((e) => `${e.symbol} ${e.direction === "down" ? "-" : "+"}${e.movePct}%`),
    expired: result.expired.length,
    cycle: cycle?.status || null,
    skipPersist: !changed
  };
}
