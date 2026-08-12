import assert from "node:assert/strict";
import test from "node:test";

import { parseMeNewsFlashPayload, refreshMeNewsFlash } from "../server/newsFlashFeed.mjs";

function payload(rows) {
  return { code: 200, data: { list: rows } };
}

function row(id, title, options = {}) {
  const epoch = Math.floor((options.at || Date.now()) / 1000);
  return {
    id, title, content: options.content || title, url: `https://example.com/${id}`,
    release_time_stamp: epoch, is_important_flash: options.important ? 1 : 0, category_id: 1
  };
}

function fixture() {
  return {
    meta: {}, system: {}, marketIntelligenceFacts: [], marketIntelligenceSourceHealth: {},
    notifications: [], auditLogs: [], traces: []
  };
}

test("ME 快讯解析保留精确时间、重要标志和关联币种", () => {
  const [item] = parseMeNewsFlashPayload(payload([row(1, "美联储意外降息，比特币与 ETH 波动", { important: true })]));
  assert.equal(item.important, true);
  assert.equal(item.marketRelevant, true);
  assert.deepEqual(item.symbols, ["BTC/USDT", "ETH/USDT"]);
  assert.equal(item.impact, 82);
  assert.match(item.publishedAt, /Z$/);
});
test("首次轮询只建立基线，之后新鲜且重要相关的快讯才排队复核", async () => {
  const db = fixture();
  const baseline = row(10, "比特币市场快讯", { important: true });
  const first = await refreshMeNewsFlash(db, { payload: payload([baseline]) });
  assert.equal(first.urgent.length, 0);
  assert.equal(db.system.pendingNewsSignals?.length || 0, 0);

  const urgent = row(11, "美联储宣布紧急利率决定，比特币快速波动", { important: true });
  const second = await refreshMeNewsFlash(db, { payload: payload([urgent, baseline]) });
  assert.equal(second.urgent.length, 1);
  assert.equal(db.system.pendingNewsSignals.length, 1);
  assert.equal(db.system.pendingNewsSignals[0].mayTriggerTradeDirectly, false);
  assert.equal(db.notifications[0].eventType, "important_news");

  const third = await refreshMeNewsFlash(db, { payload: payload([urgent, baseline]) });
  assert.equal(third.added, 0);
  assert.equal(third.urgent.length, 0);
  assert.equal(db.system.pendingNewsSignals.length, 1);
});

test("泛财经 important 快讯可进入新闻流但不会唤起交易分析", async () => {
  const db = fixture();
  await refreshMeNewsFlash(db, { payload: payload([row(20, "某消费品牌发布新款运动鞋")]) });
  const result = await refreshMeNewsFlash(db, { payload: payload([row(21, "某影视公司任命新董事", { important: true })]) });
  assert.equal(result.added, 1);
  assert.equal(result.urgent.length, 0);
  assert.equal(db.marketIntelligenceFacts.find((fact) => fact.externalId === "21").values.mayTriggerTradeDirectly, false);
});
