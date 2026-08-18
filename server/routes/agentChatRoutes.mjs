// Agent 对话路由组（会话列表/新建/改名/删除/清空、发消息、自然语言命令）——
// 从 index.mjs 按 registrar 范式迁出（与逻辑模块 server/agentChat.mjs 不冲突,本文件在 routes/ 下）。
// chat/reset 只清对话(会话+消息+chat 来源 agentRun),不动交易计划/授权/审计/成交。依赖经 ctx 注入。
import { resolvePermissions } from "../auth.mjs";
import { userAgentInvocation } from "../agentInvocation.mjs";

export function registerAgentChatRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, activeProvider, runAgentChat, runAgentCommand } = ctx;
  const chatSessionsSorted = () => (db.chatSessions || []).slice().sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const isAdmin = (req) => req.user?.id === db.user?.id || req.user?.roleId === "role_admin";
  const canAccessSession = (req, session) => Boolean(session)
    && (!session.tenantId || session.tenantId === (req.tenantId || "tenant_owner"))
    && (isAdmin(req) || (!session.ownerUserId ? req.user?.id === db.user?.id : session.ownerUserId === req.user?.id));
  const accessibleSessions = (req) => chatSessionsSorted().filter((session) => canAccessSession(req, session));

  app.get("/api/agent/chat", requirePermission("account.read"), (req, res) => {
    const sessions = accessibleSessions(req);
    const requested = sessions.find((session) => session.id === req.query.sessionId);
    const activeSessionId = requested?.id || sessions[0]?.id || null;
    res.json({
      sessions,
      activeSessionId,
      messages: activeSessionId ? (db.chatMessages || []).filter((message) => message.sessionId === activeSessionId).slice(-100) : [],
      provider: activeProvider(),
      llmConfigured: Boolean(activeProvider())
    });
  });

  app.post("/api/agent/chat/sessions", requirePermission("write:mandate"), (req, res) => {
    const title = String(req.body.title || "新对话").trim().slice(0, 32) || "新对话";
    const session = { id: id("chat"), title, status: "active", tenantId: req.tenantId || "tenant_owner", ownerUserId: req.user?.id || null, createdAt: nowIso(), updatedAt: nowIso() };
    db.chatSessions ||= [];
    db.chatSessions.unshift(session);
    persist(res, { session, sessions: accessibleSessions(req) });
  });

  app.patch("/api/agent/chat/sessions/:id", requirePermission("write:mandate"), (req, res) => {
    const session = (db.chatSessions || []).find((item) => item.id === req.params.id);
    if (!session) return res.status(404).json({ error: "Chat session not found" });
    if (!canAccessSession(req, session)) return res.status(403).json({ error: "Chat session access denied" });
    if (req.body.title !== undefined) session.title = String(req.body.title || "未命名对话").trim().slice(0, 32);
    if (req.body.status !== undefined) session.status = String(req.body.status);
    session.updatedAt = nowIso();
    persist(res, { session, sessions: accessibleSessions(req) });
  });

  app.delete("/api/agent/chat/sessions/:id", requirePermission("write:mandate"), (req, res) => {
    const exists = (db.chatSessions || []).some((item) => item.id === req.params.id);
    if (!exists) return res.status(404).json({ error: "Chat session not found" });
    const session = (db.chatSessions || []).find((item) => item.id === req.params.id);
    if (!canAccessSession(req, session)) return res.status(403).json({ error: "Chat session access denied" });
    db.chatSessions = (db.chatSessions || []).filter((item) => item.id !== req.params.id);
    db.chatMessages = (db.chatMessages || []).filter((message) => message.sessionId !== req.params.id);
    appendAudit(db, "删除对话会话", req.params.id, req.user?.name || "Owner");
    persist(res, { ok: true, sessions: accessibleSessions(req) });
  });

  // 一次性清空聊天历史：早期悬浮助手复用 /api/agent/chat 时把只读问答混进了交易员历史，
  // 且无标记无法逐条区分。此端点清空全部对话(会话+消息+chat 来源的 agentRun)，
  // 但不动交易计划/授权/审计/成交——那些是独立持久记录。仅 Owner 可用。
  app.post("/api/agent/chat/reset", requirePermission("admin:system"), (req, res) => {
    const removedSessions = (db.chatSessions || []).length;
    const removedMessages = (db.chatMessages || []).length;
    db.chatSessions = [];
    db.chatMessages = [];
    db.agentRuns = (db.agentRuns || []).filter((r) => r.source !== "chat");
    appendAudit(db, `清空聊天历史（会话 ${removedSessions} · 消息 ${removedMessages}）`, "chat_reset", req.user?.name || "Owner", "warning");
    persist(res, { ok: true, removedSessions, removedMessages, message: `已清空 ${removedSessions} 个对话、${removedMessages} 条消息` });
  });

  app.post("/api/agent/chat", requirePermission("write:mandate"), async (req, res) => {
    try {
      if (req.body.sessionId) {
        const session = (db.chatSessions || []).find((item) => item.id === req.body.sessionId);
        if (session && !canAccessSession(req, session)) return res.status(403).json({ error: "Chat session access denied" });
      }
      const result = await runAgentChat(db, {
        message: req.body.message,
        sessionId: req.body.sessionId,
        tenantId: req.tenantId,
        userId: req.user?.id,
        userName: req.user?.name,
        isOwner: req.user?.isOwner === true,
        invocationContext: userAgentInvocation({
          userId: req.user?.id,
          userName: req.user?.name,
          permissions: resolvePermissions(db, req.user)
        })
      }, saveDb);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/agent/command", requirePermission("write:mandate"), (req, res) => {
    persist(res, runAgentCommand(db, {
      ...(req.body || {}), tenantId: req.tenantId, userId: req.user?.id,
      userName: req.user?.name, isOwner: req.user?.isOwner === true
    }));
  });
}
