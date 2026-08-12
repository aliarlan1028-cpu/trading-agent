import { getHistoricalKlines, syncMicrostructure, fetchFundingPercentile } from "./exchangeConnector.mjs";
import { activeMandate, nowIso } from "./store.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { buildExecutionQuality, buildSloReport } from "./professionalAnalytics.mjs";
import { estimateExecutionCost, maxNotionalForImpact } from "./executionCostModel.mjs";
import { analyzeMarketRegime } from "./marketRegimeAnalysis.mjs";

// ---------------------------------------------------------------------------
// 原生交易 Skill：把技能接进 Agent 的工具循环。
// 每个 Skill = 一个只读交易能力，走"扫描 → 人工安装"后才对 Agent 可见（成为可调工具）。
// 全部只读（market.read），不触碰下单/密钥；安全闸与内置工具一致。
// 外部导入的 SKILL.md 仍走沙箱/文档路径（不变）；这里是内置的、可执行的原生技能。
// ---------------------------------------------------------------------------

function round(value, price) {
  const p = Number(price) || 0;
  const d = p > 1000 ? 1 : p > 1 ? 3 : 5;
  return Number(Number(value).toFixed(d));
}

function mandateSymbols(db, provided) {
  if (Array.isArray(provided) && provided.length) return provided.map((s) => String(s).toUpperCase());
  const mandate = activeMandate(db);
  return (mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT", "ETH/USDT", "SOL/USDT"]).map((s) => String(s).toUpperCase());
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// 摆动结构:3 根分形取最近两个摆动高/低点。HH+HL=多头结构(1)，LH+LL=空头结构(-1)，其它=0。
function swingStructure(highs, lows, w = 2) {
  const sh = [], sl = [];
  for (let i = w; i < highs.length - w; i += 1) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j += 1) { if (highs[j] > highs[i]) isH = false; if (lows[j] < lows[i]) isL = false; }
    if (isH) sh.push(highs[i]);
    if (isL) sl.push(lows[i]);
  }
  if (sh.length < 2 || sl.length < 2) return 0;
  if (sh.at(-1) > sh.at(-2) && sl.at(-1) > sl.at(-2)) return 1;
  if (sh.at(-1) < sh.at(-2) && sl.at(-1) < sl.at(-2)) return -1;
  return 0;
}

