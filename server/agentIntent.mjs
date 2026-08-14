const MARKET_TERMS = [
  "行情", "市场", "价格", "现价", "K线", "资金费率", "OI", "订单簿", "交易机会",
  "下单", "开仓", "做多", "做空", "合约", "USDT"
];

const EVIDENCE_TERMS = [
  ...MARKET_TERMS, "交易", "持仓", "仓位", "账户", "余额", "净值", "保证金", "盈亏", "风控"
];

const MARKET_RE = /(行情|市场|价格|现价|K线|资金费率|OI|订单簿|交易机会|下单|开仓|做多|做空|合约|USDT|\b[A-Z0-9]{2,12}(?:USDT|\/USDT|-USDT)\b)/i;
const EVIDENCE_RE = /(行情|市场|价格|现价|K线|资金费率|OI|订单簿|交易|下单|开仓|做多|做空|持仓|仓位|账户|余额|净值|保证金|盈亏|风控|合约|USDT|\b[A-Z0-9]{2,12}(?:USDT|\/USDT|-USDT)\b)/i;

const CN_NEGATION = "(?:不要|无需|不需要|禁止|请勿|勿|别|不必|无须|不得|不再)";
const EN_NEGATION = "(?:do\\s+not|don't|dont|never|without|no\\s+need\\s+to|must\\s+not|should\\s+not)";

function escapedAlternation(values) {
  return [...new Set(values)]
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

const ALL_CN_TERMS = escapedAlternation(EVIDENCE_TERMS);
const CN_NEGATED_PREFIX_RE = new RegExp(`${CN_NEGATION}[^。！？!?；;\\n]{0,80}?(?:${ALL_CN_TERMS})`, "gi");
const CN_NEGATED_SUFFIX_RE = new RegExp(`(?:${ALL_CN_TERMS})[^。！？!?；;\\n]{0,20}${CN_NEGATION}`, "gi");
const EN_NEGATED_RE = new RegExp(`${EN_NEGATION}[^.!?;\\n]{0,80}?(?:trading|trade|order|position|market|price|account|balance|risk|futures|contract)`, "gi");

// 关键词路由只负责判断是否需要昂贵的事实/行情预检。先移除明确被否定的
// 动作片段，避免“不要创建交易计划”因为包含“交易”而触发整套市场能力。
// 正向请求不会被吞掉，例如“分析 BTC，但不要下单”仍因 BTC 保留行情预检。
export function actionableAgentText(value = "") {
  return String(value)
    .replace(CN_NEGATED_PREFIX_RE, " ")
    .replace(CN_NEGATED_SUFFIX_RE, " ")
    .replace(EN_NEGATED_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAgentChatIntent(value = "", { autonomous = false } = {}) {
  const originalText = String(value || "");
  if (autonomous) {
    return { originalText, actionableText: originalText, marketAnalysisRequired: true, evidenceRequired: true };
  }
  const actionableText = actionableAgentText(originalText);
  return {
    originalText,
    actionableText,
    marketAnalysisRequired: MARKET_RE.test(actionableText),
    evidenceRequired: EVIDENCE_RE.test(actionableText)
  };
}
