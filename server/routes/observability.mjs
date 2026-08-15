// 从 index.mjs 抽出的一组「隔离、无热路径依赖」的路由，建立按组拆分的范式。
// index.mjs 曾是 2754 行的上帝文件；这里先把 watchlist / reconciler / traces / audit-logs /
// scheduler 这几组自成一体的路由迁出，其余组后续按同样 registrar 模式增量迁移。
// 依赖统一通过 ctx 注入（不再靠模块级闭包），可单测、可组合。
export function registerObservabilityRoutes(app, ctx) {
  const {
    db, saveDb, persist, requirePermission,
    normalizeSymbol, runReconciler, exportTraces, exportAuditLogs,
    schedulerStatus, startScheduler
  } = ctx;
  const DEFAULT_WATCH = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  const [runReconcilePermission] = pendingActionCapabilities("run_reconcile");

  // —— 自选列表 ——
  app.post("/api/watchlist", requirePermission("write:realtime"), (req, res) => {
    const symbol = normalizeSymbol(req.body.symbol);
    if (!symbol) return res.status(400).json({ error: "无效的交易对" });
    db.watchlist = (db.watchlist && db.watchlist.length) ? db.watchlist : [...DEFAULT_WATCH];
    if (!db.watchlist.includes(symbol)) db.watchlist = [...db.watchlist, symbol];
    saveDb(db);
    res.json({ ok: true, watchlist: db.watchlist });
  });
  app.delete("/api/watchlist/:symbol", requirePermission("write:realtime"), (req, res) => {
    const symbol = normalizeSymbol(decodeURIComponent(req.params.symbol));
    db.watchlist = ((db.watchlist && db.watchlist.length) ? db.watchlist : [...DEFAULT_WATCH]).filter((s) => s !== symbol);
    saveDb(db);
    res.json({ ok: true, watchlist: db.watchlist });
  });

  // —— 对账 ——
  app.post("/api/reconciler/run", requirePermission(runReconcilePermission), (req, res) => {
    const report = runReconciler(db, req.body || {});
    persist(res, report);
  });
  app.get("/api/reconciler/reports", requirePermission("account.read"), (_req, res) => res.json(db.reconciliationReports || []));

  // —— 调度器 ——
  app.get("/api/scheduler/status", requirePermission("admin:system"), (_req, res) => res.json(schedulerStatus(db)));
  app.post("/api/scheduler/recover", requirePermission("write:task"), (_req, res) => {
    persist(res, startScheduler(db, saveDb));
  });

  // —— 审计日志 / 决策轨迹（读 + 导出）——
  app.get("/api/audit-logs", requirePermission("audit.read"), (_req, res) => res.json(db.auditLogs));
  app.get("/api/audit-logs/export", requirePermission("audit.export"), (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "json";
    res.type(format === "csv" ? "text/csv" : "application/json").send(exportAuditLogs(db, format));
  });
  app.get("/api/traces", requirePermission("trace.read"), (_req, res) => res.json(db.traces));
  app.get("/api/traces/export", requirePermission("audit.export"), (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "json";
    res.type(format === "csv" ? "text/csv" : "application/json").send(exportTraces(db, format));
  });
}
import { pendingActionCapabilities } from "../capabilityPolicy.mjs";
