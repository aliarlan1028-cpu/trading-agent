import assert from "node:assert/strict";
import test from "node:test";

import { buildAiDomainModel, missionStagePresentation } from "../src/kordynV2/domains/ai/aiModel.js";

const expectedStages = Object.freeze({
  intent: ["正在理解任务", "working"],
  sense: ["正在检查市场", "working"],
  recall: ["正在核对相关证据", "working"],
  plan: ["正在形成下一步计划", "working"],
  guard: ["正在验证风险边界", "attention"],
  approval: ["需要你确认", "approval"],
  execute: ["正在等待权威执行结果", "working"],
  monitor: ["正在监控结果", "monitoring"],
  review: ["正在整理复盘证据", "reviewing"]
});

test("AI model preserves mission identity and uses product-language stages", () => {
  const run = {
    id: "run-1",
    agentRunId: "run-1",
    role: "AI 交易员",
    goal: "BTC 计划复核",
    status: "awaiting_approval",
    tradePlanId: "plan-1",
    steps: [
      { id: "step-risk", agentRunId: "run-1", phase: "risk_checking", title: "硬风控检查", summary: "风险边界通过" },
      { id: "step-approval", agentRunId: "run-1", phase: "awaiting_approval", title: "等待人工确认", summary: "达到人工确认阈值" }
    ]
  };
  const plan = {
    id: "plan-1",
    agentRunId: "run-1",
    status: "awaiting_approval",
    symbol: "BTC/USDT",
    evidenceIds: ["market-btc", "risk-btc"]
  };

  const model = buildAiDomainModel({ agentRuns: [run], tradePlans: [plan] });

  assert.equal(model.missions[0].id, "run-1");
  assert.equal(Object.hasOwn(model.missions[0], "source"), false);
  assert.equal(model.missions[0].title, "BTC 计划复核");
  assert.equal(model.missions[0].summary, "达到人工确认阈值");
  assert.equal(model.missions[0].stage.id, "approval");
  assert.equal(model.missions[0].stage.label, "需要你确认");
  assert.equal(model.missions[0].approval.planId, "plan-1");
  assert.equal(Object.hasOwn(model.missions[0].approval, "source"), false);
  assert.equal(model.missions[0].evidenceCount, 2);
  assert.equal(model.missions[0].nextAction, "Unavailable");
  assert.doesNotMatch(model.missions[0].stage.label, /Guard|Sense|Recall/i);
});

test("compact and full production Agent-run projections retain goal and step facts", () => {
  const model = buildAiDomainModel({
    agentRuns: [
      {
        id: "run-compact",
        traceId: "run-compact",
        source: "chat",
        role: "AI 交易员",
        status: "running",
        steps: [{
          id: "step-capability",
          phase: "capability_preflight",
          title: "必需能力覆盖",
          status: "completed",
          createdAt: "2026-08-28T03:00:00.000Z"
        }]
      },
      {
        id: "run-full",
        traceId: "run-full",
        source: "chat",
        role: "AI 交易员",
        goal: "ETH 强制证据复核",
        status: "completed",
        steps: [{
          id: "step-evidence",
          phase: "forced_evidence",
          title: "强制事实证据包",
          summary: "关键证据齐全",
          createdAt: "2026-08-28T03:01:00.000Z"
        }]
      }
    ]
  });

  assert.deepEqual(model.missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    summary: mission.summary,
    stage: mission.stage.id,
    nextAction: mission.nextAction
  })), [
    { id: "run-compact", title: "必需能力覆盖", summary: "Unavailable", stage: "recall", nextAction: "Unavailable" },
    { id: "run-full", title: "ETH 强制证据复核", summary: "关键证据齐全", stage: "review", nextAction: "Unavailable" }
  ]);
});

test("unknown Agent-run status and step phase cannot invent a mission stage", () => {
  const model = buildAiDomainModel({
    agentRuns: [{
      id: "run-unknown-stage",
      status: "model_supplied_status",
      steps: [{ phase: "model_supplied_phase", title: "模型自报阶段" }]
    }]
  });

  assert.deepEqual(model.missions[0].stage, { id: null, label: "Unavailable", tone: "unavailable" });
});

