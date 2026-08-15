import { storedTaskAuthorization, taskHandlerPolicy, userHasCapabilities } from "../capabilityPolicy.mjs";

// 定时任务路由组（含 job-runs 只读）—— 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
export function registerTaskRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, scheduleTask, unscheduleTask, runTask, validateTaskDefinition, userHasPermission } = ctx;
  const findTask = (idv) => db.tasks.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Task not found" });
  const systemManaged = (task) => task?.systemManaged === true || String(task?.id || "").startsWith("task_sys_");
  const forbidSystemDefinitionMutation = (task, res) => {
    if (!systemManaged(task)) return false;
    res.status(403).json({ error: "系统任务定义由版本配置管理，不能在任务面板修改或删除" });
    return true;
  };
  const forbidSystemLifecycleWithoutAdmin = (task, req, res) => {
    if (!systemManaged(task) || !req.user || userHasPermission(db, req.user, "admin:system")) return false;
    res.status(403).json({ error: "系统托管任务只能由管理员暂停、恢复或手动运行" });
    return true;
  };
  const authorizeUserHandler = (handler, req, res) => {
    const policy = taskHandlerPolicy(handler);
    if (!policy?.userSchedulable || !userHasCapabilities(db, req.user, policy.permissions)) {
      res.status(403).json({ error: "task_handler_not_authorized", handler, requiredPermissions: policy?.permissions || [] });
      return null;
    }
    return policy;
  };

  function buildUserTask(body = {}, existing = null) {
    const mission = String(body.mission ?? existing?.mission ?? "").trim().slice(0, 1000);
    const handler = mission ? "agent_mission" : String(body.handler ?? existing?.handler ?? "reminder").trim();
    return {
      ...(existing || {}),
      name: String(body.name ?? existing?.name ?? "").trim().slice(0, 80),
      type: String(body.type ?? existing?.type ?? "Every"),
      schedule: String(body.schedule ?? existing?.schedule ?? "").trim(),
      timezone: body.timezone ?? existing?.timezone,
      role: String(body.role ?? existing?.role ?? (mission ? "情报" : "提醒")).trim().slice(0, 40),
      enabled: body.enabled ?? existing?.enabled ?? true,
      handler,
      mission: mission || undefined,
      systemManaged: false
    };
  }

  app.get("/api/tasks", requirePermission("write:task"), (_req, res) => res.json(db.tasks));
  app.get("/api/job-runs", requirePermission("admin:system"), (_req, res) => res.json(db.jobRuns));

  app.post("/api/tasks", requirePermission("write:task"), (req, res) => {
    const definition = buildUserTask(req.body);
    const policy = authorizeUserHandler(definition.handler, req, res);
    if (!policy) return;
    const task = {
      id: id("task"), status: "等待", allowlist: [], createdAt: nowIso(), ...definition,
      creatorUserId: req.user.id,
      tenantId: req.tenantId || req.user.tenantId || "tenant_owner",
      creatorSecurityVersion: Number(req.user.securityVersion || 0),
      requiredPermissions: [...policy.permissions]
    };
    const validation = validateTaskDefinition(task);
    if (!validation.valid) return res.status(400).json({ error: `任务配置无效：${validation.errors.join("；")}`, errors: validation.errors });
    db.tasks.unshift(task);
    try {
      scheduleTask(db, task, saveDb);
    } catch (error) {
      db.tasks = db.tasks.filter((item) => item !== task);
      return res.status(400).json({ error: `任务未创建：${error.message}` });
    }
    appendAudit(db, `创建定时任务：${task.name}（${task.handler}）`, task.id, req.user?.name || db.user.name);
    persist(res, task);
  });

  app.patch("/api/tasks/:id", requirePermission("write:task"), (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    if (forbidSystemDefinitionMutation(task, res)) return;
    const existingAuthorization = storedTaskAuthorization(db, task);
    if (!existingAuthorization.allowed) return res.status(403).json({ error: existingAuthorization.reason });
    const next = buildUserTask(req.body, task);
    const policy = authorizeUserHandler(next.handler, req, res);
    if (!policy) return;
    const validation = validateTaskDefinition(next);
    if (!validation.valid) return res.status(400).json({ error: `任务配置无效：${validation.errors.join("；")}`, errors: validation.errors });
    const previous = { ...task };
    Object.assign(task, next, { updatedAt: nowIso(), requiredPermissions: [...policy.permissions] });
    try {
      if (task.enabled) scheduleTask(db, task, saveDb);
      else unscheduleTask(task.id);
    } catch (error) {
      Object.assign(task, previous);
      if (previous.enabled) {
        try { scheduleTask(db, task, saveDb); } catch { /* 保留原定义，启动巡检会显式报错 */ }
      }
      return res.status(400).json({ error: `任务未更新：${error.message}` });
    }
    appendAudit(db, `更新定时任务：${task.name}`, task.id, req.user?.name || db.user.name);
    persist(res, task);
  });

  app.delete("/api/tasks/:id", requirePermission("write:task"), (req, res) => {
    const index = db.tasks.findIndex((item) => item.id === req.params.id);
    if (index === -1) return notFound(res);
    if (forbidSystemDefinitionMutation(db.tasks[index], res)) return;
    const existingAuthorization = storedTaskAuthorization(db, db.tasks[index]);
    if (!existingAuthorization.allowed) return res.status(403).json({ error: existingAuthorization.reason });
    const [task] = db.tasks.splice(index, 1);
    unscheduleTask(task.id);
    // 运行历史是审计证据，删除定义后保留并标记，而不是一并抹掉。
    for (const run of db.jobRuns || []) if (run.taskId === task.id) run.taskDeletedAt ||= nowIso();
    appendAudit(db, `删除定时任务定义：${task.name}`, task.id, req.user?.name || db.user.name, "warning");
    persist(res, { message: `${task.name || task.id} 已删除`, task });
  });

  app.post("/api/tasks/:id/pause", requirePermission("write:task"), (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    if (forbidSystemLifecycleWithoutAdmin(task, req, res)) return;
    unscheduleTask(task.id);
    task.enabled = false;
    task.status = "暂停";
    task.nextRunAt = null;
    task.pauseReason = req.body.reason || "manual_pause";
    task.updatedAt = nowIso();
    appendAudit(db, `暂停定时任务：${task.name}`, task.id, req.user?.name || db.user.name);
    persist(res, task);
  });

  app.post("/api/tasks/:id/resume", requirePermission("write:task"), (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    if (forbidSystemLifecycleWithoutAdmin(task, req, res)) return;
    if (!systemManaged(task)) {
      const authorization = storedTaskAuthorization(db, task);
      if (!authorization.allowed) return res.status(403).json({ error: authorization.reason });
    }
    const validation = validateTaskDefinition({ ...task, enabled: true }, { allowSystemHandlers: systemManaged(task) });
    if (!validation.valid) return res.status(400).json({ error: `任务不能恢复：${validation.errors.join("；")}` });
    task.enabled = true;
    task.status = "等待";
    task.updatedAt = nowIso();
    try { scheduleTask(db, task, saveDb); }
    catch (error) { task.enabled = false; task.status = "调度无效"; return res.status(400).json({ error: `任务不能恢复：${error.message}` }); }
    appendAudit(db, `恢复定时任务：${task.name}`, task.id, req.user?.name || db.user.name);
    persist(res, task);
  });

  app.post("/api/tasks/:id/run", requirePermission("write:task"), async (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(res);
    if (forbidSystemLifecycleWithoutAdmin(task, req, res)) return;
    if (!systemManaged(task)) {
      const authorization = storedTaskAuthorization(db, task);
      if (!authorization.allowed) return res.status(403).json({ error: authorization.reason });
    }
    if (task.enabled === false) return res.status(409).json({ error: "任务当前已暂停，恢复后才能运行" });
    const result = await runTask(db, req.params.id, saveDb, "manual");
    res.json(result);
  });
}
