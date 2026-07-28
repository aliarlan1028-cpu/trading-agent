// Agent 运行/状态/画像/记忆 路由组（state-files、status、profiles、memory、agent-runs 列表与
// pause/resume/stop、触发一次巡检）—— 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
export function registerAgentRunRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, nowIso, appendAudit, updateStateFile, getAgentStatus, addMemoryItem, changeAgentRunStatus, runAgentCycle } = ctx;
  const runNotFound = (res) => res.status(404).json({ error: "AgentRun not found" });

  app.get("/api/agent/state-files", (_req, res) => res.json(db.agentStateFiles));
  app.patch("/api/agent/state-files/:name", requirePermission("admin:system"), (req, res) => {
    try {
      persist(res, updateStateFile(db, req.params.name, req.body.content || ""));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/agent/status", (_req, res) => res.json(getAgentStatus(db)));

  app.get("/api/agent/profiles", (_req, res) => {
    res.json((db.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)));
  });

  app.patch("/api/agent/profiles/:id", requirePermission("write:knowledge"), (req, res) => {
    const profile = (db.agentProfiles || []).find((item) => item.id === req.params.id);
    if (!profile) return res.status(404).json({ error: "Agent profile not found" });
    const allowed = ["name", "role", "enabled", "declaration", "personality", "mission", "boundaries", "tools", "outputSchema", "memoryPolicy"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) profile[key] = req.body[key];
    }
    profile.updatedAt = nowIso();
    appendAudit(db, `更新 Agent Profile：${profile.name}`, profile.id, req.user?.name || db.user.name);
    persist(res, profile);
  });

  app.get("/api/agent/memory", (_req, res) => res.json(db.memoryItems));
  app.post("/api/agent/memory", requirePermission("write:knowledge"), (req, res) => {
    persist(res, addMemoryItem(db, req.body));
  });

  app.get("/api/agent-runs", (_req, res) => res.json(db.agentRuns));
  app.get("/api/agent/runs", (_req, res) => res.json(db.agentRuns));
  app.get("/api/agent/runs/:id", (req, res) => {
    const run = db.agentRuns.find((item) => item.id === req.params.id);
    if (!run) return runNotFound(res);
    res.json(run);
  });
  app.post("/api/agent/runs/:id/pause", requirePermission("write:mandate"), (req, res) => {
    const run = changeAgentRunStatus(db, req.params.id, "paused");
    if (!run) return runNotFound(res);
    persist(res, run);
  });
  app.post("/api/agent/runs/:id/resume", requirePermission("write:mandate"), (req, res) => {
    const run = changeAgentRunStatus(db, req.params.id, "observing");
    if (!run) return runNotFound(res);
    persist(res, run);
  });
  app.post("/api/agent/runs/:id/stop", requirePermission("write:mandate"), (req, res) => {
    const run = changeAgentRunStatus(db, req.params.id, "stopped");
    if (!run) return runNotFound(res);
    persist(res, run);
  });
  app.post("/api/agent-runs", requirePermission("write:mandate"), async (req, res) => {
    try {
      persist(res, await runAgentCycle(db, req.body, saveDb));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