test("explicit Agent-run tradePlanId wins over plan array order", () => {
  const model = buildAiDomainModel({
    agentRuns: [{ id: "run-explicit", tradePlanId: "plan-explicit", status: "awaiting_approval" }],
    tradePlans: [
      { id: "plan-array-first", agentRunId: "run-explicit", status: "awaiting_approval" },
      { id: "plan-explicit", agentRunId: "run-other", status: "awaiting_approval" }
    ]
  });

  assert.equal(model.missions[0].approval.planId, "plan-explicit");
});

test("ambiguous and duplicate plan identities cannot select an approval action", () => {
  const ambiguous = buildAiDomainModel({
    agentRuns: [{ id: "run-ambiguous", status: "running" }],
    tradePlans: [
      { id: "plan-a", agentRunId: "run-ambiguous", status: "awaiting_approval" },
      { id: "plan-b", agentRunId: "run-ambiguous", status: "awaiting_approval" }
    ]
  });
  const duplicate = buildAiDomainModel({
    agentRuns: [{ id: "run-duplicate-plan", tradePlanId: "plan-duplicate", status: "awaiting_approval" }],
    tradePlans: [
      { id: "plan-duplicate", agentRunId: "run-duplicate-plan", status: "awaiting_approval" },
      { id: "plan-duplicate", agentRunId: "run-other", status: "cancelled" }
    ]
  });
  const uniqueFallback = buildAiDomainModel({
    agentRuns: [{ id: "run-unique", status: "running" }],
    tradePlans: [{ id: "plan-unique", agentRunId: "run-unique", status: "awaiting_approval" }]
  });

  assert.equal(ambiguous.missions[0].approval, null);
  assert.equal(duplicate.missions[0].approval, null);
  assert.equal(uniqueFallback.missions[0].approval.planId, "plan-unique");
});

test("duplicate Agent-run identities fail closed instead of creating two missions", () => {
  const model = buildAiDomainModel({
    agentRuns: [
      { id: "run-duplicate", status: "running", goal: "first" },
      { id: "run-duplicate", status: "completed", goal: "second" }
    ]
  });

  assert.deepEqual(model.missions, []);
});

test("JSON prototype keys cannot fabricate mission or selectable intelligence identity", () => {
  const parsed = JSON.parse(`{
    "agentRuns": [
      { "__proto__": { "id": "run-proto", "goal": "forged goal", "status": "running" } },
      { "constructor": { "id": "run-constructor" }, "goal": "constructor row" },
      { "toString": { "id": "run-to-string" }, "goal": "toString row" }
    ],
    "newsFeed": [
      { "__proto__": { "id": "news-proto" }, "title": "forged news" },
      { "constructor": { "id": "news-constructor" }, "title": "constructor news" },
      { "toString": { "id": "news-to-string" }, "title": "toString news" }
    ]
  }`);

  const model = buildAiDomainModel(parsed);

  assert.deepEqual(model.missions, []);
  assert.equal(model.intelligence.length, 3);
  assert.deepEqual(model.intelligence.map((row) => ({
    id: row.id,
    identity: row.identity,
    selectable: row.selectable
  })), [
    { id: null, identity: "Unavailable", selectable: false },
    { id: null, identity: "Unavailable", selectable: false },
    { id: null, identity: "Unavailable", selectable: false }
  ]);
});

test("every technical mission stage maps to the exact primary product language", () => {
  for (const [technicalStage, [label, tone]] of Object.entries(expectedStages)) {
    assert.deepEqual(missionStagePresentation(technicalStage.toUpperCase()), {
      id: technicalStage,
      label,
      tone
    });
  }
});

test("prototype keys and prototype pollution cannot become mission stage labels", () => {
  const pollutedKey = "polluted_ai_stage";
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, pollutedKey);
  Object.defineProperty(Object.prototype, pollutedKey, {
    configurable: true,
    value: ["伪造阶段", "approval"]
  });
  try {
    for (const hostileStage of ["__proto__", "constructor", "toString", pollutedKey]) {
      const presentation = missionStagePresentation(hostileStage);
      assert.equal(presentation.label, "Unavailable");
      assert.equal(presentation.tone, "unavailable");
    }
  } finally {
    if (previous) Object.defineProperty(Object.prototype, pollutedKey, previous);
    else delete Object.prototype[pollutedKey];
  }
});

