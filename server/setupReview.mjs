// 行情结构分析工具（SMC/供需方法学，源自 SRTL V1.0 审核清单）。
// 注：SRTL 曾是"执行前审批闸"（reviewTradeSetup，一味拒单把交易焊死），已移除；
// 这里保留的是其 SMC 方法学，改造成"分析阶段的参谋工具"——AI 分析行情时主动调用
// analyze_market_structure，拿 4H 结构方向/供需区/1H 流动性与 CHoCH/可执行入场思路指导决策，
// 参谋而非审批、不事后否决交易。盈亏比/结构质量由 AI 在提计划前自查（见 BASE_RULES 铁律 11）。
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { llmComplete, activeProvider } from "./agentChat.mjs";
import { appendTrace } from "./store.mjs";

const ANALYSIS_SYSTEM = "你是加密永续合约结构分析师，用 SMC/供需方法给交易员做行情结构参谋(不是审批,是参谋)。看真实 4H+1H K 线，给出：4H 大周期结构方向(BOS/趋势)、当前处于结构哪一段、最近的优质供需区/关键位、1H 是否出现流动性扫荡与 CHoCH、以及一个可执行的方向与入场思路(含结构失效位=止损参考)。诚实：结构不清晰/震荡就说'无高质量结构,建议观望'，不硬凑方向。只输出纯 JSON。";

export async function analyzeMarketStructure(db, symbol = "BTC/USDT", direction = null) {
  if (!activeProvider()) return { available: false, reason: "未配置 LLM，无法做结构分析" };
  let h4 = [], h1 = [];
  try {
    [h4, h1] = await Promise.all([getHistoricalKlines(symbol, "4h", 40), getHistoricalKlines(symbol, "1h", 50)]);
  } catch { /* 下方判空 */ }
  if (!h4?.length || !h1?.length) return { available: false, reason: "无法获取真实 4H/1H K 线" };
  const fmt = (rows) => rows.slice(-15).map((c) => ({ t: new Date(c.time).toISOString().slice(5, 16), o: c.open, h: c.high, l: c.low, c: c.close }));
  const prompt = `资产：${symbol}（永续）${direction ? `\n交易员倾向方向：${direction}` : ""}\n\n=== 近 15 根 4H（最新在后）===\n${JSON.stringify(fmt(h4))}\n=== 近 15 根 1H ===\n${JSON.stringify(fmt(h1))}\n\n按 SMC 结构分析，只返回纯 JSON：\n{"bias":"LONG|SHORT|NEUTRAL","structure4h":"一句话大周期结构","phase":"当前处于:回调/反弹/趋势中继/区间","keyZones":[{"type":"supply|demand","from":0,"to":0}],"liquidity1h":"1H 流动性扫荡/CHoCH 现状","entryIdea":"可执行入场思路(方向+大致入场区+结构失效位=止损参考)","quality":"A|B|C","note":"一句话结论或风险提示"}`;
  let parsed = null;
  try {
    const raw = await llmComplete(prompt, ANALYSIS_SYSTEM);
    parsed = JSON.parse(String(raw || "").slice(String(raw).indexOf("{"), String(raw).lastIndexOf("}") + 1));
  } catch {
    return { available: false, reason: "结构分析模型返回无法解析" };
  }
  appendTrace(db, "structure_analysis", `${symbol} ${parsed.bias || "?"}`, "ok", 0);
  return { available: true, symbol, ...parsed };
}
