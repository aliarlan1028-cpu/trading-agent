import { normalizeEvidenceSymbol } from "./evidenceBundle.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const CURRENT_CONTEXT = /(当前|目前|现价|最新|现在|今日|账户|持仓|挂单|资金费率|未平仓|\bOI\b|点差|深度|买盘占比|24h|合约|ctVal|minSz|lotSz|tickSz|最小下单|下单步长|价格步长|闭合K线|收盘价|市场广度|上涨家数|涨跌中位数|大户|散户|主动买卖比|日亏|浮动盈亏|未实现盈亏)/i;
const NON_CURRENT_CONTEXT = /^\s*(?:[-*>#\d.]+\s*)?(?:历史|曾经|当时|复盘|假设|如果|若|计划|目标|止损|止盈|入场|预测|预计|可能)/i;

function near(actual, expected, { relative = 0, absolute = 0 } = {}) {
  const a = Number(actual);
  const e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
  return Math.abs(a - e) <= Math.max(absolute, Math.abs(e) * relative);
}

function replaceCapturedNumber(line, match, expected) {
  const raw = match?.[1];
  if (!raw) return line;
  const within = match[0].lastIndexOf(raw);
  if (within < 0) return line;
  const start = match.index + within;
  return `${line.slice(0, start)}${expected}${line.slice(start + raw.length)}`;
}

function freshest(entry) {
  return entry?.status === "fresh" && entry?.quality === "passed" && entry.data;
}

function displayTime(entry) {
  if (!entry?.fetchedAt) return "时间未知";
  const date = new Date(entry.fetchedAt);
  return Number.isNaN(date.getTime())
    ? String(entry.fetchedAt)
    : `${date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（UTC+8）`;
}

function symbolForLine(line, bundle, allowSingleFallback = true) {
  for (const row of bundle?.symbols || []) {
    const base = row.symbol.split("/")[0];
    if (new RegExp(`\\b${base}(?:/USDT|-USDT(?:-SWAP)?|USDT)?\\b`, "i").test(line)) return row;
  }
  return allowSingleFallback && bundle?.symbols?.length === 1 ? bundle.symbols[0] : null;
}

function explicitTickerMention(line) {
  return /\b[A-Z0-9]{2,12}(?:\/USDT|-USDT(?:-SWAP)?|USDT)\b/i.test(String(line || ""));
}

function narrativeSymbolCount(content, bundle) {
  const symbols = new Set();
  const matches = String(content || "").match(/\b[A-Z0-9]{2,12}(?:\/USDT|-USDT(?:-SWAP)?|USDT)\b/gi) || [];
  for (const match of matches) symbols.add(normalizeEvidenceSymbol(match));
  for (const row of bundle?.symbols || []) {
    const base = row.symbol.split("/")[0];
    if (new RegExp(`\\b${base}(?:/USDT|-USDT(?:-SWAP)?|USDT)\\b`, "i").test(String(content || ""))) symbols.add(row.symbol);
  }
  return symbols.size;
}

function correctionForUnavailable(label, entry) {
  return `**事实守卫**：${label}无法确认（证据 ${entry?.evidenceId || "missing"}，状态 ${entry?.status || "missing"}/${entry?.quality || "missing"}）。`;
}

function addViolation(target, field, line, actual, expected, entry, enforced) {
  target.push({
    field,
    claim: line.slice(0, 240),
    actual: finite(actual) ? Number(actual) : actual,
    expected: finite(expected) ? Number(expected) : expected,
    evidenceId: entry?.evidenceId || null,
    evidenceStatus: entry?.status || "missing",
    enforced
  });
}

function numericRule({ field, line, pattern, expected, entry, tolerance, label, suffix = "", violations, enforce }) {
  const match = line.match(pattern);
  if (!match) return { line, matched: false };
  if (!freshest(entry) || !finite(expected)) {
    addViolation(violations, field, line, match[1], expected, entry, enforce);
    return { line: enforce ? correctionForUnavailable(label, entry) : line, matched: true };
  }
  if (near(match[1], expected, tolerance)) return { line, matched: true };
  addViolation(violations, field, line, match[1], expected, entry, enforce);
  return {
    line: enforce ? `${replaceCapturedNumber(line, match, Number(expected))} 〔已按 ${entry.evidenceId} 更正；${displayTime(entry)}${suffix}〕` : line,
    matched: true
  };
}

/**
 * Validate current quantitative claims in an LLM answer against one immutable evidence bundle.
 * Default rollout hard-corrects high-impact core fields and records every other mismatch in shadow.
 * Set mode="enforce_all" after observing shadow false-positive metrics in production.
 */
export function enforceEvidenceFacts(bundle, content = "", options = {}) {
  const mode = options.mode || process.env.EVIDENCE_FACT_GUARD_MODE || "enforce_core";
  const violations = [];
  const output = [];
  const coreFields = new Set(["price", "account_equity", "available_margin", "position_count", "open_order_count", "today_pnl", "unrealized_pnl", "remaining_daily_loss", "daily_loss_cap", "ctVal", "minSz", "lotSz", "tickSz"]);
  const shouldEnforce = (field) => mode === "enforce_all" || (mode !== "shadow" && coreFields.has(field));
  // Long multi-asset reports commonly put the symbol in a heading and the price
  // on the following line. Carry that explicit heading scope forward. Never use
  // the legacy single-symbol fallback when the narrative mentions other assets:
  // a proposal-scoped ADA bundle must not rewrite BTC/SUI lines as ADA facts.
  const multiAssetNarrative = narrativeSymbolCount(content, bundle) > 1;
  let activeSymbolRow = null;

  for (const original of String(content || "").split("\n")) {
    let line = original;
    const explicitRow = symbolForLine(line, bundle, false);
    if (explicitRow) activeSymbolRow = explicitRow;
    else if (explicitTickerMention(line)) activeSymbolRow = null;
    if (!CURRENT_CONTEXT.test(line) || NON_CURRENT_CONTEXT.test(line)) {
      output.push(line);
      continue;
    }
    const row = explicitRow || activeSymbolRow || symbolForLine(line, bundle, !multiAssetNarrative);
    if (/(?:当前|目前|账户)?(?:无挂单|没有挂单|无未成交订单)/i.test(line)) {
      const account = bundle?.account;
      const expected = account?.data?.openOrderCount;
      if (!freshest(account) || !finite(expected)) {
        addViolation(violations, "open_order_count", line, 0, expected, account, shouldEnforce("open_order_count"));
        if (shouldEnforce("open_order_count")) line = correctionForUnavailable("OKX 当前挂单", account);
      } else if (Number(expected) !== 0) {
        addViolation(violations, "open_order_count", line, 0, expected, account, shouldEnforce("open_order_count"));
        if (shouldEnforce("open_order_count")) line = `**事实守卫**：当前有 ${expected} 个未成交挂单（${account.evidenceId}，${displayTime(account)}）。`;
      }
      output.push(line);
      continue;
    }
    if (/(?:当前|目前|账户)?(?:无持仓|没有持仓|为空仓)/i.test(line)) {
      const account = bundle?.account;
      const expected = account?.data?.positionCount;
      if (!freshest(account) || !finite(expected)) {
        addViolation(violations, "position_count", line, 0, expected, account, shouldEnforce("position_count"));
        if (shouldEnforce("position_count")) line = correctionForUnavailable("OKX 当前持仓", account);
      } else if (Number(expected) !== 0) {
        addViolation(violations, "position_count", line, 0, expected, account, shouldEnforce("position_count"));
        if (shouldEnforce("position_count")) {
          const positions = (account.data.positions || []).map((position) => `${normalizeEvidenceSymbol(position.symbol)} ${position.direction} ${position.contracts}张`).join("；");
          line = `**事实守卫**：当前持仓 ${expected} 个${positions ? `（${positions}）` : ""}（${account.evidenceId}，${displayTime(account)}）。`;
        }
      }
      output.push(line);
      continue;
    }
    const rules = [];
    if (row) {
      rules.push(
        { field: "price", pattern: /(?:现价|当前价|最新价|当前价格)\s*[:：]?\s*\$?([+\-]?\d+(?:\.\d+)?)/i, expected: row.ticker?.data?.price, entry: row.ticker, tolerance: { relative: 0.002 }, label: `${row.symbol} 当前价` },
        { field: "high_24h", pattern: /(?:24h|24小时)(?:最高价|最高|高点)\s*[:：]?\s*\$?([+\-]?\d+(?:\.\d+)?)/i, expected: row.ticker?.data?.high24h, entry: row.ticker, tolerance: { relative: 0.002 }, label: `${row.symbol} 24h 最高价` },
        { field: "low_24h", pattern: /(?:24h|24小时)(?:最低价|最低|低点)\s*[:：]?\s*\$?([+\-]?\d+(?:\.\d+)?)/i, expected: row.ticker?.data?.low24h, entry: row.ticker, tolerance: { relative: 0.002 }, label: `${row.symbol} 24h 最低价` },
        { field: "closed_candle_count", pattern: /(?:1H|1小时)?(?:已)?闭合K线\s*[:：]?\s*([+\-]?\d+)\s*根/i, expected: row.candles?.data?.closedBars, entry: row.candles, tolerance: { absolute: 0 }, label: `${row.symbol} 1H 闭合 K 线数量` },
        { field: "last_closed_price", pattern: /(?:最新|上一根)?(?:1H|1小时)?(?:闭合K线)?收盘价\s*[:：]?\s*\$?([+\-]?\d+(?:\.\d+)?)/i, expected: row.candles?.data?.lastClosedPrice, entry: row.candles, tolerance: { relative: 0.002 }, label: `${row.symbol} 最新 1H 闭合价` },
        { field: "funding_rate", pattern: /资金费率\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*%/i, expected: row.microstructure?.data?.fundingRatePct, entry: row.microstructure, tolerance: { absolute: 0.001 }, label: `${row.symbol} 资金费率` },
        { field: "open_interest", pattern: /(?:未平仓量|\bOI\b)\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.microstructure?.data?.openInterest, entry: row.microstructure, tolerance: { relative: 0.02 }, label: `${row.symbol} 未平仓量` },
        { field: "spread_bps", pattern: /(?:点差|spread)\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:bps?|基点)/i, expected: row.microstructure?.data?.spreadBps, entry: row.microstructure, tolerance: { absolute: 0.2 }, label: `${row.symbol} 点差` },
        { field: "depth_usdt", pattern: /(?:订单簿)?深度\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: row.microstructure?.data?.depthUsdt, entry: row.microstructure, tolerance: { relative: 0.02 }, label: `${row.symbol} 订单簿深度` },
        { field: "book_imbalance", pattern: /(?:订单簿)?买盘占比\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*%/i, expected: row.microstructure?.data?.bookImbalancePct, entry: row.microstructure, tolerance: { absolute: 0.2 }, label: `${row.symbol} 订单簿买盘占比` },
        { field: "change_24h", pattern: /(?:24h|24小时)(?:涨跌|变化|涨幅|跌幅)?\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*%/i, expected: row.ticker?.data?.change24hPct, entry: row.ticker, tolerance: { absolute: 0.2 }, label: `${row.symbol} 24h 涨跌` },
        { field: "ctVal", pattern: /(?:ctVal\s*[:：]?|1\s*张\s*[=＝])\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.contractSpec?.data?.ctVal, entry: row.contractSpec, tolerance: { relative: 0, absolute: 1e-12 }, label: `${row.symbol} 合约面值` },
        { field: "minSz", pattern: /(?:minSz\s*[:：]?|最小下单(?:量)?\s*[:：]?)\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.contractSpec?.data?.minSz, entry: row.contractSpec, tolerance: { relative: 0, absolute: 1e-12 }, label: `${row.symbol} 最小下单量` },
        { field: "lotSz", pattern: /(?:lotSz\s*[:：]?|下单步长\s*[:：]?)\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.contractSpec?.data?.lotSz, entry: row.contractSpec, tolerance: { relative: 0, absolute: 1e-12 }, label: `${row.symbol} 下单步长` },
        { field: "tickSz", pattern: /(?:tickSz\s*[:：]?|价格步长\s*[:：]?)\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.contractSpec?.data?.tickSz, entry: row.contractSpec, tolerance: { relative: 0, absolute: 1e-12 }, label: `${row.symbol} 价格步长` },
        { field: "top_trader_ratio", pattern: /大户(?:持仓)?多空比\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.smartMoney?.data?.topTraderLongShortRatio, entry: row.smartMoney, tolerance: { absolute: 0.002 }, label: `${row.symbol} 大户持仓多空比` },
        { field: "retail_ratio", pattern: /散户(?:账户)?多空比\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.smartMoney?.data?.retailLongShortRatio, entry: row.smartMoney, tolerance: { absolute: 0.002 }, label: `${row.symbol} 散户多空比` },
        { field: "taker_ratio", pattern: /主动买卖比\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)/i, expected: row.smartMoney?.data?.takerBuySellRatio, entry: row.smartMoney, tolerance: { absolute: 0.002 }, label: `${row.symbol} 主动买卖比` }
      );
    }
    rules.push(
      { field: "account_equity", pattern: /(?:账户(?:净值|权益)|总资产|账户仅|账户余额)\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: bundle?.account?.data?.totalEquityUsdt, entry: bundle?.account, tolerance: { relative: 0.0005, absolute: 0.01 }, label: "OKX 账户净值" },
      { field: "available_margin", pattern: /可用保证金\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: bundle?.account?.data?.availableMarginUsdt, entry: bundle?.account, tolerance: { relative: 0.0005, absolute: 0.01 }, label: "OKX 可用保证金" },
      { field: "position_count", pattern: /(?:当前)?持仓(?:数量|数)?\s*[:：]?\s*([+\-]?\d+)\s*(?:个|笔|仓)?/i, expected: bundle?.account?.data?.positionCount, entry: bundle?.account, tolerance: { absolute: 0 }, label: "OKX 当前持仓数量" },
      { field: "open_order_count", pattern: /(?:当前)?(?:挂单|未成交订单)(?:数量|数)?\s*[:：]?\s*([+\-]?\d+)\s*(?:个|笔|单)?/i, expected: bundle?.account?.data?.openOrderCount, entry: bundle?.account, tolerance: { absolute: 0 }, label: "OKX 当前挂单数量" },
      { field: "today_pnl", pattern: /今日盈亏\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: bundle?.accounting?.data?.todayPnlUsdt, entry: bundle?.accounting, tolerance: { relative: 0.0005, absolute: 0.01 }, label: "今日盈亏" },
      { field: "unrealized_pnl", pattern: /未实现盈亏\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: bundle?.accounting?.data?.unrealizedPnlUsdt, entry: bundle?.accounting, tolerance: { relative: 0.0005, absolute: 0.01 }, label: "账户未实现盈亏" },
      { field: "remaining_daily_loss", pattern: /(?:剩余)?(?:日亏预算|日亏损容忍额|日亏容忍额)\s*(?:仅剩|剩余)?\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: bundle?.accounting?.data?.remainingDailyLossUsdt, entry: bundle?.accounting, tolerance: { relative: 0.0005, absolute: 0.01 }, label: "剩余日亏损容忍额" },
      { field: "daily_loss_cap", pattern: /(?:当日|每日|日)(?:亏损)?上限\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*(?:USDT|U)?/i, expected: bundle?.accounting?.data?.dailyLossCapUsdt, entry: bundle?.accounting, tolerance: { relative: 0.0005, absolute: 0.01 }, label: "当日亏损上限" },
      { field: "market_breadth", pattern: /(?:市场广度|上涨家数(?:占比)?)\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*%/i, expected: bundle?.global?.data?.breadthPct, entry: bundle?.global, tolerance: { absolute: 0.2 }, label: "OKX 永续市场广度" },
      { field: "market_median_change", pattern: /(?:全市场)?(?:24h)?涨跌中位数\s*[:：]?\s*([+\-]?\d+(?:\.\d+)?)\s*%/i, expected: bundle?.global?.data?.medianChangePct, entry: bundle?.global, tolerance: { absolute: 0.2 }, label: "OKX 永续涨跌中位数" }
    );

    for (const rule of rules) {
      const enforce = shouldEnforce(rule.field);
      const before = violations.length;
      const checked = numericRule({ ...rule, line, violations, enforce });
      line = checked.line;
      if (violations.length > before && enforce && line.startsWith("**事实守卫**：")) break;
    }
    output.push(line);
  }

  const enforced = violations.filter((row) => row.enforced);
  return {
    text: output.join("\n").trim(),
    corrected: enforced.length > 0,
    violations: enforced,
    shadowViolations: violations.filter((row) => !row.enforced),
    mode
  };
}