test("missing and malformed mission facts remain unavailable", () => {
  const model = buildAiDomainModel({
    agentRuns: [
      { id: "run-missing" },
      { id: "run-malformed", stage: { name: "guard" }, evidenceCount: "0", nextAction: { label: "approve" } },
      { id: "run-negative", evidenceCount: -1 },
      { id: "run-bad-evidence", evidenceIds: [" evidence-with-whitespace "] },
      { id: " run-spaced " },
      { id: "" },
      null
    ]
  });

  assert.equal(model.missions.length, 4);
  for (const mission of model.missions) {
    assert.equal(mission.stage.label, "Unavailable");
    assert.equal(mission.evidenceCount, "Unavailable");
    assert.equal(mission.nextAction, "Unavailable");
  }
  assert.equal(model.missions.some((mission) => mission.id === ""), false);
});

test("model identity grammar rejects whitespace and controls across runs, plans, traces, and signals", () => {
  const model = buildAiDomainModel({
    agentRuns: [
      { id: "run 1", goal: "space" },
      { id: "run\n1", goal: "newline" },
      { id: "run\t1", goal: "tab" },
      { id: "run\u00851", goal: "unicode control" },
      { id: "run-plan", tradePlanId: "plan 1", status: "awaiting_approval" },
      { id: "run-trace", status: "running" }
    ],
    tradePlans: [{ id: "plan 1", agentRunId: "run-plan", status: "awaiting_approval" }],
    traces: [{ agentRunId: "run-trace", evidenceId: "evidence 1" }],
    newsFeed: [{ id: "news 1", title: "news" }],
    events: [{ id: "event\n1", title: "CPI", due: "2026-09-01T12:30:00.000Z" }],
    marketMovers: { movers: [{ instId: "ETH USDT SWAP", symbol: "ETH /USDT", changePct: 8 }] },
    knowledge: { sources: [{ id: "knowledge\t1", title: "guide" }] }
  });

  assert.deepEqual(model.missions.map((mission) => mission.id), ["run-plan", "run-trace"]);
  assert.equal(model.missions[0].approval, null);
  assert.equal(model.missions[1].evidenceCount, "Unavailable");
  assert.equal(model.intelligence.length, 4);
  for (const row of model.intelligence) {
    assert.equal(row.id, null);
    assert.equal(row.identity, "Unavailable");
    assert.equal(row.selectable, false);
  }
});

test("AI model reuses patrol and event truth selectors without inventing unavailable rows", () => {
  const model = buildAiDomainModel({
    chatMessages: [{
      id: "message-patrol",
      sessionId: "chat_autocycle",
      capabilityCoverage: {
        ok: true,
        checkedAt: "2026-08-28T03:00:00.000Z",
        covered: 2,
        required: 2,
        missing: [],
        whitelist: { analyzed: 1, expected: 1, symbols: ["BTC/USDT"] },
        watches: { analyzed: 0, expected: 0, symbols: [] },
        marketScan: { completed: true, universe: 100, candidates: 3 },
        externalCandidates: []
      },
      presentation: {
        headline: "本轮证据齐备",
        nextAction: { code: "analysis_only", detail: null },
        linked: {}
      },
      toolTrace: [],
      toolCallSummary: { totalCalls: 0, modelCalls: 0, preflightCalls: 0 }
    }],
    events: [{ id: "event-1", title: "CPI", due: "2026-09-01T12:30:00.000Z", impact: 80 }],
    marketCalendarEvents: [{
      id: "official-1",
      title: "FOMC",
      startAt: "2026-09-02T18:00:00.000Z",
      importance: "high",
      sourceName: "Federal Reserve",
      symbols: ["BTC/USDT"],
      timePrecision: "datetime"
    }]
  });

  assert.equal(model.patrols.length, 1);
  assert.equal(model.patrols[0].kind, "autonomous_patrol");
  assert.equal(model.patrols[0].scope.evidence.value, 2);
  assert.deepEqual(model.events.map((event) => event.id), ["event-1", "official-1"]);
  assert.equal(model.events[1].source, "events");
  assert.equal(model.events[1].provider, "Federal Reserve");
});

