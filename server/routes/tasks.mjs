// 定时任务路由组（含 job-runs 只读）—— 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
export function registerTaskRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, scheduleTask, runTask } = ctx;
  const findTask = (idv) => db.tasks.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Task not found" });

  app.get("/api/tasks", (_req, res) => res.json(db.tasks));
  app.get("/api/job-runs", (_req, res) => res.json(db.jobRuns));

  app.post("/api/tasks", requirePermission("write:task"), (req, res) => {
    const task = { id: id("task"), type: "Every", enabled: true, status: "等待中", allowlist: [], ...req.body, createdAt: nowIso() };
    // 带自然语言 mission 的任务 → 走通用 Agent 情报任务处理器
    if (task.mission && !task.handler) { task.handler = "agent_mission"; task.role = task.role || "情报"; }
    db.tasks.unshift(task);
    appendAudit(db, "创建定时任务", task.id, db.user.name);
    scheduleTask(db, task, saveDb);
    persist(res, task);
  });

  app.patch("/api/tasks/:id", requirePermission("write:task"), (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    Object.assign(task, req.body, { updatedAt: nowIso() });
    appendAudit(db, "更新定时任务", task.id, db.user.name);
    if (task.enabled) scheduleTask(db, task, saveDb);
    persist(res, task);
  });

  app.delete("/api/tasks/:id", requirePermission("write:task"), (req, res) => {
    const index = db.tasks.findIndex((item) => item.id === req.params.id);
    if (index === -1) return notFound(res);
    const [task] = db.tasks.splice(index, 1);
    db.jobRuns = (db.jobRuns || []).filter((run) => run.taskId !== task.id);
    appendAudit(db, "删除定时任务", task.id, db.user.name, "warning");
    persist(res, { message: `${task.name || task.id} 已删除`, task });
  });

  app.post("/api/tasks/:id/pause", requirePermission("write:task"), (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    task.enabled = false;
    task.status = "已暂停";
    task.pauseReason = req.body.reason || "manual_pause";
    task.updatedAt = nowIso();
    appendAudit(db, "暂停定时任务", task.id, db.user.name);
    persist(res, task);
  });

  app.post("/api/tasks/:id/resume", requirePermission("write:task"), (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    task.enabled = true;
    task.status = "运行中";
    task.updatedAt = nowIso();
    appendAudit(db, "恢复定时任务", task.id, db.user.name);
    scheduleTask(db, task, saveDb);
    persist(res, task);
  });

  app.post("/api/tasks/:id/run", requirePermission("write:task"), async (req, res) => {
    const result = await runTask(db, req.params.id, saveDb, "manual");
    if (result.status === "missing_task") return notFound(res);
    res.json(result);
  });
}
