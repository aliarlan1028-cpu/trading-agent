import { executeTradeAction } from "./tradeActions.mjs";
import { syncPublicMarket } from "./exchangeConnector.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 持仓管理循环：刷新标记价、TP1 触达后移动止损到保本、风险告警。
// 由调度器周期驱动；所有真实写操作仍经 tradeActions 安全闸。
// ---------------------------------------------------------------------------

export async function monitorPositions(db) {
  const managed = (db.positions || []).filter((position) => position.source === "execution_engine");
  const actions = [];

  for (const position of managed) {
    try {
      await syncPublicMarket(db, "OKX", position.symbol).catch(() => {});
      const market = db.markets?.find((item) => item.symbol === position.symbol);
      const mark = Number(market?.price);
      if (!Number.isFinite(mark)) continue;
      position.mark = mark;

      if (!position.stopLoss) {
        raiseIncident(db, position, "critical", `${position.symbol} 持仓缺少止损，必须立即补挂`);
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
        const executionOrder = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
        const result = await executeTradeAction(db, "move_stop", {
          exchange: executionOrder?.exchange || "OKX",
          marketType: "perpetual_usdt",
          symbol: position.symbol,
          stopPrice: entry,
          quantity: position.size,
          reduceOnly: true,
          agentRunId: executionOrder?.agentRunId,
          analysisBundleId: executionOrder?.analysisBundleId,
          tradePlanId: executionOrder?.planId,
          riskCheckId: executionOrder?.riskCheckId,
          mandateId: executionOrder?.mandateId,
          manualApproval: true
        });
        if (result.status === "blocked") {
          // 实盘关闭或闸门拦截：记录建议而不是假装已移动
          appendAudit(db, `建议移动止损到保本 ${entry}（${result.reason}）`, position.id, "PositionManager", "warning");
          actions.push({ symbol: position.symbol, action: "breakeven_recommended", reason: result.reason });
        } else {
          position.stopLoss = entry;
          position.breakevenMoved = true;
          appendAudit(db, `TP1 触达，止损已移动到保本 ${entry}`, position.id, "PositionManager");
          appendTrace(db, "position_manager", `${position.symbol} 止损移动到保本`, "ok");
          actions.push({ symbol: position.symbol, action: "breakeven_moved" });
        }
      }

      // 止损距离告警：价格距止损 < 0.3% 时提示
      const stopDistancePct = Math.abs((mark - stop) / mark) * 100;
      if (stopDistancePct < 0.3 && !position.nearStopAlerted) {
        position.nearStopAlerted = true;
        raiseIncident(db, position, "high", `${position.symbol} 价格距止损仅 ${stopDistancePct.toFixed(2)}%，可能即将触发`);
        actions.push({ symbol: position.symbol, action: "near_stop_alert" });
      }
      if (stopDistancePct >= 0.5) position.nearStopAlerted = false;

      position.monitoredAt = nowIso();
    } catch (error) {
      actions.push({ symbol: position.symbol, action: "monitor_error", error: error.message });
    }
  }

  return { monitored: managed.length, actions };
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
