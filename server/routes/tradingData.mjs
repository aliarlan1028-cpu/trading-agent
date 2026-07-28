// 交易数据只读/工具路由组（行情/持仓/委托/成交、回测列表与运行、策略清单、组合风险、绩效、核算刷新）——
// 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
export function registerTradingDataRoutes(app, ctx) {
  const { db, persist, requirePermission, activeMandate, listStrategies, buildPortfolioRisk, runBacktest, performanceReport, refreshAccounting } = ctx;

  app.get("/api/markets", (_req, res) => res.json(db.markets));
  app.get("/api/positions", (_req, res) => res.json(db.positions));
  app.get("/api/orders", (_req, res) => res.json(db.orders));
  app.get("/api/fills", (_req, res) => res.json(db.fills));

  app.get("/api/backtests", (_req, res) => res.json(db.backtests || []));
  app.get("/api/strategies", (_req, res) => res.json(listStrategies()));

  app.get("/api/portfolio/risk", (_req, res) => {
    res.json(buildPortfolioRisk(db, activeMandate(db)));
  });

  app.post("/api/backtest/run", requirePermission("write:review"), async (req, res) => {
    try {
      persist(res, await runBacktest(db, req.body || {}));
    } catch (error) {
      res.status(500).json({ error: `回测失败：${error.message}` });
    }
  });

  app.get("/api/performance", (_req, res) => res.json(performanceReport(db)));

  app.post("/api/accounting/refresh", requirePermission("risk.check"), (_req, res) => {
    persist(res, refreshAccounting(db));
  });
}
