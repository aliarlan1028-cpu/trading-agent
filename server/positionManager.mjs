import { executeTradeAction } from "./tradeActions.mjs";
import { syncPublicMarket } from "./exchangeConnector.mjs";
import { notifyLarkThrottled } from "./larkNotifier.mjs";
import { publishProfitablePositionPosters } from "./telegramNotifier.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const TRAIL_PCT = Math.max(0.001, Number(process.env.TRAIL_PCT || 0.012));            // 跟踪止损距离(默认 1.2%)
const TRAIL_ACTIVATE_PCT = Math.max(0, Number(process.env.TRAIL_ACTIVATE_PCT || 1.5)) / 100; // 盈利达此(默认 1.5%)即启动追踪(freqtrade trailing_stop_positive)

async function moveStopTo(db, position, newStop, label) {
  const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
  const result = await executeTradeAction(db, "move_stop", {
    exchange: executionOrder?.exchange || "OKX",
    marketType: "perpetual_usdt",
    symbol: position.symbol,
    stopPrice: newStop,
    quantity: position.size,
    reduceOnly: true,
    agentRunId: executionOrder?.agentRunId,
    analysisBundleId: executionOrder?.analysisBundleId,
    tradePlanId: executionOrder?.planId,
    riskCheckId: executionOrder?.riskCheckId,
    mandateId: executionOrder?.mandateId,
    manualApproval: true
  });
  return result;
}

// ---------------------------------------------------------------------------
// 持仓管理循环：刷新标记价、TP1 触达后移动止损到保本、风险告警。
// 由调度器周期驱动；所有真实写操作仍经 tradeActions 安全闸。
// ---------------------------------------------------------------------------

