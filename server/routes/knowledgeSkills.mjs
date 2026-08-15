// 知识技能流水线 路由组（列表/编译/历史验证/模拟盘/批量验证/同步/批准/退役/清理归档/假设回测）——
// 从 index.mjs 按 registrar 范式迁出（与逻辑模块 server/knowledgeSkills.mjs 不冲突,本文件在 routes/ 下）。
// GET 只返回快照；生命周期同步由显式写路由或后台任务执行。
export function registerKnowledgeSkillRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, knowledgeSkillSummary, compileTradingMethod, validateKnowledgeSkill, startKnowledgeSkillPaper, validateAllCompiledSkills, syncKnowledgeSkillLifecycle, approveKnowledgeSkill, retireKnowledgeSkill, runBacktest } = ctx;

  app.get("/api/knowledge/skills", requirePermission("knowledge.read"), (_req, res) => res.json(knowledgeSkillSummary(db, { sync: false })));

  app.post("/api/knowledge/methods/:id/compile", requirePermission("write:knowledge"), (req, res) => {
    try {
      const skill = compileTradingMethod(db, req.params.id, req.body || {}, req.user?.name || db.user.name);
      persist(res, { skill });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/skills/:id/validate", requirePermission("write:review"), async (req, res) => {
    try {
      persist(res, await validateKnowledgeSkill(db, req.params.id, req.body || {}, req.user?.name || db.user.name));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/skills/:id/paper", requirePermission("write:review"), async (req, res) => {
    try {
      persist(res, await startKnowledgeSkillPaper(db, req.params.id, req.body || {}, req.user?.name || db.user.name));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/skills/validate-all", requirePermission("write:review"), (req, res) => {
    const result = validateAllCompiledSkills(db, saveDb, req.user?.name || db.user.name);
    const message = result.started
      ? `已开始批量历史验证 ${result.total} 个技能(后台执行,数分钟内按门槛自动流转,完成后审计日志有汇总)`
      : result.reason === "already_running" ? "批量验证已在进行中" : "没有待历史验证的技能";
    res.json({ ...result, message });
  });

  app.post("/api/knowledge/skills/sync", requirePermission("write:review"), (req, res) => {
    persist(res, syncKnowledgeSkillLifecycle(db, req.user?.name || db.user.name));
  });

  app.post("/api/knowledge/skills/:id/approve", requirePermission("approve:knowledge_skill"), (req, res) => {
    try {
      const skill = approveKnowledgeSkill(db, req.params.id, req.user?.name || db.user.name, req.body.note);
      persist(res, { skill });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/skills/:id/retire", requirePermission("approve:knowledge_skill"), (req, res) => {
    try {
      const skill = retireKnowledgeSkill(db, req.params.id, req.user?.name || db.user.name, req.body.reason);
      persist(res, { skill });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // 清理归档：删除"编译失败"和"已被替代"的技能（这些不参与任何决策，纯噪音）。
  // 已退役(retired)默认保留(那是你主动退役的),除非显式 includeRetired。审计日志仍留有历史事件。
  app.post("/api/knowledge/skills/purge-archived", requirePermission("approve:knowledge_skill"), (req, res) => {
    const includeRetired = req.body?.includeRetired === true;
    const junk = new Set(includeRetired ? ["compile_failed", "superseded", "retired"] : ["compile_failed", "superseded"]);
    const before = (db.knowledge?.tradingSkills || []).length;
    db.knowledge.tradingSkills = (db.knowledge.tradingSkills || []).filter((s) => !junk.has(s.status));
    const removed = before - db.knowledge.tradingSkills.length;
    appendAudit(db, `清理归档技能 ${removed} 个（${[...junk].join("/")}）`, "skills_purge", req.user?.name || db.user.name, "warning");
    persist(res, { ok: true, removed, message: `已清理 ${removed} 个归档技能` });
  });

  // B 路：回测一条书本策略假设（用最接近的内置策略近似验证其方向/周期是否有历史边际）。
  // 硬闸：只有回测通过（正期望 + 足够样本 + 盈亏比>1）才把 executable 置 true。
  app.post("/api/knowledge/hypotheses/:id/backtest", requirePermission("write:knowledge"), async (req, res) => {
    const hypo = (db.knowledge?.strategyHypotheses || []).find((item) => item.id === req.params.id);
    if (!hypo) return res.status(404).json({ error: "策略假设不存在" });
    const kindMap = { price_action: "trend", trend: "trend", breakout: "breakout", mean_reversion: "meanrev", intraday_setup: "trend", momentum: "macd", other: "trend" };
    let strat = kindMap[hypo.kind] || "trend";
    if (hypo.direction === "short" && strat === "trend") strat = "death_cross";
    const symbol = /\//.test(hypo.symbolScope) ? hypo.symbolScope.split(/[，,、\s/]+/).filter(Boolean).slice(0, 1).map((s) => (s.includes("/") ? s : `${s}/USDT`))[0] || "BTC/USDT" : "BTC/USDT";
    const symbolFixed = symbol.includes("/") ? symbol : `${symbol}/USDT`;
    const tfMap = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d" };
    const result = await runBacktest(db, { symbol: symbolFixed, timeframe: tfMap[hypo.timeframe] || "1h", strategy: strat });
    if (result.status !== "ok") {
      hypo.backtest = { status: result.status, at: nowIso() };
      hypo.status = "回测失败";
      return persist(res, { ok: false, error: `回测失败：${result.status}`, hypothesis: hypo });
    }
    const passed = result.expectancyR > 0 && result.trades >= 20 && (result.profitFactor == null || result.profitFactor > 1);
    hypo.backtest = { at: nowIso(), approxStrategy: strat, symbol: symbolFixed, timeframe: result.timeframe, trades: result.trades, winRatePct: result.winRatePct, expectancyR: result.expectancyR, profitFactor: result.profitFactor, netReturnPct: result.netReturnPct, maxDrawdownPct: result.maxDrawdownPct, approx: true };
    hypo.status = passed ? "已验证" : "未通过";
    hypo.executable = passed;
    appendAudit(db, `策略假设回测「${hypo.name}」：${passed ? "通过" : "未通过"}（期望 ${result.expectancyR}R · ${result.trades} 笔 · 胜率 ${result.winRatePct}%）`, hypo.id, "KnowledgeBacktest", passed ? "ok" : "warning");
    persist(res, { ok: true, passed, result, hypothesis: hypo });
  });
}
