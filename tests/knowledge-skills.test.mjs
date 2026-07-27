import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-skills-test-"));
process.env.DATA_DIR = dataDir;

const {
  approveKnowledgeSkill,
  bindKnowledgeSkillsToPlan,
  compileMethodToSpec,
  compileTradingMethod,
  refreshKnowledgeSkillAttribution,
  retireKnowledgeSkill,
  syncKnowledgeSkillLifecycle,
  validateKnowledgeSkillWithCandles,
  validatePlanKnowledgeSkills
} = await import("../server/knowledgeSkills.mjs");

function dbFixture(direction = "long") {
  const source = { id: "source-1", title: "用户上传的趋势交易书", type: "pdf" };
  const method = {
    id: "method-1",
    name: "唐奇安突破",
    marketRegime: "上行趋势",
    symbolScope: "BTC",
    timeframe: "1H",
    direction,
    entry: "收盘价突破过去20根K线最高价",
    confirmation: "成交量高于20周期均量",
    stop: "入场价下方2%",
    takeProfit: "2R",
    invalidation: "重大事件前不做",
    source: { id: source.id, title: source.title }
  };
  const candles = Array.from({ length: 51 }, (_, index) => ({
    time: index * 3_600_000,
    open: index === 49 ? 110 : 100,
    high: index === 49 ? 111 : 101,
    low: 99,
    close: index === 49 ? 110 : 100,
    volume: index === 49 ? 200 : 100
  }));
  return {
    meta: {},
    auditLogs: [],
    traces: [],
    fills: [],
    tradePlans: [],
    paperSessions: [],
    markets: [{ symbol: "BTC/USDT", candles, candlesTimeframe: "1h" }],
    knowledge: {
      sources: [source],
      chunks: [{ id: "chunk-1", sourceId: source.id, citationLocator: `${source.title} #1` }],
      tradingMethods: [method],
      tradingSkills: [],
      skillInvocations: [],
      skillAttributions: []
    }
  };
}

test("book-title summaries compile but are flagged low-trust (Plan A: safety enforced by validation, not a compile ban)", () => {
  // 方案 A：完整的书名方法可以编译进验证流水线，但必须带 lowTrust 标记 + 严门槛警告。
  const result = compileMethodToSpec({
    id: "m",
    name: "趋势突破",
    direction: "long",
    timeframe: "1H",
    entry: "收盘突破过去20根K线最高价",
    stop: "入场价下方2%",
    takeProfit: "2R"
  }, { id: "s", type: "book_title", title: "只输入书名" });
  assert.equal(result.ok, true);
  assert.equal(result.spec.lowTrust, true);
  assert.match(result.warnings.join(" "), /低信任/);
  assert.match(result.warnings.join(" "), /人工批准/);
});

test("book-title compilation still fails when the method lacks an executable setup", () => {
  // 低信任不等于放水：缺入场/止损/止盈这种无法构造 setup 的硬缺陷依旧编译失败。
  const result = compileMethodToSpec({
    id: "m",
    name: "只有名字",
    direction: "long",
    timeframe: "1H"
  }, { id: "s", type: "book_title", title: "只输入书名" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /入场|止损|止盈|离场/);
});

test("compiled knowledge skills require paper validation and human approval before selection", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  assert.equal(skill.status, "compiled");
  assert.equal(skill.spec.templateId, "breakout");
  assert.throws(() => approveKnowledgeSkill(db, skill.id, "Owner"), /纯前向模拟盘/);

  skill.status = "paper_validating";
  skill.paperSessionId = "paper-1";
  db.paperSessions.push({
    id: "paper-1",
    status: "passed",
    seeded: false,
    knowledgeSkillId: skill.id,
    knowledgeSkillVersion: skill.version,
    timeframe: skill.spec.timeframe,
    params: { compiledSkillFingerprint: skill.fingerprint }
  });
  syncKnowledgeSkillLifecycle(db);
  assert.equal(skill.status, "paper_validated");
  approveKnowledgeSkill(db, skill.id, "Owner", "验证通过");
  assert.equal(skill.status, "active");

  const plan = {
    id: "plan-1",
    symbol: "BTC/USDT",
    direction: "long",
    agentRunId: "run-1",
    entry_range: [100, 100],
    stop_loss: 98,
    take_profit: [104]
  };
  const bindings = bindKnowledgeSkillsToPlan(db, plan, { timeframe: "1h", regime: "上行趋势" });
  assert.equal(bindings.length, 1);
  assert.equal(plan.knowledgeSkills[0].fingerprint, skill.fingerprint);
  assert.equal(validatePlanKnowledgeSkills(db, plan).valid, true);

  db.markets[0].candlesTimeframe = "15m";
  assert.equal(validatePlanKnowledgeSkills(db, plan).valid, false);
  db.markets[0].candlesTimeframe = "1h";
  db.markets[0].candles[49].volume = 50;
  assert.equal(validatePlanKnowledgeSkills(db, plan).valid, false);
  db.markets[0].candles[49].volume = 200;

  retireKnowledgeSkill(db, skill.id, "Owner", "策略失效");
  const afterRetirement = validatePlanKnowledgeSkills(db, plan);
  assert.equal(afterRetirement.valid, false);
  assert.match(afterRetirement.violations.join(" "), /retired/);
});

