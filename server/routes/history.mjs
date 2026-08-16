import { isTerminalExecution } from "../executionStates.mjs";
import { isTerminalTradePlan } from "../tradePlanLifecycle.mjs";
import { paginateTerminalHistory } from "../cursorPagination.mjs";

const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled", "canceled", "expired", "skipped"]);
const TERMINAL_REVIEW_STATES = new Set(["completed", "reflected", "closed", "done"]);

function statusIn(states) {
  return (row) => states.has(String(row?.status || "").toLowerCase());
}

function historyHandler(db, resource, isTerminal, mapItem = (row) => row) {
  return (req, res) => {
    const page = paginateTerminalHistory(db[resource] || [], { limit: req.query.limit, cursor: req.query.cursor, isTerminal });
    res.set("Cache-Control", "no-store");
    res.json({ ...page, items: page.items.map(mapItem) });
  };
}

export function registerHistoryRoutes(app, ctx) {
  const { db, requirePermission } = ctx;
  app.get("/api/history/fills", requirePermission("account.read"), historyHandler(db, "fills", () => true));
  app.get("/api/history/executions", requirePermission("account.read"), historyHandler(db, "executionOrders", isTerminalExecution));
  app.get("/api/history/plans", requirePermission("account.read"), historyHandler(db, "tradePlans", isTerminalTradePlan));
  app.get("/api/history/reviews", requirePermission("account.read"), historyHandler(db, "reviews", statusIn(TERMINAL_REVIEW_STATES), ({ analyticsSnapshot: _analyticsSnapshot, ...row }) => row));
  app.get("/api/history/tasks", requirePermission("account.read"), historyHandler(db, "tasks", statusIn(TERMINAL_TASK_STATES)));
  app.get("/api/history/job-runs", requirePermission("account.read"), historyHandler(db, "jobRuns", () => true));
  app.get("/api/history/audit", requirePermission("audit.read"), historyHandler(db, "auditLogs", () => true));
  app.get("/api/history/decision-audits", requirePermission("audit.read"), historyHandler(db, "decisionAuditRecords", () => true, (row) => ({
    id: row.id,
    schemaVersion: row.schemaVersion,
    agentRunId: row.agentRunId,
    tradePlanId: row.tradePlanId,
    rootHash: row.rootHash,
    stages: (row.stages || []).map((stage) => ({
      index: stage.index,
      name: stage.name,
      previousHash: stage.previousHash,
      contentHash: stage.contentHash,
      chainHash: stage.chainHash
    })),
    createdAt: row.createdAt
  })));
}
