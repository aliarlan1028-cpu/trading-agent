const NON_CURRENT = /^\s*(?:[-*>#\d.]+\s*)?(?:历史|曾经|当时|复盘|假设|如果|若|计划在|预计|预测|可能|候选|等待.+后)/i;

function symbolForLine(line, facts = {}, activeSymbol = null) {
  for (const symbol of Object.keys(facts)) {
    const base = symbol.split("/")[0];
    if (new RegExp(`\\b${base}(?:/USDT|-USDT(?:-SWAP)?|USDT)?\\b`, "i").test(line)) return symbol;
  }
  if (/\b[A-Z0-9]{2,12}(?:\/USDT|-USDT(?:-SWAP)?|USDT)\b/i.test(line)) return null;
  if (activeSymbol) return activeSymbol;
  return Object.keys(facts).length === 1 ? Object.keys(facts)[0] : null;
}

function normalizeBias(value) {
  const text = String(value || "").toUpperCase();
  if (["LONG", "做多"].includes(text)) return "LONG";
  if (["SHORT", "做空"].includes(text)) return "SHORT";
  if (["NEUTRAL", "中性"].includes(text)) return "NEUTRAL";
  return text;
}

function normalizeAlignment(value) {
  const text = String(value || "").toLowerCase();
  if (["aligned", "一致"].includes(text)) return "aligned";
  if (["conflict", "冲突"].includes(text)) return "conflict";
  if (["mixed", "混合"].includes(text)) return "mixed";
  return text;
}

function statusLabel(status) {
  const labels = {
    armed: "条件计划已武装，尚未向 OKX 下单",
    awaiting_approval: "计划等待人工批准，尚未向 OKX 下单",
    risk_rejected: "计划已被硬风控拒绝，未下单",
    auto_blocked: "计划被自动执行闸门阻断，未下单",
    approved: "计划已批准，是否下单仍以真实执行单为准",
    executing: "计划已进入执行链，订单/成交状态以真实执行回执为准",
    completed: "计划已完成"
  };
  return labels[status] || `计划真实状态为 ${status || "unknown"}`;
}

function structureCorrection(symbol, fact) {
  if (!fact) return `**真实性守卫**：${symbol || "该交易对"} 的确定性结构无法确认（本轮没有成功的 analyze_market_structure 回执）。`;
  return `**真实性守卫**：${symbol} 确定性结构为 ${fact.bias || "无法确认"}，周期对齐=${fact.alignment || "无法确认"}（${fact.evidenceRef || "structure evidence missing"}）。`;
}

function eventMatches(frame, kind, direction, level) {
  if (!frame?.available) return false;
  const events = [frame.latestEvent, ...(frame.recentEvents || [])].filter(Boolean);
  return events.some((event) => {
    if (String(event.kind || "").toUpperCase() !== String(kind || "").toUpperCase()) return false;
    if (String(event.direction || "").toLowerCase() !== String(direction || "").toLowerCase()) return false;
    const actual = Number(event.level), claimed = Number(level);
    return Number.isFinite(actual) && Number.isFinite(claimed)
      && Math.abs(actual - claimed) <= Math.max(1e-8, Math.abs(actual) * 0.0005);
  });
}

function eventCorrection(symbol, timeframe, frame, fact) {
  if (!frame?.available) return `**真实性守卫**：${symbol} ${timeframe} 结构事件无法确认（${fact?.evidenceRef || "structure evidence missing"}）。`;
  const event = frame.latestEvent;
  return event
    ? `**真实性守卫**：${symbol} ${timeframe} 最近可核验结构事件为 ${event.kind} ${event.direction} @ ${event.level}（${fact.evidenceRef}）。`
    : `**真实性守卫**：${symbol} ${timeframe} 当前没有可核验的结构突破事件（${fact.evidenceRef}）。`;
}

function currentPlanState(db, run) {
  const plan = (db.tradePlans || []).find((item) => item.id === run.tradePlanId) || null;
  const order = plan ? (db.executionOrders || []).find((item) => item.id === plan.executionOrderId || item.planId === plan.id || item.tradePlanId === plan.id) || null : null;
  const entryFills = plan ? (db.fills || []).filter((item) => item.kind === "entry"
    && (item.tradePlanId === plan.id || item.planId === plan.id || (order && item.executionOrderId === order.id))) : [];
  const position = plan ? (db.positions || []).find((item) => item.tradePlanId === plan.id || (order && item.executionOrderId === order.id)) || null : null;
  const filled = entryFills.length > 0 || Boolean(position)
    || ["entry_filled", "protecting", "closed"].includes(String(order?.status || ""));
  return { plan, order, filled };
}

function isPositivePlanClaim(line) {
  if (/(?:未|尚未|没有|无法|禁止|不应|不会).{0,8}(?:创建|生成|提交|建立|武装).{0,12}(?:交易)?计划/i.test(line)) return false;
  return /(?:已|已经|成功).{0,20}(?:创建|生成|提交|建立|武装).{0,16}(?:交易)?计划|(?:交易)?计划.{0,12}(?:已|已经)(?:创建|生成|提交|建立|武装)/i.test(line);
}

function isPositiveOrderClaim(line) {
  if (/(?:未|尚未|没有|无法|禁止|不应|不会|等待|如果|若).{0,12}(?:下单|成交|开仓|建仓|进场)/i.test(line)) return false;
  if (/(?:只有|才算|例如|定义|指的是|不等于|区别|当.+时|模式下)/i.test(line)) return false;
  return /^\s*(?:[-*]\s*)?(?:(?:状态|执行|动作)[:：]\s*)?(?:已|已经|成功)(?:向\s*OKX\s*)?.{0,10}(?:下单|提交订单|成交|开仓|建仓|进场)|^\s*(?:[-*]\s*)?(?:订单|委托).{0,10}(?:(?:已|已经)(?:提交|成交))|(?:本轮|当前|这笔|该订单).{0,16}(?:已下单|已成交|已开仓|已建仓|持仓中)|^\s*(?:[-*]\s*)?(?:当前)?持仓中/i.test(line);
}

function successfulReceipt(run, name) {
  return (run.toolReceipts || []).find((receipt) => receipt.name === name
    && !receipt.result?.error
    && !["blocked", "failed", "error"].includes(String(receipt.result?.status || "").toLowerCase())) || null;
}

const VERIFIED_ACTION_CLAIMS = Object.freeze([
  { name: "create_skill_from_idea", pattern: /(?:已|已经|成功).{0,16}(?:创建|生成|保存).{0,12}(?:策略工作室)?(?:策略)?草稿/i, label: "策略工作室草稿" },
  { name: "create_mandate_draft", pattern: /(?:已|已经|成功).{0,16}(?:创建|生成|保存).{0,12}(?:授权|Mandate).{0,8}草案/i, label: "授权草案" },
  { name: "create_task", pattern: /(?:已|已经|成功).{0,16}(?:创建|登记|安排).{0,12}(?:定时|计划)?任务/i, label: "定时任务" },
  { name: "remember", pattern: /(?:已|已经|成功).{0,16}(?:写入|记录|保存).{0,12}(?:长期)?记忆/i, label: "记忆" },
  { name: "resolve_risk_incidents", pattern: /(?:已|已经|成功).{0,16}(?:关闭|解决|标记).{0,12}(?:风险)?事件/i, label: "风险事件处理" }
]);

/**
 * Hard-check high-impact qualitative and operational claims that numeric evidence
 * guards cannot cover. It never tries to validate free-form investment judgment;
 * it only validates statements with an authoritative deterministic source.
 */
export function enforceVerifiedOutput({ db = {}, run = {}, content = "" } = {}) {
  const facts = run.structureFacts || {};
  const state = currentPlanState(db, run);
  const violations = [];
  const output = [];
  let activeSymbol = null;
  let planCorrectionAdded = false;
  let orderCorrectionAdded = false;

  for (const original of String(content || "").split("\n")) {
    let line = original;
    const explicitSymbol = symbolForLine(line, facts, null);
    if (explicitSymbol) activeSymbol = explicitSymbol;
    else if (/\b[A-Z0-9]{2,12}(?:\/USDT|-USDT(?:-SWAP)?|USDT)\b/i.test(line)) activeSymbol = null;
    const symbol = symbolForLine(line, facts, activeSymbol);
    if (NON_CURRENT.test(line)) {
      output.push(line);
      continue;
    }

    const fact = symbol ? facts[symbol] : null;
    const bias = line.match(/确定性(?:多周期)?结构(?:事实|偏向)?\s*(?:为|[:：=])?\s*(LONG|SHORT|NEUTRAL|做多|做空|中性)/i);
    const alignment = line.match(/(?:多周期|周期)?对齐\s*(?:为|[:：=])?\s*(aligned|conflict|mixed|一致|冲突|混合)/i);
    if ((bias && normalizeBias(bias[1]) !== normalizeBias(fact?.bias))
      || (alignment && normalizeAlignment(alignment[1]) !== normalizeAlignment(fact?.alignment))) {
      violations.push({ type: "deterministic_structure_mismatch", symbol, claim: original.slice(0, 240), evidenceRef: fact?.evidenceRef || null });
      output.push(structureCorrection(symbol, fact));
      continue;
    }

    const event = line.match(/\b(1d|4h|1h|15m|5m)\s*(BOS|CHoCH|STRUCTURE_BREAK)\s*(up|down)\s*@\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (event && !eventMatches(fact?.frames?.[event[1].toLowerCase()], event[2], event[3], event[4])) {
      violations.push({ type: "deterministic_event_mismatch", symbol, timeframe: event[1].toLowerCase(), claim: original.slice(0, 240), evidenceRef: fact?.evidenceRef || null });
      output.push(eventCorrection(symbol, event[1], fact?.frames?.[event[1].toLowerCase()], fact));
      continue;
    }

    const positivePlanClaim = isPositivePlanClaim(line);
    if (positivePlanClaim && !state.plan) {
      violations.push({ type: "unbacked_plan_claim", claim: original.slice(0, 240) });
      if (!planCorrectionAdded) output.push("**真实性守卫**：本轮没有生成真实交易计划（无 tradePlanId），因此不能声称计划已创建、提交或武装。");
      planCorrectionAdded = true;
      continue;
    }
    const currentApprovalClaim = (positivePlanClaim && /等待人工批准|待人工批准/i.test(line))
      || /(?:本轮|当前|这笔|该(?:交易)?计划|计划状态|状态[:：]|^\s*(?:[-*]\s*)?计划).{0,20}(?:等待人工批准|待人工批准)/i.test(line);
    if (currentApprovalClaim && state.plan?.status !== "awaiting_approval") {
      violations.push({ type: "plan_status_mismatch", claim: original.slice(0, 240), actual: state.plan?.status || null });
      output.push(`**真实性守卫**：${statusLabel(state.plan?.status)}（计划 ${state.plan?.id || "missing"}）。`);
      continue;
    }
    if (isPositiveOrderClaim(line)) {
      const claimsFill = /成交|开仓|建仓|进场|持仓中/i.test(line);
      const backed = claimsFill ? state.filled : Boolean(state.order);
      if (!backed) {
        violations.push({ type: claimsFill ? "unbacked_fill_claim" : "unbacked_order_claim", claim: original.slice(0, 240), planId: state.plan?.id || null });
        if (!orderCorrectionAdded) {
          output.push(`**真实性守卫**：${state.plan ? `${statusLabel(state.plan.status)}；` : "本轮无真实交易计划；"}未发现可核验的${claimsFill ? "成交/持仓" : "OKX 执行单"}回执，不能声称已${claimsFill ? "成交或开仓" : "下单"}。`);
        }
        orderCorrectionAdded = true;
        continue;
      }
    }
    const actionClaim = VERIFIED_ACTION_CLAIMS.find((claim) => claim.pattern.test(line));
    if (actionClaim && !successfulReceipt(run, actionClaim.name)) {
      violations.push({ type: "unbacked_tool_action_claim", tool: actionClaim.name, claim: original.slice(0, 240) });
      output.push(`**真实性守卫**：本轮没有 ${actionClaim.name} 的成功工具回执，不能声称已完成${actionClaim.label}操作。`);
      continue;
    }
    output.push(line);
  }

  return {
    text: output.join("\n").trim(),
    corrected: violations.length > 0,
    violations,
    structureEvidenceRefs: [...new Set(Object.values(facts).map((fact) => fact?.evidenceRef).filter(Boolean))]
  };
}

export function appendTruthAuditText(content, audit = {}, language = "zh") {
  if (!audit.enabled) return String(content || "").trim();
  const evidence = audit.evidenceBundleId || (language === "en" ? "unavailable" : "无法确认");
  const structures = Number(audit.structureEvidenceCount || 0);
  const receipts = Number(audit.toolReceiptCount || 0);
  const corrections = Number(audit.correctionCount || 0);
  const line = language === "en"
    ? `Truth check: evidence bundle ${evidence} · deterministic structure ${structures} · real tool receipts ${receipts} · corrected unsupported key claims ${corrections}. Inferences are analysis, not exchange facts.`
    : `真实性校验：证据包 ${evidence} · 确定性结构 ${structures} 项 · 真实工具回执 ${receipts} 次 · 自动纠正无依据关键陈述 ${corrections} 条。推断属于分析判断，不冒充交易所事实。`;
  return `${String(content || "").trim()}\n\n${line}`;
}