export async function monitorPositions(db) {
  const managed = (db.positions || []).filter((position) => position.source === "execution_engine");
  const actions = [];

  for (const position of managed) {
    try {
      // 优先用实时 WS 价（marketStream 持续更新 db.markets）；无实时价时才回退 REST。
      let market = db.markets?.find((item) => item.symbol === position.symbol);
      let mark = Number(market?.price);
      if (!Number.isFinite(mark)) {
        await syncPublicMarket(db, "OKX", position.symbol).catch(() => {});
        market = db.markets?.find((item) => item.symbol === position.symbol);
        mark = Number(market?.price);
      }
      if (!Number.isFinite(mark)) continue;
      position.mark = mark;
      updateExcursion(db, position, mark);

      // 强平距离盯盘(交易员命门):杠杆永续在两次巡检之间就可能触及强平。逼近 → 严重告警 + 建议减仓/加保证金。
      const liqPx = Number(position.liqPx ?? position.liquidationPrice);
      if (Number.isFinite(liqPx) && liqPx > 0) {
        const liqDistPct = Math.abs(mark - liqPx) / mark * 100;
        const liqThreshold = Number(process.env.LIQ_DISTANCE_ALERT_PCT || 8);
        position.liqDistancePct = Number(liqDistPct.toFixed(2));
        if (liqDistPct < liqThreshold) {
          raiseIncident(db, position, "critical", `${position.symbol} 逼近强平：现价 ${mark} 距强平 ${liqPx} 仅 ${liqDistPct.toFixed(1)}%（<${liqThreshold}%），建议立即减仓或加保证金`);
          await notifyLarkThrottled(db, `liq_near:${position.id}`, 10 * 60 * 1000, {
            severity: "critical",
            title: "🚨 持仓逼近强平",
            body: `**${position.symbol}** ${position.direction || ""} 现价距强平仅 **${liqDistPct.toFixed(1)}%**，请立即减仓或加保证金。`,
            fields: [{ label: "标记价", value: String(mark) }, { label: "强平价", value: String(liqPx) }]
          });
          actions.push({ symbol: position.symbol, action: "near_liquidation_alert", liqDistancePct: position.liqDistancePct });
        }
      }

      // 持仓论点重评:开仓后不能只盯价格——资金费转为强烈不利、或出现高可信度反向即时新闻,
      // 说明"当初开仓的逻辑可能已变",提示复核/减仓(只建议+告警,不自动平)。
      {
        const base = String(position.symbol).split(/[/-]/)[0].toUpperCase();
        const isShort = position.direction === "空" || position.direction === "short";
        const funding = Number(market?.fundingRate);
        const fundingAgainst = Number.isFinite(funding) && Math.abs(funding) > 0.05 && ((isShort && funding < -0.05) || (!isShort && funding > 0.05));
        const news = (db.events || []).find((e) => {
          const it = e.intel; if (!it || it.fakeRisk === "high") return false;
          const hits = (it.affectedSymbols || []).some((s) => { const u = String(s).toUpperCase(); return u.includes(base) || base.includes(u); });
          const against = isShort ? it.sentiment === "利多" : it.sentiment === "利空";
          return hits && against && /即时|数小时/.test(it.impactHorizon || "") && (it.credibility || 0) >= 0.6;
        });
        if ((fundingAgainst || news) && !position.thesisFlaggedAt) {
          position.thesisFlaggedAt = nowIso();
          const why = [fundingAgainst ? `资金费 ${funding}% 强烈不利于当前方向(拥挤/反向挤压)` : "", news ? `反向新闻：${news.intel.oneLine || news.title}` : ""].filter(Boolean).join("；");
          raiseIncident(db, position, "high", `${position.symbol} 开仓论点可能已变化，建议复核/减仓：${why}`);
          await notifyLarkThrottled(db, `thesis:${position.id}`, 30 * 60 * 1000, { severity: "warning", title: "🔎 持仓论点复核", body: `**${position.symbol}** ${position.direction || ""} 开仓逻辑出现反向信号，建议复核是否减仓。\n${why}` });
          actions.push({ symbol: position.symbol, action: "thesis_review", why });
        }
        if (!fundingAgainst && !news) position.thesisFlaggedAt = null;
      }

      if (!position.stopLoss) {
        raiseIncident(db, position, "critical", `${position.symbol} 持仓缺少止损，必须立即补挂`);
        await notifyLarkThrottled(db, `missing_stop:${position.id}`, 30 * 60 * 1000, {
          severity: "critical",
          title: "⚠️ 持仓缺少止损",
          body: `**${position.symbol}** 当前持仓没有止损，风险敞口不受控，请立即补挂。`,
          fields: [{ label: "标记价", value: String(mark) }, { label: "方向", value: position.direction || "-" }]
        });
        actions.push({ symbol: position.symbol, action: "missing_stop_alert" });
        continue;
      }

      const isShort = position.direction === "空" || position.direction === "short";
      const entry = Number(position.entry);
      const stop = Number(position.stopLoss);
      const tp1 = Number((position.takeProfits || [])[0]);

      // TP1 触达且止损仍劣于保本 → 移动止损到保本价
      const tp1Reached = Number.isFinite(tp1) && (isShort ? mark <= tp1 : mark >= tp1);
      const stopBelowBreakeven = isShort ? stop > entry : stop < entry;
      if (tp1Reached && stopBelowBreakeven && !position.breakevenMoved) {
        const result = await moveStopTo(db, position, entry, "breakeven");
        if (result.status === "blocked") {
          // 实盘关闭或闸门拦截：记录建议而不是假装已移动
          appendAudit(db, `建议移动止损到保本 ${entry}（${result.reason}）`, position.id, "PositionManager", "warning");
          actions.push({ symbol: position.symbol, action: "breakeven_recommended", reason: result.reason });
        } else {
          position.stopLoss = entry;
          position.breakevenMoved = true;
          appendAudit(db, `TP1 触达，止损已移动到保本 ${entry}`, position.id, "PositionManager");
          appendTrace(db, "position_manager", `${position.symbol} 止损移动到保本`, "ok");
          await notifyLarkThrottled(db, `breakeven:${position.id}`, 60 * 60 * 1000, {
            severity: "success",
            title: "✅ 已移动止损到保本",
            body: `**${position.symbol}** 触达 TP1，止损已上移到保本价，本单已无亏损风险。`,
            fields: [{ label: "保本价", value: String(entry) }, { label: "标记价", value: String(mark) }]
          });
          actions.push({ symbol: position.symbol, action: "breakeven_moved" });
        }
      }

      // 跟踪止损:盈利达激活阈值(默认 1.5%)即启动,不必等 TP1(freqtrade trailing_stop_positive)。
      // 之后随盈利推进只进不退;stillProfitable 保证永不把止损移进亏损区,只锁真实利润。
      const profitPct = entry > 0 ? (isShort ? (entry - mark) / entry : (mark - entry) / entry) : 0;
      if (position.breakevenMoved || position.trailingActive || profitPct >= TRAIL_ACTIVATE_PCT) {
        const trailStop = isShort ? mark * (1 + TRAIL_PCT) : mark * (1 - TRAIL_PCT);
        const improves = isShort ? trailStop < Number(position.stopLoss) : trailStop > Number(position.stopLoss);
        const stillProfitable = isShort ? trailStop < entry : trailStop > entry;
        if (improves && stillProfitable) {
          const rounded = Number(trailStop.toFixed(mark > 1000 ? 1 : mark > 1 ? 3 : 5));
          const result = await moveStopTo(db, position, rounded, "trailing");
          if (result.status !== "blocked") {
            position.stopLoss = rounded;
            position.trailingActive = true;
            appendAudit(db, `跟踪止损上移到 ${rounded}`, position.id, "PositionManager");
            appendTrace(db, "position_manager", `${position.symbol} 跟踪止损 ${rounded}`, "ok");
            actions.push({ symbol: position.symbol, action: "trailing_moved", stop: rounded });
          } else {
            actions.push({ symbol: position.symbol, action: "trailing_recommended", stop: rounded, reason: result.reason });
          }
        }
      }

      // 止损距离告警：价格距止损 < 0.3% 时提示
      const stopDistancePct = Math.abs((mark - Number(position.stopLoss)) / mark) * 100;
      if (stopDistancePct < 0.3 && !position.nearStopAlerted) {
        position.nearStopAlerted = true;
        raiseIncident(db, position, "high", `${position.symbol} 价格距止损仅 ${stopDistancePct.toFixed(2)}%，可能即将触发`);
        await notifyLarkThrottled(db, `near_stop:${position.id}`, 20 * 60 * 1000, {
          severity: "warning",
          title: "🔔 价格逼近止损",
          body: `**${position.symbol}** 标记价距止损仅 ${stopDistancePct.toFixed(2)}%，可能即将触发止损离场。`,
          fields: [{ label: "标记价", value: String(mark) }, { label: "止损", value: String(position.stopLoss) }]
        });
        actions.push({ symbol: position.symbol, action: "near_stop_alert" });
      }
      if (stopDistancePct >= 0.5) position.nearStopAlerted = false;

      position.monitoredAt = nowIso();
    } catch (error) {
      actions.push({ symbol: position.symbol, action: "monitor_error", error: error.message });
    }
  }

  const posterResult = await publishProfitablePositionPosters(db);
  actions.push(...posterResult.actions);

  return { monitored: managed.length, actions };
}