test("intelligence preserves the deployed news, event, mover, and knowledge union", () => {
  const model = buildAiDomainModel({
    newsFeed: [{
      id: "fact-news-1",
      type: "news",
      category: "flash_news",
      sourceId: "me_news_flash",
      sourceName: "ME News 快讯",
      externalId: "external-77",
      title: "CPI 快讯",
      symbols: ["BTC/USDT"],
      observedAt: "2026-08-28T03:00:00.000Z"
    }],
    events: [{ id: "event-cpi", title: "CPI", due: "2026-09-01T12:30:00.000Z", impact: 80 }],
    marketMovers: {
      scannedAt: "2026-08-28T03:01:00.000Z",
      movers: [{ instId: "ETH-USDT-SWAP", symbol: "ETH/USDT", changePct: 7.4, quoteVolUsdt: 9000000 }]
    },
    knowledge: {
      sources: [{ id: "knowledge-volatility", title: "Volatility regime guide", status: "parsed" }],
      tradingSkills: []
    }
  });

  assert.deepEqual(model.intelligence.map((row) => ({
    id: row.id,
    identity: row.identity,
    kind: row.kind,
    source: row.source,
    selectable: row.selectable,
    title: row.title,
    symbol: row.symbol
  })), [
    { id: "fact-news-1", identity: "fact-news-1", kind: "news", source: "newsFeed", selectable: true, title: "CPI 快讯", symbol: undefined },
    { id: "event-cpi", identity: "event-cpi", kind: "event", source: "events", selectable: true, title: "CPI", symbol: undefined },
    { id: "ETH-USDT-SWAP", identity: "ETH-USDT-SWAP", kind: "market_mover", source: "marketMovers.movers", selectable: true, title: undefined, symbol: "ETH/USDT" },
    { id: "knowledge-volatility", identity: "knowledge-volatility", kind: "knowledge", source: "knowledge", selectable: true, title: "Volatility regime guide", symbol: undefined }
  ]);
  assert.equal(model.intelligence[1], model.events[0]);
});

test("intelligence without authoritative identity stays unavailable and non-selectable", () => {
  const model = buildAiDomainModel({
    newsFeed: [{ title: "Unidentified news" }],
    events: [{ title: "Unidentified event", due: "2026-09-01T12:30:00.000Z" }],
    marketMovers: { movers: [{ changePct: 9 }] },
    knowledge: { sources: [{ title: "Unidentified knowledge" }] }
  });

  assert.equal(model.intelligence.length, 4);
  for (const row of model.intelligence) {
    assert.equal(row.id, null);
    assert.equal(row.identity, "Unavailable");
    assert.equal(row.selectable, false);
  }
  assert.equal(model.intelligence.some((row) => /^(?:flash|event|mover|knowledge)-\d+$/.test(String(row.id))), false);
});

test("event registry and intelligence share one deduplicated event truth projection", () => {
  const model = buildAiDomainModel({
    events: [{ id: "event-fomc", title: "FOMC", due: "2026-09-02T18:00:00.000Z", source: "events-api" }],
    marketCalendarEvents: [{
      id: "official-fomc-duplicate",
      title: "FOMC",
      startAt: "2026-09-02T18:00:00.000Z",
      sourceName: "Federal Reserve",
      symbols: ["BTC/USDT"],
      importance: "high",
      timePrecision: "datetime"
    }]
  });

  const intelligenceEvents = model.intelligence.filter((row) => row.kind === "event");
  assert.equal(model.events.length, 1);
  assert.equal(intelligenceEvents.length, 1);
  assert.equal(intelligenceEvents[0], model.events[0]);
});

