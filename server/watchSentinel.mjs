import { fetchTickerQuiet } from "./exchangeConnector.mjs";
import { createNotification } from "./notificationStore.mjs";
import { runTask } from "./scheduler.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";

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

export function describeWatch(watch) {
  const fmt = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (watch.kind === "price_above") return `${watch.symbol} 向上突破 ${fmt(watch.level)}`;
  if (watch.kind === "price_below") return `${watch.symbol} 向下跌破 ${fmt(watch.level)}`;
  return `${watch.symbol} 回踩进入 ${fmt(watch.levelLow)}-${fmt(watch.levelHigh)} 区间`;
}

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
    status: "active",
    createdAt: nowIso(),
    createdBy: actor,
    lastPrice: price,
    priceAtCreation: price
  };
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
  const twin = db.watchTriggers.find((w) => w.status === "active" && w.symbol === symbol && w.kind === kind
    && Math.abs(((kind === "enter_zone" ? w.levelLow : w.level) - (kind === "enter_zone" ? watch.levelLow : watch.level)) / price) * 100 <= WATCH_LIMITS.upsertTolerancePct);
  if (twin) {
    twin.note = watch.note || twin.note;
    twin.expiresAt = watch.expiresAt;
    twin.level = watch.level;
    twin.levelLow = watch.levelLow;
    twin.levelHigh = watch.levelHigh;
    appendAudit(db, `观察哨更新：${describeWatch(twin)}`, twin.id, actor);
    return { ok: true, watch: twin, updated: true };
  }

  const active = listActiveWatches(db);
  if (active.length >= WATCH_LIMITS.maxActive) {
    return { ok: false, error: `活跃观察哨已达上限 ${WATCH_LIMITS.maxActive} 个，请先用 cancel_watch 撤掉不再需要的哨。当前：${active.map(describeWatch).join("；")}` };
  }
  if (active.filter((w) => w.symbol === symbol).length >= WATCH_LIMITS.maxPerSymbol) {
    return { ok: false, error: `${symbol} 的观察哨已达上限 ${WATCH_LIMITS.maxPerSymbol} 个，请先撤掉一个。` };
  }

  db.watchTriggers.unshift(watch);
  if (db.watchTriggers.length > 100) db.watchTriggers = db.watchTriggers.slice(0, 100);
  appendAudit(db, `观察哨登记：${describeWatch(watch)}（现价 ${price}）`, watch.id, actor);
  return { ok: true, watch };
}

export function cancelWatch(db, watchId, actor = "AI 交易员", reason = "") {
  const watch = (db.watchTriggers || []).find((w) => w.id === watchId && w.status === "active");
  if (!watch) return { ok: false, error: "未找到该活跃观察哨（可能已触发/过期/撤销）。" };
  watch.status = "cancelled";
  watch.closedAt = nowIso();
  watch.closeReason = reason || "手动撤销";
  appendAudit(db, `观察哨撤销：${describeWatch(watch)}${reason ? `（${reason}）` : ""}`, watch.id, actor);
  return { ok: true, watch };
}

// 巡检消费触发的哨：返回未处理的已触发哨并标记已处理（LLM 巡检和 patrol_only 都要调）
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
  for (const watch of listActiveWatches(db)) {
    if (new Date(watch.expiresAt).getTime() <= now) {
      watch.status = "expired";
      watch.closedAt = nowIso();
      expired.push(watch);
      changed = true;
      continue;
    }
    if (!mandate || !mandate.allowedSymbols?.includes(watch.symbol)) {
      watch.status = "cancelled";
      watch.closedAt = nowIso();
      watch.closeReason = "授权变更，已不在白名单";
      invalidated.push(watch);
      changed = true;
      continue;
    }
    const price = Number(prices.get(watch.symbol));
    if (!Number.isFinite(price)) continue; // 行情缺失：baseline 不动，下次成功时仍能检出穿越（迟到不漏）
    if (watch.lastPrice === null || watch.lastPrice === undefined) {
      // 暂停恢复后的重新定基：暂停期间价位已越过 → 作废并说明，避免基于过期结构触发
      if (conditionAlreadyTrue(watch, price)) {
        watch.status = "invalidated";
        watch.closedAt = nowIso();
        watch.closeReason = "系统暂停期间价位已越过条件，需重新评估";
        invalidated.push(watch);
        changed = true;
      } else {
        watch.lastPrice = price;
      }
      continue;
    }
    if (crossed(watch, watch.lastPrice, price)) {
      watch.status = "triggered";
      watch.triggeredAt = nowIso();
      watch.triggerPrice = price;
      watch.triggerHandled = false;
      triggered.push(watch);
      changed = true;
    } else {
      watch.lastPrice = price;
    }
  }
  return { triggered, expired, invalidated, changed };
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

// 调度任务入口：每 1 分钟一跳
export async function runWatchSentinel(db, saveDb) {
  db.watchTriggers ||= [];
  const active = listActiveWatches(db);
  const mandate = activeMandate(db);
  // 系统暂停/熔断：不评估（避免基于暂停期行情触发），清空基线待恢复后重新定基
  if (!db.system.autonomyEnabled || db.system.killSwitch) {
    for (const w of active) w.lastPrice = null;
    db.system.priceBuffer = {}; // 暂停期价格不连续,清空快速异动缓冲避免恢复后误判
    return { status: "paused", skipPersist: true };
  }
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
      createNotification(db, { eventType: "fast_move", severity: "warning", title: "快速异动", body: `${e.symbol} ${e.windowMin} 分钟内${dir} ${e.movePct}%，已唤起 AI 交易员立即评估。` });
    }
  }

  const result = sweepWatches(db, prices);
  for (const w of result.triggered) {
    appendAudit(db, `观察哨触发：${describeWatch(w)}（触发价 ${w.triggerPrice}）`, w.id, "WatchSentinel");
    createNotification(db, { eventType: "watch_trigger", severity: "warning", title: "观察哨触发", body: `${describeWatch(w)}，触发价 ${w.triggerPrice}。已请求 AI 交易员立即评估。` });
  }
  for (const w of result.expired) appendTrace(db, "watch_sentinel", `观察哨过期：${describeWatch(w)}`, "ok");
  for (const w of result.invalidated) appendTrace(db, "watch_sentinel", `观察哨作废：${describeWatch(w)}（${w.closeReason}）`, "warning");

  // 观察哨触发 或 快速异动 → 立即请求一轮完整巡检（同一任务、同一并发锁、同一风控链）。
  // 锁被占 / 限频超额时不丢：哨保持 pending / 异动留在 pendingFastMoves，下一 tick 或定时巡检兜底。
  let cycle = null;
  const watchPending = (db.watchTriggers || []).some((w) => w.status === "triggered" && !w.triggerHandled);
  const movePending = (db.system.pendingFastMoves || []).length > 0;
  if ((watchPending || movePending) && sentinelCycleAllowed(db)) {
    db.system.sentinelCycleAt.push(nowIso());
    cycle = await runTask(db, "task_sys_agent_cycle", saveDb, "sentinel");
  }
  const changed = result.changed || fastMoves.length > 0;
  return {
    status: fastMoves.length ? "fast_move" : result.triggered.length ? "triggered" : "watched",
    watched: active.length,
    triggered: result.triggered.map((w) => describeWatch(w)),
    fastMoves: fastMoves.map((e) => `${e.symbol} ${e.direction === "down" ? "-" : "+"}${e.movePct}%`),
    expired: result.expired.length,
    cycle: cycle?.status || null,
    skipPersist: !changed
  };
}
