import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-context-selection");
const bundle = path.join(cacheDir, `selection-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(bundle, { force: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { resolveAiContextObject } from "./src/kordynV2/viewModels/aiContextSelection.js";
      export { createV2Selection } from "./src/kordynV2/viewModels/selection.js";
      export { buildAiDomainModel } from "./src/kordynV2/domains/ai/aiModel.js";
    `,
    resolveDir: rootDir
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
  outfile: bundle,
  logLevel: "silent"
});

const { buildAiDomainModel, createV2Selection, resolveAiContextObject } = require(bundle);

const eventCandidate = (id) => ({
  id,
  type: "Event",
  workspaceId: "ai",
  route: "eventsTasks:events",
  sourceSection: "operationsCenter"
});

test("Event resolver accepts exactly the formed Task 1 Event identity across canonical and official mirrors", () => {
  const official = {
    id: "calendar-fomc",
    title: "FOMC 利率决议",
    startAt: "2026-09-17T18:00:00.000Z",
    timePrecision: "exact",
    sourceName: "Federal Reserve"
  };
  const mirror = {
    id: "event-fomc",
    scheduledKey: "official_calendar-fomc",
    title: official.title,
    due: official.startAt,
    sourceName: official.sourceName
  };

  for (const events of [[mirror], [mirror, { ...mirror }]].map((rows) => rows.slice().reverse())) {
    const data = { events, marketCalendarEvents: [official] };
    const model = buildAiDomainModel(data);
    assert.deepEqual(model.events.map((row) => row.id), ["event-fomc"]);
    assert.equal(resolveAiContextObject(data, eventCandidate("event-fomc"))?.id, "event-fomc");
    assert.equal(resolveAiContextObject(data, eventCandidate("calendar-fomc")), null);
  }
});

test("Event resolver preserves official fallback and fails same ID across different event truth closed", () => {
  const official = {
    id: "calendar-fallback",
    title: "CPI",
    startAt: "2026-09-12",
    timePrecision: "date",
    sourceName: "BLS"
  };
  const idlessMirror = { scheduledKey: "official_calendar-fallback", title: "CPI", due: "2026-09-12" };
  const fallbackData = { events: [idlessMirror], marketCalendarEvents: [official] };
  assert.equal(buildAiDomainModel(fallbackData).events[0].id, "calendar-fallback");
  assert.equal(resolveAiContextObject(fallbackData, eventCandidate("calendar-fallback"))?.id, "calendar-fallback");

  const ambiguous = {
    events: [
      { id: "event-shared", title: "CPI", due: "2026-09-12T12:30:00.000Z" },
      { id: "event-shared", title: "FOMC", due: "2026-09-17T18:00:00.000Z" }
    ]
  };
  assert.deepEqual(buildAiDomainModel(ambiguous).events.map((row) => row.selectable), [false, false]);
  assert.equal(resolveAiContextObject(ambiguous, eventCandidate("event-shared")), null);
  assert.equal(resolveAiContextObject({ eventRiskWindows: [{ id: "event-risk-only" }] }, eventCandidate("event-risk-only")), null);
});

test("Signal and Watch identity are globally unique and malformed candidates fail closed", () => {
  const signalCandidate = (id) => ({ id, type: "Signal", workspaceId: "ai", route: "intelligence", sourceSection: "operationsCenter" });
  const watchCandidate = (id) => ({ id, type: "Watch", workspaceId: "ai", route: "watch", sourceSection: "chat" });
  const duplicateSignal = {
    newsFeed: [{ id: "signal-shared", title: "News" }],
    marketMovers: { movers: [{ id: "signal-shared", symbol: "ETH/USDT" }] }
  };
  assert.deepEqual(buildAiDomainModel(duplicateSignal).intelligence.map((row) => row.selectable), [false, false]);
  assert.equal(resolveAiContextObject(duplicateSignal, signalCandidate("signal-shared")), null);

  const duplicateWatch = { watchTriggers: [{ id: "watch-shared" }, { id: "watch-shared" }] };
  assert.equal(resolveAiContextObject(duplicateWatch, watchCandidate("watch-shared")), null);
  assert.equal(resolveAiContextObject({ newsFeed: [{ id: "signal-ok", title: "News" }] }, signalCandidate("signal-ok"))?.id, "signal-ok");
  assert.equal(resolveAiContextObject({ watchTriggers: [{ id: "watch-ok", status: "active" }] }, watchCandidate("watch-ok"))?.id, "watch-ok");
  assert.equal(resolveAiContextObject({ newsFeed: [{ id: "bad signal", title: "Bad" }] }, signalCandidate("bad signal")), null);
  assert.equal(resolveAiContextObject({ watchTriggers: [{ id: "watch\ninvalid" }] }, watchCandidate("watch\ninvalid")), null);
});

test("V2 selection projects matching object Context and Trace identity for Signal Watch and Event", () => {
  const data = {
    resourceState: { operationsCenter: "loaded", chat: "loaded" },
    newsFeed: [{ id: "signal-context", title: "ETF 资金流更新", sourceName: "MacroMicro", updatedAt: "2026-08-29T08:05:00Z" }],
    watchTriggers: [{ id: "watch-context", title: "ETH 突破回踩", symbol: "ETH/USDT", status: "active", updatedAt: "2026-08-29T08:08:00Z" }],
    marketCalendarEvents: [{ id: "event-context", title: "FOMC", startAt: "2026-09-17", timePrecision: "date", sourceName: "Federal Reserve" }],
    traces: [
      { id: "trace-signal", workspaceId: "ai", objectType: "Signal", objectId: "signal-context", stage: "Sense", status: "complete", evidenceId: "evidence-signal" },
      { id: "trace-watch", workspaceId: "ai", objectType: "Watch", objectId: "watch-context", stage: "Monitor", status: "waiting", evidenceId: "evidence-watch" },
      { id: "trace-event", workspaceId: "ai", objectType: "Event", objectId: "event-context", stage: "Recall", status: "complete", evidenceId: "evidence-event" }
    ]
  };
  const candidates = [
    { id: "signal-context", type: "Signal", workspaceId: "ai", route: "intelligence", sourceSection: "operationsCenter" },
    { id: "watch-context", type: "Watch", workspaceId: "ai", route: "watch", sourceSection: "chat" },
    eventCandidate("event-context")
  ];
  for (const candidate of candidates) {
    const selection = createV2Selection({ data, candidate });
    assert.equal(selection.object.id, candidate.id);
    assert.equal(selection.object.type, candidate.type);
    assert.equal(selection.context.objectId, candidate.id);
    assert.equal(selection.context.object, candidate.id);
    assert.equal(selection.context.objectType, candidate.type);
    assert.equal(selection.trace.objectId, candidate.id);
    assert.equal(selection.trace.stages.some((stage) => stage.evidence === `evidence-${candidate.type.toLowerCase()}`), true);
  }
});