test("semantic event duplicates prefer the one uniquely identified row in either input order", () => {
  const unidentified = { title: "CPI", due: "2026-09-01T12:30:00.000Z", impact: 55, description: "unidentified" };
  const authoritative = { id: "event-cpi-authoritative", title: "CPI", due: "2026-09-01T12:30:00.000Z", impact: 80, description: "authoritative" };

  for (const events of [
    [unidentified, authoritative],
    [authoritative, unidentified]
  ]) {
    const model = buildAiDomainModel({ events });
    const intelligenceEvents = model.intelligence.filter((row) => row.kind === "event");
    assert.equal(model.events.length, 1);
    assert.equal(model.events[0].id, "event-cpi-authoritative");
    assert.equal(model.events[0].description, "authoritative");
    assert.equal(model.events[0].selectable, true);
    assert.equal(intelligenceEvents.length, 1);
    assert.equal(intelligenceEvents[0], model.events[0]);
  }
});

test("one canonical ID repeated across distinct events stays visible but never selectable", () => {
  const model = buildAiDomainModel({
    events: [
      { id: "event-repeated", title: "CPI", due: "2026-09-01T12:30:00.000Z", impact: 80 },
      { id: "event-repeated", title: "FOMC", due: "2026-09-02T18:00:00.000Z", impact: 90 }
    ]
  });
  const intelligenceEvents = model.intelligence.filter((row) => row.kind === "event");

  assert.equal(model.events.length, 2);
  assert.deepEqual(model.events.map((row) => ({ id: row.id, identity: row.identity, selectable: row.selectable })), [
    { id: null, identity: "Unavailable", selectable: false },
    { id: null, identity: "Unavailable", selectable: false }
  ]);
  assert.equal(intelligenceEvents[0], model.events[0]);
  assert.equal(intelligenceEvents[1], model.events[1]);
});

test("malformed patrol and event collection rows fail closed without hiding valid rows", () => {
  const throwingMessage = {};
  Object.defineProperty(throwingMessage, "sessionId", { enumerable: true, get() { throw new Error("message getter invoked"); } });
  const throwingEvent = {};
  Object.defineProperty(throwingEvent, "title", { enumerable: true, get() { throw new Error("event getter invoked"); } });
  const sparseMessages = [];
  sparseMessages[1] = null;
  sparseMessages[3] = "not-a-message";
  sparseMessages[4] = throwingMessage;
  sparseMessages[5] = {
    sessionId: "chat_autocycle",
    capabilityCoverage: {
      ok: true,
      covered: 1,
      required: 1,
      whitelist: { analyzed: 1, expected: 1, symbols: { malformed: true } },
      watches: { analyzed: 0, expected: 0, symbols: [] },
      marketScan: { completed: true }
    }
  };
  sparseMessages[7] = {
    id: "message-valid",
    sessionId: "chat_autocycle",
    capabilityCoverage: {
      ok: true,
      covered: 1,
      required: 1,
      missing: [],
      whitelist: { analyzed: 1, expected: 1, symbols: ["BTC/USDT"] },
      watches: { analyzed: 0, expected: 0, symbols: [] },
      marketScan: { completed: true, universe: 100, candidates: 1 },
      externalCandidates: []
    },
    presentation: { headline: "valid patrol", nextAction: null, linked: {} },
    toolTrace: [],
    toolCallSummary: { totalCalls: 0, modelCalls: 0, preflightCalls: 0 }
  };

  let model;
  assert.doesNotThrow(() => {
    model = buildAiDomainModel({
      chatMessages: sparseMessages,
      events: [null, , "not-an-event", throwingEvent, { id: "event-valid", title: "CPI", due: "2026-09-01T12:30:00.000Z" }],
      marketCalendarEvents: [null, 7, { title: null }, { id: "official-valid", title: "FOMC", startAt: "2026-09-02T18:00:00.000Z", sourceName: "Federal Reserve", symbols: [] }]
    });
  });
  assert.deepEqual(model.patrols.map((patrol) => patrol.headline), ["valid patrol"]);
  assert.deepEqual(model.events.map((event) => event.id), ["event-valid", "official-valid"]);
});