function updateExcursion(db, position, mark) {
  const entry = Number(position.entry);
  const size = Number(position.size);
  if (!Number.isFinite(entry) || !Number.isFinite(size)) return;
  const isShort = position.direction === "空" || position.direction === "short";
  const sign = isShort ? -1 : 1;
  const unrealized = (Number(mark) - entry) * size * sign;
  position.maeUsdt = Math.min(Number(position.maeUsdt || 0), Number(unrealized.toFixed(2)));
  position.mfeUsdt = Math.max(Number(position.mfeUsdt || 0), Number(unrealized.toFixed(2)));
  const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
  if (executionOrder) {
    executionOrder.lastMark = Number(mark);
    executionOrder.maeUsdt = Math.min(Number(executionOrder.maeUsdt || 0), position.maeUsdt);
    executionOrder.mfeUsdt = Math.max(Number(executionOrder.mfeUsdt || 0), position.mfeUsdt);
  }
}

function raiseIncident(db, position, severity, title) {
  const existing = (db.riskIncidents || []).find((item) => item.status === "open" && item.title === title);
  if (existing) return;
  db.riskIncidents.unshift({
    id: id("incident"),
    severity,
    status: "open",
    title,
    source: position.id,
    createdAt: nowIso()
  });
  appendAudit(db, title, position.id, "PositionManager", severity === "critical" ? "critical" : "warning");
}