test("historical validation uses chronological train, validation, and test windows", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1", {
    params: { lookback: 5, stopLossPct: 1, takeProfitR: 1 }
  });
  let base = 100;
  const candles = [];
  for (let index = 0; index < 360; index += 1) {
    if (index > 0 && index % 8 === 0) base *= 1.05;
    const hitTarget = index % 8 === 1;
    candles.push({
      time: index * 60_000,
      open: base,
      high: hitTarget ? base * 1.015 : base * 1.001,
      low: base * 0.999,
      close: base,
      volume: index % 8 === 0 ? 200 : 100
    });
  }
  const result = validateKnowledgeSkillWithCandles(db, skill.id, candles);
  assert.equal(result.passed, true);
  assert.equal(skill.status, "historical_validated");
  assert.equal(skill.validation.methodology, "40/30/30 chronological holdout");
  assert.ok(skill.validation.validation.trades >= 3);
  assert.ok(skill.validation.test.trades >= 3);
});

test("closed-trade attribution degrades an active skill after persistent poor live performance", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  skill.status = "active";
  skill.executable = true;
  skill.approval = { approved: true, fingerprint: skill.fingerprint };
  for (let index = 0; index < 10; index += 1) {
    const plan = {
      id: `plan-loss-${index}`,
      knowledgeSkills: [{ skillId: skill.id, version: skill.version, fingerprint: skill.fingerprint }]
    };
    db.tradePlans.push(plan);
    db.fills.push({
      id: `fill-${index}`,
      kind: "close",
      executionOrderId: `exec-${index}`,
      tradePlanId: plan.id,
      realizedPnl: -1,
      createdAt: new Date(Date.now() + index * 1000).toISOString()
    });
  }
  const result = refreshKnowledgeSkillAttribution(db);
  assert.equal(result.added, 10);
  assert.deepEqual(result.degraded, [skill.id]);
  assert.equal(skill.status, "degraded");
  assert.equal(skill.executable, false);
  assert.equal(skill.liveMetrics.trades, 10);
});

test("止损语义甄别:资金风险%不再被误编为价格止损;日线小止损转 ATR", () => {
  // "风险控制在本金1%"是仓位管理,不是价格距离——旧编译器抓任意百分数当止损距离
  const riskSemantics = compileMethodToSpec({
    id: "m_risk", name: "三重滤网", direction: "long", timeframe: "1d",
    entry: "周线趋势向上时日线回调买入", stop: "单笔亏损控制在本金的1%即离场", takeProfit: "2R"
  }, { id: "s", type: "pdf", title: "以交易为生" });
  assert.equal(riskSemantics.ok, true);
  assert.equal(riskSemantics.spec.params.atrStop, true, "资金风险语义应转 ATR 自适应止损");
  assert.notEqual(riskSemantics.spec.params.stopLossPct, 1, "1% 不得被当作价格止损距离");

  // 明确价格止损但低于日线噪声下限(3%) → 也转 ATR
  const tinyStop = compileMethodToSpec({
    id: "m_tiny", name: "日线突破", direction: "long", timeframe: "1d",
    entry: "突破20日高点", stop: "入场价下方1%", takeProfit: "2R"
  }, { id: "s", type: "pdf", title: "书" });
  assert.equal(tinyStop.spec.params.atrStop, true, "低于周期噪声下限应转 ATR");

  // 明确且合理的价格止损 → 尊重原文
  const explicit = compileMethodToSpec({
    id: "m_ok", name: "小时突破", direction: "long", timeframe: "1H",
    entry: "突破20周期高点", stop: "入场价下方2%", takeProfit: "2R"
  }, { id: "s", type: "pdf", title: "书" });
  assert.equal(explicit.spec.params.stopLossPct, 2);
  assert.ok(!explicit.spec.params.atrStop, "合理的明确价格止损不应被覆盖");
  assert.equal(explicit.spec.compilerRev, 2);
});