test("array projection uses own data descriptors without invoking iterators or indexed getters", () => {
  let iteratorReads = 0;
  let indexedGetterReads = 0;
  let proxyGets = 0;
  const agentRuns = [{ id: "run-descriptor", goal: "descriptor mission", status: "running" }];
  Object.defineProperty(agentRuns, Symbol.iterator, {
    configurable: true,
    get() { iteratorReads += 1; throw new Error("iterator accessed"); }
  });
  const newsFeed = [];
  Object.defineProperty(newsFeed, "0", {
    configurable: true,
    enumerable: true,
    get() { indexedGetterReads += 1; throw new Error("indexed getter accessed"); }
  });
  newsFeed[2] = { id: "news-descriptor", title: "valid descriptor news" };
  const events = new Proxy([{ id: "event-descriptor", title: "CPI", due: "2026-09-01T12:30:00.000Z" }], {
    get() { proxyGets += 1; throw new Error("proxy get accessed"); }
  });

  let model;
  assert.doesNotThrow(() => {
    model = buildAiDomainModel({ agentRuns, newsFeed, events });
  });
  assert.equal(iteratorReads, 0);
  assert.equal(indexedGetterReads, 0);
  assert.equal(proxyGets, 0);
  assert.deepEqual(model.missions.map((mission) => mission.id), ["run-descriptor"]);
  assert.deepEqual(model.intelligence.map((row) => row.id), ["news-descriptor", "event-descriptor"]);
});

test("array descriptor failure closes only that collection without escaping the model", () => {
  let descriptorTraps = 0;
  const brokenAgentRuns = new Proxy([], {
    ownKeys() { descriptorTraps += 1; throw new Error("descriptor trap"); }
  });

  let model;
  assert.doesNotThrow(() => {
    model = buildAiDomainModel({
      agentRuns: brokenAgentRuns,
      newsFeed: [{ id: "news-survives", title: "independent valid fact" }]
    });
  });
  assert.equal(descriptorTraps, 1);
  assert.deepEqual(model.missions, []);
  assert.deepEqual(model.intelligence.map((row) => row.id), ["news-survives"]);
});

test("projected collections are detached and frozen at presenter boundaries", () => {
  const input = {
    agentRuns: [{ id: "run-frozen", goal: "冻结边界", status: "awaiting_approval", tradePlanId: "plan-frozen" }],
    tradePlans: [{ id: "plan-frozen", agentRunId: "run-frozen", status: "awaiting_approval" }],
    watchTriggers: [{ id: "watch-frozen", symbol: "BTC/USDT", conditions: { tags: ["fast_move"] } }],
    newsFeed: [{ id: "news-frozen", title: "CPI", symbols: ["BTC/USDT"] }],
    events: [{ id: "event-frozen", title: "FOMC", due: "2026-09-02T18:00:00.000Z", relatedSymbols: ["BTC/USDT"] }],
    marketMovers: { movers: [{ instId: "ETH-USDT-SWAP", symbol: "ETH/USDT", narrative: { drivers: ["volume"] } }] },
    knowledge: { sources: [{ id: "knowledge-frozen", title: "Guide", metadata: { tags: ["risk"] } }] }
  };
  const original = structuredClone(input);
  const model = buildAiDomainModel(input);

  for (const collection of [model.missions, model.patrols, model.intelligence, model.watches, model.events]) {
    assert.equal(Object.isFrozen(collection), true);
  }
  assert.equal(Object.hasOwn(model.missions[0], "source"), false);
  assert.equal(Object.hasOwn(model.missions[0].approval, "source"), false);
  assert.notEqual(model.watches[0], input.watchTriggers[0]);
  assert.notEqual(model.watches[0].conditions, input.watchTriggers[0].conditions);
  assert.notEqual(model.intelligence[0].symbols, input.newsFeed[0].symbols);
  assert.equal(Object.isFrozen(model.watches[0].conditions.tags), true);
  assert.equal(Object.isFrozen(model.intelligence[0].symbols), true);
  assert.equal(Object.isFrozen(model.intelligence[3].metadata.tags), true);
  assert.throws(() => model.watches[0].conditions.tags.push("presenter-mutation"), TypeError);
  assert.throws(() => model.intelligence[0].symbols.push("ETH/USDT"), TypeError);
  assert.deepEqual(input, original);
});
