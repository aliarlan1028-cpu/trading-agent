import test from "node:test";
import assert from "node:assert/strict";
import { deriveEventRiskWindows, isAuthoritativeRiskEvent, isEventRiskActive, projectEventRiskWindow } from "../server/eventRisk.mjs";

test("event risk applies only inside its active time window", () => {
  const now = Date.now();
  assert.equal(isEventRiskActive({ due: new Date(now + 60_000).toISOString(), status: "跟进中" }, now), true);
  assert.equal(isEventRiskActive({ due: new Date(now - 2 * 24 * 60 * 60_000).toISOString(), status: "跟进中" }, now), false);
  assert.equal(isEventRiskActive({ due: new Date(now + 60_000).toISOString(), status: "closed" }, now), false);
});

test("only authoritative events may participate in trading risk", () => {
  assert.equal(isAuthoritativeRiskEvent({ kind: "unverified_manual", impact: 100, autoTradingEligible: false }), false);
  assert.equal(isAuthoritativeRiskEvent({ sourceId: "official_bls_calendar", verified: true, impact: 100 }), true);
  assert.equal(isAuthoritativeRiskEvent({ provenance: { verifiedOrigin: true }, autoTradingEligible: true }), true);
});

test("event risk projection distinguishes monitoring, blocking, post-release and unknown-time states", () => {
  const now = Date.UTC(2026, 7, 16, 0, 0, 0);
  const event = (id, minutes, extra = {}) => ({
    id,
    title: id,
    sourceId: "official_bls_calendar",
    sourceName: "U.S. BLS",
    verified: true,
    autoTradingEligible: true,
    due: new Date(now + minutes * 60_000).toISOString(),
    timePrecision: "minute",
    impact: 100,
    relatedSymbols: ["BTC/USDT"],
    ...extra
  });
  const windows = deriveEventRiskWindows([
    event("monitoring", 120),
    event("pre", 10),
    event("post", -10),
    event("date-only", 60, { timePrecision: "date" }),
    event("manual", 5, { kind: "unverified_manual", verified: false, autoTradingEligible: false }),
    event("closed", 5, { status: "closed" })
  ], { now, blackoutMinutes: 30, symbol: "BTC/USDT" });

  assert.deepEqual(windows.map((row) => row.eventId), ["pre", "post", "date-only", "monitoring"]);
  assert.equal(windows.find((row) => row.eventId === "pre").phase, "pre_release_blackout");
  assert.equal(windows.find((row) => row.eventId === "pre").blocking, true);
  assert.equal(windows.find((row) => row.eventId === "post").phase, "post_release");
  assert.equal(windows.find((row) => row.eventId === "post").blocking, true);
  assert.equal(windows.find((row) => row.eventId === "monitoring").blocking, false);
  assert.equal(windows.find((row) => row.eventId === "date-only").phase, "time_unconfirmed");
});

test("event risk projection is symbol-bound and does not promote low-impact facts", () => {
  const now = Date.UTC(2026, 7, 16, 0, 0, 0);
  const base = {
    id: "cpi", title: "CPI", sourceId: "official_bls_calendar", verified: true,
    due: new Date(now + 5 * 60_000).toISOString(), timePrecision: "minute", impact: 100,
    relatedSymbols: ["BTC/USDT"]
  };
  assert.equal(projectEventRiskWindow(base, { now, blackoutMinutes: 30, symbol: "ETH/USDT" }), null);
  assert.equal(projectEventRiskWindow({ ...base, impact: 80 }, { now, blackoutMinutes: 30 }), null);
});
