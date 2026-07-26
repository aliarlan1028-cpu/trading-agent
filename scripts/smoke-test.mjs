const base = process.env.API_BASE_URL || "http://127.0.0.1:8787";

if (process.env.SMOKE_ALLOW_MUTATIONS !== "true") {
  throw new Error("Full smoke test mutates operational data. Run `npm run smoke:full` only against an isolated test instance.");
}

async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

const health = await request("/api/health");
const me = await request("/api/users/me");
const storage = await request("/api/storage");
const readiness = await request("/api/system/readiness");
let overview = await request("/api/overview");
let smokePlan = overview.tradePlans?.[0];
if (!smokePlan) {
  const created = await request("/api/trade-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: "BTC/USDT",
      direction: "long",
      entry: { type: "limit", price: 10000 },
      stopLoss: 9000,
      takeProfit: 11000,
      rationale: "smoke test plan",
      confidenceBefore: 0.5
    })
  });
  smokePlan = created.plan;
  overview = await request("/api/overview");
}
const risk = await request(`/api/trade-plans/${smokePlan.id}/risk-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const analysis = await request("/api/knowledge/runtime-query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trigger_type: "user_question", question: "BTC 当前是否允许开多？", market_context: { symbol: "BTC/USDT" } })
});
const scheduler = await request("/api/scheduler/status");
const taskRun = await request(`/api/tasks/${overview.tasks[0].id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const taskPause = await request(`/api/tasks/${overview.tasks[0].id}/pause`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const taskResume = await request(`/api/tasks/${overview.tasks[0].id}/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const agentRun = await request("/api/agent-runs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ role: "AI 交易员", goal: "smoke test ReAct", symbol: "BTC/USDT" })
});
const privateGuard = await request("/api/exchange/private-action", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "place_order", payload: { symbol: "BTC/USDT", side: "buy" } })
});
const readonlySync = await request(`/api/exchange/${overview.exchangeAccounts[0].id}/sync-readonly`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const realtimeStatus = await request("/api/realtime/status");
const realtimeStart = await request("/api/realtime/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const reconciler = await request("/api/reconciler/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "smoke" }) });
const agentChat = await request("/api/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "smoke: 只读检查当前账户与市场状态" }) });
const rag = await request("/api/knowledge/rag-query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "CPI 前 BTC 是否适合开多", topK: 2 }) });
const tradePayload = { exchange: "BINANCE", marketType: "perpetual_usdt", symbol: "BTC/USDT", side: "BUY", type: "LIMIT", quantity: 0.0001, price: 10000, stopLoss: 9000, manualApproval: true };
const tradeWrite = await request("/api/trade-actions/place_order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tradePayload) });
const tradeCancel = await request("/api/trade-actions/cancel_order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exchange: "BINANCE", marketType: "perpetual_usdt", symbol: "BTC/USDT", clientOrderId: "guard_tp_btc_001", manualApproval: true }) });
const tradeAmend = await request("/api/trade-actions/amend_order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...tradePayload, clientOrderId: "guard_tp_btc_001", price: 10010 }) });
const tradeClose = await request("/api/trade-actions/close_position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exchange: "BINANCE", marketType: "perpetual_usdt", symbol: "BTC/USDT", positionSide: "long", quantity: 0.0001, manualApproval: true }) });
const tradeStop = await request("/api/trade-actions/move_stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exchange: "BINANCE", marketType: "perpetual_usdt", symbol: "BTC/USDT", clientOrderId: "guard_stop_btc_001", stopPrice: 9100, quantity: 0.0001, manualApproval: true }) });
const tradeTp = await request("/api/trade-actions/take_profit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exchange: "BINANCE", marketType: "perpetual_usdt", symbol: "BTC/USDT", targets: [{ price: 11000, stopPrice: 11000, quantity: 0.00005 }], manualApproval: true }) });
const eventSource = await request("/api/event-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Smoke RSS", type: "rss", url: "https://example.com/feed.xml", enabled: false }) });
const onchain = await request("/api/event-sources/onchain", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
let smokeEvent = overview.events?.[0];
if (!smokeEvent) {
  smokeEvent = await request("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Smoke Event", category: "test", relatedSymbols: ["BTC/USDT"], impact: 20, action: "observe" })
  });
}
const eventProgress = await request(`/api/events/${smokeEvent.id}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "smoke progress" }) });
const eventReview = await request(`/api/events/${smokeEvent.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: "smoke event review" }) });
const drill = await request("/api/security/drills/api_desync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const auditChain = await request("/api/security/audit-chain");
let smokeSkill = overview.skills?.[0];
if (!smokeSkill) {
  smokeSkill = await request("/api/skills/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Skill",
      skillMd: "# Smoke Skill\n\nversion: 0.0.1\npermissions: web.read\n\n用于端到端烟测的最小 Skill。"
    })
  });
  overview = await request("/api/overview");
}
const scan = await request(`/api/skills/${smokeSkill.id}/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const sandbox = await request(`/api/skills/${smokeSkill.id}/run-sandbox`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const mcp = await request("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Smoke MCP", url: "local://smoke", permissions: ["knowledge.read"], toolCount: 1 }) });
const gray = await request(`/api/risk/gray-policies/${overview.grayReleasePolicies[0].id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false, maxNotionalUsdt: 50, allowedSymbols: ["BTC/USDT"], requiresManualApproval: true }) });
const backup = await request("/api/system/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const auditExport = await fetch(`${base}/api/audit-logs/export?format=csv`);
if (!auditExport.ok) throw new Error("audit export failed");

console.log(JSON.stringify({
  ok: health.ok,
  user: me.user.name,
  storage: storage.type,
  implementationCompletionPct: readiness.implementationCompletionPct,
  liveTradingEnabled: health.liveTradingEnabled,
  portfolio: overview.portfolio.totalEquityUsdt,
  riskDecision: risk.decision,
  analysisBundleId: analysis.id,
  schedulerStarted: scheduler.started,
  taskRunStatus: taskRun.run.status,
  taskPauseStatus: taskPause.status,
  taskResumeStatus: taskResume.status,
  agentRunStatus: agentRun.status,
  privateGuardStatus: privateGuard.status,
  readonlySyncStatus: readonlySync.status,
  realtimeConnections: realtimeStatus.connections.length,
  realtimeStartSocketCount: realtimeStart.socketCount,
  reconcilerStatus: reconciler.status,
  agentChatStatus: agentChat.run?.status || agentChat.status,
  ragRefs: rag.retrievedRefs?.length || 0,
  tradeWriteStatus: tradeWrite.status,
  tradeCancelStatus: tradeCancel.status,
  tradeAmendStatus: tradeAmend.status,
  tradeCloseStatus: tradeClose.status,
  tradeStopStatus: tradeStop.status,
  tradeTakeProfitStatus: tradeTp.status,
  eventSourceId: eventSource.id,
  eventProgressStatus: eventProgress.status,
  eventReviewId: eventReview.id,
  onchainStatus: onchain.status,
  drillStatus: drill.status,
  auditChainChecked: auditChain.checked,
  skillScan: scan.scan,
  sandboxStatus: sandbox.status,
  mcpId: mcp.id,
  grayEnabled: gray.enabled,
  backupStatus: backup.status
}, null, 2));