export const SKILL_TOOLS = [
  {
    skillId: "skill_native_mtf",
    name: "多周期趋势对齐",
    toolName: "mtf_trend_alignment",
    permissions: ["market.read"],
    description: "在 1h/4h/1d 三个周期判断趋势方向是否一致。多周期一致时趋势信号更可靠；不一致时应谨慎。内置 sync_market 只看单周期，这个技能补多周期确认。",
    schema: { type: "object", properties: { symbol: { type: "string", description: "交易对，如 BTC/USDT" } }, required: ["symbol"] },
    async handler(db, args) {
      // v1.1:每个周期用三票判定——①价格 vs SMA20 位置 ②SMA20 斜率 ③摆动结构(HH/HL vs LH/LL)。
      // 三票需 ≥2 同向且无反向票才给方向,否则 neutral(避免单根穿越 SMA 的假信号)。
      const symbol = String(args.symbol || "BTC/USDT").toUpperCase();
      const tfs = ["1h", "4h", "1d"];
      const timeframes = {};
      for (const tf of tfs) {
        try {
          const candles = await getHistoricalKlines(symbol, tf, 80);
          const closes = candles.map((c) => Number(c.close));
          const highs = candles.map((c) => Number(c.high));
          const lows = candles.map((c) => Number(c.low));
          if (closes.length < 40) { timeframes[tf] = { error: "K线不足" }; continue; }
          const sma = avg(closes.slice(-20));
          const smaEarlier = avg(closes.slice(-40, -20));
          const last = closes[closes.length - 1];
          const struct = swingStructure(highs, lows);
          const votes = [last > sma ? 1 : -1, sma > smaEarlier ? 1 : -1, struct];
          const up = votes.filter((v) => v > 0).length, dn = votes.filter((v) => v < 0).length;
          const trend = up >= 2 && dn === 0 ? "up" : dn >= 2 && up === 0 ? "down" : "neutral";
          timeframes[tf] = { close: round(last, last), sma20: round(sma, last), pricePos: last > sma ? "above" : "below", maSlope: sma > smaEarlier ? "rising" : "falling", structure: struct > 0 ? "HH/HL" : struct < 0 ? "LH/LL" : "unclear", trend };
        } catch (error) {
          timeframes[tf] = { error: error.message };
        }
      }
      const dirs = Object.values(timeframes).map((t) => t.trend).filter(Boolean);
      const directional = dirs.filter((d) => d !== "neutral");
      const aligned = directional.length === tfs.length && directional.every((d) => d === directional[0]);
      return { symbol, timeframes, aligned, direction: aligned ? directional[0] : "mixed", note: aligned ? `三周期(价格/均线斜率/结构)一致${directional[0] === "up" ? "多头" : "空头"}，趋势信号强` : "多周期方向不一致或有背离，趋势信号弱，宜观望或降杠杆" };
    }
  },
  {
    skillId: "skill_native_funding",
    name: "资金费率极值扫描",
    toolName: "funding_extremes_scanner",
    permissions: ["market.read"],
    description: "扫描一组交易对的资金费率与订单簿不平衡，标出多空拥挤（|资金费率|≥0.05%）的品种。反向挤压风险预警。内置 get_microstructure 一次只看一个币，这个技能批量扫描。",
    schema: { type: "object", properties: { symbols: { type: "array", items: { type: "string" }, description: "交易对列表，留空则用授权白名单或主流币" } } },
    async handler(db, args) {
      // v1.1:①每币自适应阈值——用该币资金费率历史 |值| 的 P85(夹在 0.03%~0.15%)代替固定 0.05%
      //      (BTC 与小币的"极端"量级不同);拉不到历史则回落 0.05%。
      //      ②盘口失衡与费率同向确认——两者一致时拥挤判定更可靠。
      const list = mandateSymbols(db, args.symbols).slice(0, 8);
      const rows = [];
      for (const symbol of list) {
        try {
          const m = await syncMicrostructure(db, "OKX", symbol);
          const funding = Number(m.fundingRatePct) || 0;
          const imb = Number(m.bookImbalancePct);
          const p85 = await fetchFundingPercentile(symbol, 85);
          const thr = Number.isFinite(p85) ? Math.min(0.15, Math.max(0.03, p85)) : 0.05;
          const fundingCrowded = Math.abs(funding) >= thr;
          const imbExtreme = Number.isFinite(imb) && Math.abs(imb - 50) >= 20;
          const imbAgrees = Number.isFinite(imb) && ((funding > 0 && imb > 50) || (funding < 0 && imb < 50));
          const crowded = fundingCrowded || (Math.abs(funding) >= Math.max(0.03, thr * 0.6) && imbExtreme && imbAgrees);
          rows.push({ symbol, fundingRatePct: m.fundingRatePct, bookImbalancePct: Number.isFinite(imb) ? imb : null, thresholdPct: Number(thr.toFixed(3)), adaptive: Number.isFinite(p85), crowded, crowdSide: crowded ? (funding > 0 ? "long_crowded" : "short_crowded") : "balanced" });
        } catch { /* 单个失败跳过 */ }
      }
      rows.sort((a, b) => Math.abs(Number(b.fundingRatePct) || 0) - Math.abs(Number(a.fundingRatePct) || 0));
      const extremes = rows.filter((r) => r.crowded);
      return { scanned: rows.length, extremes, all: rows, note: extremes.length ? `${extremes.map((e) => e.symbol).join("、")} 资金费率偏极端(自适应阈值+盘口确认)，警惕反向挤压` : "无明显资金费率拥挤" };
    }
  },
  {
    skillId: "skill_native_sr",
    name: "支撑阻力位识别",
    toolName: "support_resistance_levels",
    permissions: ["market.read"],
    description: "从近期 K 线的摆动高低点识别关键支撑与阻力位，用于设置入场、止损和止盈参考。",
    schema: { type: "object", properties: { symbol: { type: "string", description: "交易对" }, timeframe: { type: "string", enum: ["1h", "4h", "1d"] } }, required: ["symbol"] },
    async handler(db, args) {
      const symbol = String(args.symbol || "BTC/USDT").toUpperCase();
      const timeframe = args.timeframe || "4h";
      let candles;
      try {
        candles = await getHistoricalKlines(symbol, timeframe, 120);
      } catch (error) {
        return { error: error.message };
      }
      if (!candles || candles.length < 20) return { error: "K线不足" };
      const w = 3;
      const swingHighs = [];
      const swingLows = [];
      for (let i = w; i < candles.length - w; i += 1) {
        const h = Number(candles[i].high);
        const l = Number(candles[i].low);
        let isHigh = true;
        let isLow = true;
        for (let j = i - w; j <= i + w; j += 1) {
          if (Number(candles[j].high) > h) isHigh = false;
          if (Number(candles[j].low) < l) isLow = false;
        }
        if (isHigh) swingHighs.push(h);
        if (isLow) swingLows.push(l);
      }
      const price = Number(candles[candles.length - 1].close);
      const dedupe = (arr) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const out = [];
        for (const v of sorted) if (!out.length || Math.abs(v - out[out.length - 1]) / v > 0.005) out.push(v);
        return out;
      };
      const resistance = dedupe(swingHighs.filter((h) => h > price)).slice(0, 3).map((v) => round(v, price));
      const support = dedupe(swingLows.filter((l) => l < price)).sort((a, b) => b - a).slice(0, 3).map((v) => round(v, price));
      return { symbol, timeframe, price: round(price, price), resistance, support, note: `阻力 ${resistance.join("/") || "-"}，支撑 ${support.join("/") || "-"}` };
    }
  },
  {
    // 借鉴 okx-ai-trading-journal 的相对强度：币近 N 日收益 ÷ BTC 收益，>1 = 强于大盘（跑赢），
    // 帮 AI 在白名单里"选强弃弱"。零成本、纯真实 K 线派生。
    skillId: "skill_native_rs",
    name: "相对强度扫描",
    toolName: "relative_strength",
    permissions: ["market.read"],
    description: "计算多个币种相对 BTC 的相对强度（近 N 日收益/BTC 收益），>1 强于大盘、<1 弱于大盘，用于在授权白名单里优先做最强或最弱的标的。",
    schema: { type: "object", properties: { symbols: { type: "array", items: { type: "string" }, description: "交易对列表，留空用授权白名单/主流币" }, days: { type: "number", description: "回看天数，默认 14" } } },
    async handler(db, args) {
      const days = Math.max(5, Math.min(60, Number(args.days) || 14));
      const symbols = mandateSymbols(db, args.symbols).filter((s) => !/BTC/.test(s)).slice(0, 8);
      let btc;
      try { btc = await getHistoricalKlines("BTC/USDT", "1d", days + 2); } catch (e) { return { error: `BTC K线失败：${e.message}` }; }
      if (!btc || btc.length < days) return { error: "BTC K线不足" };
      const btcRet = Number(btc[btc.length - 1].close) / Number(btc[btc.length - days].close);
      const rows = [];
      for (const symbol of symbols) {
        try {
          const c = await getHistoricalKlines(symbol, "1d", days + 2);
          if (!c || c.length < days) continue;
          const ret = Number(c[c.length - 1].close) / Number(c[c.length - days].close);
          const rs = Number((ret / btcRet).toFixed(3));
          rows.push({ symbol, rs, coinRetPct: Number(((ret - 1) * 100).toFixed(1)), vsBtc: rs >= 1 ? "强于大盘" : "弱于大盘" });
        } catch { /* 单币失败跳过 */ }
      }
      rows.sort((a, b) => b.rs - a.rs);
      const strongest = rows[0]?.symbol;
      const weakest = rows[rows.length - 1]?.symbol;
      return { days, btcRetPct: Number(((btcRet - 1) * 100).toFixed(1)), ranking: rows, strongest, weakest, note: rows.length ? `最强 ${strongest}(RS ${rows[0].rs})，最弱 ${weakest}(RS ${rows[rows.length - 1].rs})` : "无可比数据" };
    }
  },
  {
    skillId: "skill_native_contract_risk", name: "合约风险画像", toolName: "contract_risk_profile", version: "1.0.0", permissions: ["market.read", "account.read"], freshnessMs: 15000, failClosed: true,
    description: "计算持仓强平距离、标记价偏差、保证金模式与资金费率压力；数据缺失时明确阻断结论。",
    schema: { type:"object", properties:{ symbol:{type:"string"} }, required:["symbol"] }, outputSchema:{ type:"object", required:["status","symbol","risk"] },
    async handler(db,args){ const symbol=String(args.symbol).toUpperCase(); const p=(db.positions||[]).find(x=>x.symbol===symbol); const m=(db.markets||[]).find(x=>x.symbol===symbol); if(!p||!m?.price)return {status:"blocked",symbol,reason:"position_or_mark_missing",risk:null}; const mark=Number(p.mark||m.price),liq=Number(p.liquidationPrice||p.liqPx); const dist=Number.isFinite(liq)&&liq>0?Math.abs(mark-liq)/mark*100:null; return {status:dist===null?"blocked":"ok",symbol,risk:{markPrice:mark,liquidationPrice:liq||null,liquidationDistancePct:dist===null?null:Number(dist.toFixed(2)),marginMode:p.marginMode||p.mgnMode||"unknown",fundingRatePct:m.fundingRatePct??null}}; }
  },
  {
    skillId:"skill_native_portfolio_exposure",name:"组合暴露分析",toolName:"portfolio_exposure",version:"1.0.0",permissions:["market.read","account.read"],freshnessMs:60000,failClosed:true,
    description:"输出组合波动、相关矩阵、净方向暴露和同向集中度。",schema:{type:"object",properties:{}},outputSchema:{type:"object",required:["status","portfolio"]},
    async handler(db){const portfolio=buildPortfolioRisk(db,activeMandate(db));const ps=db.positions||[];const signed=ps.map(p=>(/空|short/i.test(p.direction)?-1:1)*Number(p.size||0)*Number(p.mark||p.entry||0));const gross=signed.reduce((a,b)=>a+Math.abs(b),0),net=signed.reduce((a,b)=>a+b,0);return {status:portfolio.status==="no_equity"?"blocked":"ok",portfolio:{...portfolio,netDeltaUsdt:Number(net.toFixed(2)),grossExposureUsdt:Number(gross.toFixed(2)),directionalConcentrationPct:gross?Number(Math.abs(net)/gross*100).toFixed(1):null}};}
  },
  {
    skillId:"skill_native_liquidity",name:"流动性与冲击成本",toolName:"liquidity_impact",version:"1.0.0",permissions:["market.read"],freshnessMs:5000,failClosed:true,
    description:"基于盘口点差与深度估算冲击、容量和拆单建议。",schema:{type:"object",properties:{symbol:{type:"string"},notionalUsdt:{type:"number"}},required:["symbol","notionalUsdt"]},outputSchema:{type:"object",required:["status","estimate"]},
    async handler(db,args){
      // v1.1:线性冲击 → 平方根冲击律(机构标准:冲击 ∝ √参与率)。半价差为基础成本,
      // K=100bps 为参与率系数(参与率=下单额/盘口深度;满深度≈100bps 冲击,再按 √ 放大)。
      const symbol=String(args.symbol).toUpperCase();
      const m=await syncMicrostructure(db,"OKX",symbol);
      const spread=Number(m.spreadBps),depth=Number(m.depthUsdt||m.orderBookDepthUsdt);
      if(!Number.isFinite(spread)||!Number.isFinite(depth)||depth<=0)return {status:"blocked",reason:"fresh_depth_unavailable",estimate:null};
      const n=Number(args.notionalUsdt);
      const estimate=estimateExecutionCost(db,{symbol,spreadBps:spread,depthUsdt:depth,notionalUsdt:n});
      const maxNotionalAt10Bps=maxNotionalForImpact(db,{symbol,spreadBps:spread,depthUsdt:depth,maxImpactBps:10})??0;
      const splitCount=maxNotionalAt10Bps>0?Math.max(1,Math.ceil(n/maxNotionalAt10Bps)):Math.max(1,Math.ceil(Number(estimate.expectedImpactBps||0)/10));
      return {status:"ok",estimate:{...estimate,maxNotionalAt10Bps,splitCount}};
    }
  },
  {
    skillId:"skill_native_basis",name:"资金费率与基差",toolName:"funding_basis",version:"1.0.0",permissions:["market.read"],freshnessMs:15000,failClosed:true,
    description:"评估资金费率、永续基差与拥挤反转风险。",schema:{type:"object",properties:{symbol:{type:"string"}},required:["symbol"]},outputSchema:{type:"object",required:["status","signal"]},
    async handler(db,args){
      // v1.1:拥挤阈值改为该币资金费率历史 P85 自适应(夹 0.03%~0.15%),拉不到回落 0.05%。
      const symbol=String(args.symbol).toUpperCase();
      const m=await syncMicrostructure(db,"OKX",symbol);
      const market=(db.markets||[]).find(x=>x.symbol===symbol)||{};
      const mark=Number(m.markPrice||market.price),index=Number(m.indexPrice||market.indexPrice);
      if(!Number.isFinite(mark)||!Number.isFinite(index)||!index)return {status:"blocked",reason:"mark_or_index_missing",signal:null};
      const basis=(mark/index-1)*100;
      const funding=Number(m.fundingRatePct);
      const p85=await fetchFundingPercentile(symbol,85);
      const thr=Number.isFinite(p85)?Math.min(0.15,Math.max(0.03,p85)):0.05;
      return {status:"ok",signal:{symbol,fundingRatePct:Number.isFinite(funding)?funding:null,basisPct:Number(basis.toFixed(4)),thresholdPct:Number(thr.toFixed(3)),crowding:Math.abs(funding)>=thr?funding>0?"long_crowded":"short_crowded":"balanced"}};
    }
  },
  {
    skillId:"skill_native_regime",name:"市场状态分类",toolName:"deterministic_market_regime",version:"1.0.0",permissions:["market.read"],freshnessMs:60000,failClosed:true,
    description:"以确定性价格、波动和流动性特征分类趋势、震荡、高波动与低流动性。",schema:{type:"object",properties:{symbol:{type:"string"},timeframe:{type:"string"}},required:["symbol"]},outputSchema:{type:"object",required:["status","regime"]},
    async handler(db,args){
      // v1.1:补上"低流动性"分类(此前描述有、代码无)——盘口点差 >5bps 视为盘口偏薄,优先标 low_liquidity。
      const symbol=String(args.symbol).toUpperCase(),m=(db.markets||[]).find(x=>x.symbol===symbol);
      const c=(m?.candlesByTf?.[args.timeframe||"1h"]?.candles||m?.candles||[]).slice(-30);
      if(c.length<20)return {status:"blocked",reason:"insufficient_closed_bars",regime:null};
      const spreadBps=Number(m?.spreadBps);
      const analysis=analyzeMarketRegime(c,{spreadBps});
      return {status:"ok",regime:{symbol,...analysis,asOf:m.updatedAt||m.syncedAt}};
    }
  },
  {
    skillId:"skill_native_execution_quality",name:"执行质量分析",toolName:"execution_quality",version:"1.0.0",permissions:["account.read"],freshnessMs:300000,failClosed:false,
    description:"分析滑点、部分成交与保护覆盖率。",schema:{type:"object",properties:{}},outputSchema:{type:"object",required:["status","metrics"]},async handler(db){const metrics=buildExecutionQuality(db);return {status:metrics.fills?"ok":"insufficient_sample",metrics};}
  },
  {
    skillId:"skill_native_drift",name:"交易复盘与漂移检测",toolName:"strategy_drift",version:"1.0.0",permissions:["account.read"],freshnessMs:3600000,failClosed:false,
    description:"比较近期与历史成交表现，区分策略表现漂移和执行恶化。",schema:{type:"object",properties:{strategy:{type:"string"}}},outputSchema:{type:"object",required:["status","diagnosis"]},async handler(db,args){
      // v1.1:漂移判定加 Welch t 检验——只在近期与基线期望差异"统计显著(|t|≥2≈p<0.05)"且近期更弱时才标漂移,避免小样本波动误报。
      let f=(db.fills||[]).filter(x=>x.kind==="close"&&Number.isFinite(Number(x.realizedPnl)));
      if(args.strategy)f=f.filter(x=>x.strategy===args.strategy);
      const vals=f.map(x=>Number(x.realizedPnl)),recent=vals.slice(0,10),base=vals.slice(10,40);
      const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
      const variance=(a,m)=>a.length>1?a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1):null;
      const rm=mean(recent),bm=mean(base);
      let tStat=null,significant=false;
      if(recent.length>=5&&base.length>=5&&rm!==null&&bm!==null){const vr=variance(recent,rm),vb=variance(base,bm);const se=Math.sqrt((vr/recent.length)+(vb/base.length));tStat=se>0?Number(((rm-bm)/se).toFixed(2)):null;significant=tStat!==null&&Math.abs(tStat)>=2;}
      const performanceDrift=significant&&rm<bm;
      return {status:f.length<20?"insufficient_sample":"ok",diagnosis:{trades:f.length,recentExpectancy:rm,baselineExpectancy:bm,tStat,significant,performanceDrift,note:!significant?"近期与基线差异不显著,可能只是正常波动":performanceDrift?"近期显著弱于基线,存在表现漂移":"近期显著强于基线",executionQuality:buildExecutionQuality(db)}};}
  },
  {
    skillId:"skill_native_exchange_degrade",name:"交易所故障降级",toolName:"exchange_degradation",version:"1.0.0",permissions:["market.read","account.read"],freshnessMs:15000,failClosed:true,
    description:"统一判断行情断流、私有 WS、对账、UNKNOWN 订单与 SLO 违约并给出降级模式。",schema:{type:"object",properties:{}},outputSchema:{type:"object",required:["status","mode","reasons"]},async handler(db){const slo=buildSloReport(db);const reasons=[];if(slo.status==="breached")reasons.push("slo_breached");if((db.realtimeConnections||[]).some(x=>x.streamType==="private"&&x.status!=="connected"))reasons.push("private_ws_disconnected");if((db.executionOrders||[]).some(x=>String(x.status).toUpperCase()==="UNKNOWN"))reasons.push("unknown_order_state");return {status:reasons.length?"degraded":"ok",mode:reasons.length?"reduce_only":"normal",reasons,slo};}
  }
];

