import { getHistoricalKlines, syncMicrostructure } from "./exchangeConnector.mjs";
import { activeMandate, nowIso } from "./store.mjs";

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

export const SKILL_TOOLS = [
  {
    skillId: "skill_native_mtf",
    name: "多周期趋势对齐",
    toolName: "mtf_trend_alignment",
    permissions: ["market.read"],
    description: "在 1h/4h/1d 三个周期判断趋势方向是否一致。多周期一致时趋势信号更可靠；不一致时应谨慎。内置 sync_market 只看单周期，这个技能补多周期确认。",
    schema: { type: "object", properties: { symbol: { type: "string", description: "交易对，如 BTC/USDT" } }, required: ["symbol"] },
    async handler(db, args) {
      const symbol = String(args.symbol || "BTC/USDT").toUpperCase();
      const tfs = ["1h", "4h", "1d"];
      const timeframes = {};
      for (const tf of tfs) {
        try {
          const candles = await getHistoricalKlines(symbol, tf, 60);
          const closes = candles.map((c) => Number(c.close));
          if (closes.length < 20) { timeframes[tf] = { error: "K线不足" }; continue; }
          const sma = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
          const smaEarlier = closes.slice(-40, -20).reduce((a, b) => a + b, 0) / 20;
          const last = closes[closes.length - 1];
          timeframes[tf] = { close: round(last, last), sma20: round(sma, last), trend: last > sma ? "up" : "down", slope: sma > smaEarlier ? "rising" : "falling" };
        } catch (error) {
          timeframes[tf] = { error: error.message };
        }
      }
      const dirs = Object.values(timeframes).map((t) => t.trend).filter(Boolean);
      const aligned = dirs.length === tfs.length && dirs.every((d) => d === dirs[0]);
      return { symbol, timeframes, aligned, direction: aligned ? dirs[0] : "mixed", note: aligned ? `三周期一致${dirs[0] === "up" ? "多头" : "空头"}，趋势信号较强` : "多周期方向不一致，趋势信号弱，宜观望或降杠杆" };
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
      const list = mandateSymbols(db, args.symbols).slice(0, 8);
      const rows = [];
      for (const symbol of list) {
        try {
          const m = await syncMicrostructure(db, "OKX", symbol);
          rows.push({ symbol, fundingRatePct: m.fundingRatePct, bookImbalancePct: m.bookImbalancePct, crowded: Math.abs(Number(m.fundingRatePct) || 0) >= 0.05 });
        } catch { /* 单个失败跳过 */ }
      }
      rows.sort((a, b) => Math.abs(Number(b.fundingRatePct) || 0) - Math.abs(Number(a.fundingRatePct) || 0));
      const extremes = rows.filter((r) => r.crowded);
      return { scanned: rows.length, extremes, all: rows, note: extremes.length ? `${extremes.map((e) => e.symbol).join("、")} 资金费率偏极端，警惕反向挤压` : "无明显资金费率拥挤" };
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
  }
];

// 把原生技能登记进 db.skills（幂等），走既有"扫描→安装"审批流程后才启用。
export function seedSkillTools(db) {
  db.skills ||= [];
  for (const tool of SKILL_TOOLS) {
    if (db.skills.some((s) => s.id === tool.skillId)) continue;
    db.skills.push({
      id: tool.skillId,
      name: tool.name,
      toolName: tool.toolName,
      native: true,
      source: "built-in",
      version: "1.0.0",
      format: "native",
      entryFile: "native",
      status: "已拉取",
      scan: "未扫描",
      permissions: tool.permissions,
      description: tool.description,
      fetchedAt: nowIso()
    });
  }
}

// 受信任导入 skill 的工具名(稳定、合法标识符)
export function importedToolName(skill) {
  return `imported_${String(skill.id).replace(/[^a-zA-Z0-9]/g, "").slice(-20)}`;
}

export function isSkillTool(name) {
  return SKILL_TOOLS.some((t) => t.toolName === name) || String(name).startsWith("imported_");
}

// 返回可挂进 LLM 工具表的技能:①已启用的内置原生工具 ②用户点了"信任"且扫描通过的导入 skill。
export function enabledSkillTools(db) {
  const enabled = new Set((db.skills || []).filter((s) => s.native && s.status === "已启用").map((s) => s.id));
  const native = SKILL_TOOLS.filter((t) => enabled.has(t.skillId)).map((t) => ({ name: t.toolName, description: t.description, schema: t.schema }));
  const trusted = (db.skills || [])
    .filter((s) => !s.native && s.trusted && ["通过", "需复核"].includes(s.scan))
    .map((s) => ({
      name: importedToolName(s),
      description: `【导入·受信任·未经系统回测,当顾问参考】${s.name}：${s.description || "用户导入的分析/决策 skill,在沙箱内运行返回结果"}。它的信号只是参考,是否下单仍由你判断并过硬风控。`,
      schema: { type: "object", properties: { symbol: { type: "string", description: "交易对,如 BTC/USDT" } } }
    }));
  return [...native, ...trusted];
}

export async function runSkillTool(db, name, args = {}) {
  // 导入的受信任 skill:沙箱运行,输出作为顾问数据返回(不能直接下单)。
  if (String(name).startsWith("imported_")) {
    const skill = (db.skills || []).find((s) => !s.native && s.trusted && importedToolName(s) === name);
    if (!skill) return { error: `受信任导入技能未找到或已撤信任：${name}` };
    skill.invocations = Number(skill.invocations || 0) + 1;
    skill.lastCalledAt = nowIso();
    try {
      const { runSkillSandbox } = await import("./skillSandbox.mjs");
      const run = await runSkillSandbox(db, skill.id, { symbol: args.symbol });
      return { skill: skill.name, sandboxStatus: run.status, output: String(run.output || "").slice(0, 2000), note: "导入 skill 沙箱输出,仅供参考,未经系统验证" };
    } catch (error) {
      return { error: `沙箱运行失败：${error.message}` };
    }
  }
  const tool = SKILL_TOOLS.find((t) => t.toolName === name);
  if (!tool) return { error: `未知技能工具：${name}` };
  const skill = (db.skills || []).find((s) => s.id === tool.skillId);
  if (!skill || skill.status !== "已启用") return { error: `技能「${tool.name}」未启用，无法调用` };
  skill.lastCalledAt = nowIso();
  try {
    return await tool.handler(db, args);
  } catch (error) {
    return { error: error.message };
  }
}
