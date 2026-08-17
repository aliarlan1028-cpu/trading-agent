import assert from "node:assert/strict";
import test from "node:test";

import { marketContextForAgent, marketContextForPrompt, marketResearchAuditEvidence, refreshMarketContextResearch, validMarketResearchContext } from "../server/marketContextResearch.mjs";

test("global and whitelist web research is batched into one cached call", async () => {
  let calls = 0;
  let prompt = "";
  const now = Date.parse("2026-08-18T02:00:00.000Z");
  const db = {
    mandates: [{ status: "active", allowedSymbols: ["BTC/USDT", "SUI/USDT"] }],
    marketMovers: { movers: [{ symbol: "DOGE/USDT", changePct: 8, quoteVolUsdt: 50_000_000 }] },
    marketRegime: { global: { breadthPct: 60, btcChangePct: 2 } }
  };
  const search = async (value) => {
    calls += 1; prompt = value;
    return {
      content: JSON.stringify({
        global: { sentimentScore: 62, confidence: "high", materiality: "high", driverTypes: ["macro", "etf_flow"], eventTypes: ["central_bank_decision"], impactChannels: ["usd_rates", "risk_appetite"], announcementStatuses: ["reported"] },
        assets: [
          { symbol: "BTC/USDT", sentimentScore: 70, confidence: "high", materiality: "high", driverTypes: ["etf_flow"], eventTypes: ["etf_flow"], impactChannels: ["institutional_demand"], announcementStatuses: ["reported"] },
          { symbol: "SUI/USDT", sentimentScore: 45, confidence: "medium", materiality: "low", driverTypes: ["network"], eventTypes: ["protocol_upgrade"], impactChannels: ["network_usage"], announcementStatuses: ["announced"] },
          { symbol: "EVIL/USDT", sentimentScore: 100, confidence: "high", materiality: "high", driverTypes: ["security"], eventTypes: ["security_breach"], impactChannels: ["security_trust"], announcementStatuses: ["reported"] }
        ]
      }),
      annotations: [{ url_citation: { url: "https://example.com/research", title: "Research" } }],
      metadata: { actualModel: "gemini-search", actualProvider: "Google AI Studio", providerAttributionVerified: true, responseId: "r1" }
    };
  };
  const first = await refreshMarketContextResearch(db, { now, search });
  assert.equal(first.status, "ok");
  assert.equal(first.searchCalls, 1);
  assert.equal(calls, 1);
  assert.match(prompt, /BTC\/USDT/);
  assert.match(prompt, /SUI\/USDT/);
  assert.match(prompt, /DOGE\/USDT/);
  assert.equal(first.context.assets.some((row) => row.symbol === "EVIL/USDT"), false);
  assert.match(first.context.inputHash, /^[a-f0-9]{64}$/);
  assert.match(first.context.outputHash, /^[a-f0-9]{64}$/);

  const second = await refreshMarketContextResearch(db, { now: now + 10 * 60_000, search });
  assert.equal(second.status, "cached");
  assert.equal(second.searchCalls, 0);
  assert.equal(calls, 1);
  assert.equal(marketContextForAgent(db, { now: now + 10 * 60_000 }).status, "fresh");
  const promptProjection = marketContextForPrompt(db, { now: now + 10 * 60_000 });
  assert.match(promptProjection, /低频批量|缓存=/);
  assert.match(promptProjection, new RegExp(first.context.inputHash));
  assert.match(promptProjection, new RegExp(first.context.outputHash));
  assert.deepEqual(marketResearchAuditEvidence(db, { now: now + 10 * 60_000 }), {
    version: 1,
    contextId: first.context.id,
    status: "fresh",
    researchedAt: first.context.researchedAt,
    inputHash: first.context.inputHash,
    outputHash: first.context.outputHash,
    model: "gemini-search",
    provider: "Google AI Studio",
    providerAttributionVerified: true,
    mayTriggerTradeDirectly: false
  });
});

test("failed research keeps the last good cache", async () => {
  const old = { id: "old", scopeHash: "different", researchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-18T01:00:00.000Z", assets: [], global: {}, provider: {} };
  const db = { mandates: [{ status: "active", allowedSymbols: ["BTC/USDT"] }], marketResearchContext: old };
  const result = await refreshMarketContextResearch(db, { now: Date.parse("2026-08-18T02:00:00.000Z"), force: true, search: async () => { throw new Error("search down"); } });
  assert.equal(result.status, "failed");
  assert.equal(db.marketResearchContext, old);
});

test("corrupt cache expiry and payload are rejected instead of appearing fresh or throwing", () => {
  const db = { marketResearchContext: {
    id: "bad", version: 1, scopeHash: "scope", symbols: ["BTC/USDT"],
    researchedAt: "2026-08-18T00:00:00.000Z", expiresAt: "not-a-date",
    global: null, assets: [], provider: {}
  } };
  assert.equal(validMarketResearchContext(db.marketResearchContext), false);
  assert.equal(marketContextForAgent(db, { now: Date.parse("2026-08-18T00:10:00.000Z") }), null);
  assert.equal(marketContextForPrompt(db, { now: Date.parse("2026-08-18T00:10:00.000Z") }), null);
});

test("invalid research TTL uses the one-hour default before making the search call", async () => {
  let calls = 0;
  const now = Date.parse("2026-08-18T02:00:00.000Z");
  const db = { mandates: [{ status: "active", allowedSymbols: ["BTC/USDT"] }] };
  const result = await refreshMarketContextResearch(db, {
    now,
    ttlMs: "invalid",
    search: async () => {
      calls += 1;
      return {
        content: JSON.stringify({ global: {}, assets: [] }), annotations: [],
        metadata: { providerAttributionVerified: true }
      };
    }
  });
  assert.equal(result.status, "ok");
  assert.equal(calls, 1);
  assert.equal(result.context.expiresAt, new Date(now + 60 * 60_000).toISOString());
  assert.equal(validMarketResearchContext(result.context), true);
});