// 把原生技能登记进 db.skills（幂等），走既有"扫描→安装"审批流程后才启用。
export function seedSkillTools(db) {
  db.skills ||= [];
  for (const tool of SKILL_TOOLS) {
    const existing = db.skills.find((s) => s.id === tool.skillId);
    if (existing) {
      // 迁移:早期原生工具被种成「已拉取/未扫描」而从未启用 → agent 一个内置工具都调不了。
      // 内置工具是第一方只读分析代码,无需扫描→安装闸(那是给不可信导入 skill 的);
      // 只升级从未被人工改动过的默认态,尊重用户手动停用的选择。
      if (existing.native && existing.status === "已拉取" && existing.scan === "未扫描") {
        existing.status = "已启用";
        existing.scan = "内置免扫描";
        existing.enabled = true;
      }
      if (existing.native && existing.kind !== "tool") existing.kind = "tool";
      continue;
    }
    db.skills.push({
      id: tool.skillId,
      name: tool.name,
      toolName: tool.toolName,
      kind: "tool", // 原生技能=Agent 可调用的分析/执行工具,归能力库
      native: true,
      source: "built-in",
      version: tool.version || "1.0.0",
      format: "native",
      entryFile: "native",
      // 第一方内置工具默认启用(只读分析,无写权限);扫描→安装闸只对导入 skill 生效。
      status: "已启用",
      scan: "内置免扫描",
      enabled: true,
      permissions: tool.permissions,
      description: tool.description,
      inputSchema: tool.schema,
      outputSchema: tool.outputSchema || { type: "object" },
      freshnessMs: tool.freshnessMs || 60000,
      failClosed: tool.failClosed === true,
      fetchedAt: nowIso()
    });
  }
}

