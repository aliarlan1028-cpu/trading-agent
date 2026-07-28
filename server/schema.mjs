// 轻量域模型 Schema 校验 —— 借鉴对方 okx-agent 的强类型思路，但用运行时校验（不做全量 TS 迁移）。
// 目标：在写入边界挡住坏/半截记录，并把满屏的双字段防御（stopLoss↔stop_loss、entry↔entry_range）
// 收敛成一个规范化函数。纯函数、可单测，不触碰 db。
// 每个校验器返回 { valid, errors, warnings, normalized }。errors 非空即拒绝；warnings 只提示。

const isNum = (v) => Number.isFinite(Number(v));
const n = (v) => Number(v);

// —— 交易计划：本系统最容易出坑、且字段最乱的模型 —— //
// 兼容 camelCase 与 snake_case 两套字段，输出统一规范化对象。
export function validateTradePlan(plan = {}) {
  const errors = [];
  const warnings = [];
  const direction = String(plan.direction || "").toLowerCase();
  if (!["long", "short"].includes(direction)) errors.push(`direction 非法：${plan.direction}`);

  // 入场区间：兼容 entry_range / entry.range / entryLow+entryHigh
  let entry = Array.isArray(plan.entry_range) ? plan.entry_range.map(n) : null;
  if (!entry && isNum(plan.entryLow) && isNum(plan.entryHigh)) entry = [n(plan.entryLow), n(plan.entryHigh)];
  if (!entry || entry.length < 2 || !entry.every(isNum)) errors.push("入场区间缺失或非数值");
  else {
    if (entry[0] > entry[1]) { warnings.push("入场区间上下界颠倒，已自动交换"); entry = [entry[1], entry[0]]; }
    if (entry[0] <= 0) errors.push("入场价必须为正");
  }

  const stop = isNum(plan.stopLoss) ? n(plan.stopLoss) : isNum(plan.stop_loss) ? n(plan.stop_loss) : null;
  if (stop === null || stop <= 0) errors.push("止损价缺失或非正");

  const tpRaw = plan.takeProfit || plan.take_profit || plan.takeProfits || [];
  const takeProfit = (Array.isArray(tpRaw) ? tpRaw : [tpRaw]).map(n).filter(isNum);
  if (!takeProfit.length) warnings.push("未设置止盈目标");

  const leverage = isNum(plan.leverage) ? n(plan.leverage) : 1;
  if (leverage < 1) errors.push("杠杆必须 ≥ 1");
  const maxLossPct = isNum(plan.max_loss_pct) ? n(plan.max_loss_pct) : isNum(plan.maxRiskPct) ? n(plan.maxRiskPct) : null;
  if (maxLossPct === null || maxLossPct <= 0) errors.push("单笔风险% 缺失或非正");
  if (!plan.symbol) errors.push("symbol 缺失");

  // 方向一致性：止损/止盈必须在正确一侧，否则是逻辑错误的计划（比 LLM 说错方向更隐蔽）。
  if (entry && stop !== null && !errors.length) {
    if (direction === "long" && stop >= entry[0]) errors.push(`做多止损(${stop})必须低于入场下界(${entry[0]})`);
    if (direction === "short" && stop <= entry[1]) errors.push(`做空止损(${stop})必须高于入场上界(${entry[1]})`);
    for (const tp of takeProfit) {
      if (direction === "long" && tp <= entry[1]) warnings.push(`做多止盈(${tp})未在入场上方`);
      if (direction === "short" && tp >= entry[0]) warnings.push(`做空止盈(${tp})未在入场下方`);
    }
  }

  const normalized = errors.length ? null : {
    ...plan,
    direction,
    entry_range: entry,
    entry: plan.entry && typeof plan.entry === "object" ? plan.entry : { type: "limit", range: `${entry[0]} - ${entry[1]}` },
    stopLoss: stop, stop_loss: stop,
    takeProfit, take_profit: takeProfit,
    leverage, max_loss_pct: maxLossPct
  };
  return { valid: errors.length === 0, errors, warnings, normalized };
}

// —— 订单：下单前的结构闸 —— //
export function validateOrder(order = {}) {
  const errors = [];
  if (!order.symbol && !order.instId) errors.push("缺 symbol/instId");
  const side = String(order.side || "").toLowerCase();
  if (!["buy", "sell", "long", "short"].includes(side)) errors.push(`side 非法：${order.side}`);
  const size = order.size ?? order.sz ?? order.quantity;
  if (!isNum(size) || n(size) <= 0) errors.push("下单数量必须为正");
  const type = String(order.orderType || order.ordType || "market").toLowerCase();
  if (type === "limit" && !isNum(order.price ?? order.px)) errors.push("限价单缺价格");
  return { valid: errors.length === 0, errors, warnings: [], normalized: errors.length ? null : order };
}

// —— 运行配置：挡住把关键项写成空/错值（如模型名写错导致全线抽风）—— //
const KNOWN_MODEL_KEYS = new Set(["ANTHROPIC_MODEL", "OPENAI_MODEL", "DEEPSEEK_MODEL", "GEMINI_MODEL"]);
export function validateRuntimeConfig(entries = {}) {
  const errors = [];
  const warnings = [];
  for (const [key, value] of Object.entries(entries)) {
    if (KNOWN_MODEL_KEYS.has(key)) {
      const v = String(value || "").trim();
      if (!v) { errors.push(`${key} 不能为空`); continue; }
      if (/\s/.test(v)) errors.push(`${key} 含空白字符：「${v}」`);
      if (key === "DEEPSEEK_MODEL" && /flash/i.test(v)) warnings.push("DEEPSEEK_MODEL 使用 flash 弱模型：易出现「声称调用工具却没真做」，建议 v4-pro");
    }
    if (/^(LIVE_TRADING_ENABLED|REAL_ORDER_WRITE_ENABLED|I_UNDERSTAND_REAL_TRADING)$/.test(key)) {
      const v = String(value);
      if (!["true", "false", ""].includes(v)) errors.push(`${key} 只能为 true/false，收到「${v}」`);
    }
  }
  return { valid: errors.length === 0, errors, warnings, normalized: entries };
}