// 受信任导入 skill 的工具名(稳定、合法标识符)
export function importedToolName(skill) {
  return `imported_${String(skill.id).replace(/[^a-zA-Z0-9]/g, "").slice(-20)}`;
}

export function isSkillTool(name) {
  return SKILL_TOOLS.some((t) => t.toolName === name);
}

// 只返回"已启用"的内置原生工具供 LLM 调用。受信任的导入 skill 走"方法论注入提示词"(见 trustedSkillMethodologies),不作为可调工具。
export function enabledSkillTools(db) {
  const enabled = new Set((db.skills || []).filter((s) => s.native && s.status === "已启用").map((s) => s.id));
  return SKILL_TOOLS.filter((t) => enabled.has(t.skillId)).map((t) => ({ name: t.toolName, description: t.description, schema: t.schema }));
}

// 受信任导入 skill 的方法论:注入 AI 决策提示词。转正/试用如实分层标注。
export function trustedSkillMethodologies(db) {
  return (db.skills || [])
    .filter((s) => !s.native && s.trusted && s.instructions)
    .map((s) => ({ id: s.id, name: s.name, graduated: s.trustStatus === "active", instructions: String(s.instructions).slice(0, 3000) }));
}

export async function runSkillTool(db, name, args = {}) {
  const tool = SKILL_TOOLS.find((t) => t.toolName === name);
  if (!tool) return { error: `未知技能工具：${name}` };
  const skill = (db.skills || []).find((s) => s.id === tool.skillId);
  if (!skill || skill.status !== "已启用") return { error: `技能「${tool.name}」未启用，无法调用` };
  skill.lastCalledAt = nowIso();
  skill.evalMetrics ||= { calls: 0, passed: 0, blocked: 0, failed: 0 };
  skill.evalMetrics.calls += 1;
  const symbol = args.symbol ? String(args.symbol).toUpperCase() : null;
  const market = symbol ? (db.markets || []).find((m) => m.symbol === symbol) : null;
  const observedAt = market?.lastRealtimeAt || market?.updatedAt || market?.syncedAt || market?.microSyncedAt || market?.lastSyncedAt;
  const dataAgeMs = observedAt ? Date.now() - new Date(observedAt).getTime() : null;
  if (tool.failClosed && symbol && (!market || dataAgeMs === null || dataAgeMs > tool.freshnessMs)) {
    skill.evalMetrics.blocked += 1;
    return { status: "blocked", error: "stale_or_missing_market_data", dataAgeMs, freshnessMs: tool.freshnessMs };
  }
  try {
    const result = await tool.handler(db, args);
    const missing = (tool.outputSchema?.required || []).filter((key) => result?.[key] === undefined);
    if (missing.length) {
      skill.evalMetrics.failed += 1;
      return { status: "blocked", error: "output_schema_violation", missing };
    }
    if (["blocked", "degraded"].includes(result?.status)) skill.evalMetrics.blocked += 1;
    else skill.evalMetrics.passed += 1;
    return { ...result, contract: { version: tool.version || "1.0.0", dataAgeMs, freshnessMs: tool.freshnessMs, failClosed: tool.failClosed === true } };
  } catch (error) {
    skill.evalMetrics.failed += 1;
    return { status: tool.failClosed ? "blocked" : "error", error: error.message };
  }
}
