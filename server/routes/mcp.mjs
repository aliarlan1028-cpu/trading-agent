// MCP Server 路由组（注册/连接/停用/权限）—— 从 index.mjs 按 registrar 范式迁出。
// 敏感字段(apiKey/headers)不回显：新建时把密钥存 vault、只回 hasApiKey。依赖经 ctx 注入。
export function registerMcpRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, storeSecret, connectMcpServer } = ctx;
  const findServer = (idv) => db.mcpServers.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "MCP server not found" });

  app.get("/api/mcp", requirePermission("admin:security"), (_req, res) => res.json((db.mcpServers || []).map(({ apiKey, apiKeySecretName, headers, ...server }) => ({
    ...server,
    hasApiKey: Boolean(apiKeySecretName || apiKey)
  }))));

  app.post("/api/mcp", requirePermission("write:mcp"), (req, res) => {
    const reserved = ["id", "status", "enabled", "permissions", "allowedTools", "tools", "source", "autoAllowAll", "agentPolicyApproved", "agentToolPolicies", "sessionId", "builtInRegistryKey"];
    const injected = reserved.filter((key) => Object.hasOwn(req.body || {}, key));
    if (injected.length) return res.status(400).json({ error: "mcp_reserved_fields_not_allowed", fields: injected });
    const serverId = id("mcp");
    const apiKey = req.body?.apiKey;
    const name = String(req.body?.name || "").trim();
    const url = String(req.body?.url || "").trim();
    if (!name || !url) return res.status(400).json({ error: "mcp_name_and_url_required" });
    const server = {
      id: serverId,
      name: name.slice(0, 120),
      url,
      transport: req.body?.transport === "sse" ? "sse" : "streamable_http",
      description: String(req.body?.description || "").slice(0, 500),
      apiKeySecretName: null,
      status: "registered",
      toolCount: 0,
      tools: [],
      enabled: true,
      source: "custom_unverified",
      autoAllowAll: false,
      permissions: [],
      allowedTools: [],
      agentPolicyApproved: false,
      agentToolPolicies: [],
      createdAt: nowIso()
    };
    if (apiKey) {
      const secretName = `MCP_${serverId}_API_KEY`;
      storeSecret(db, secretName, apiKey, "mcp");
      server.apiKeySecretName = secretName;
    }
    db.mcpServers.unshift(server);
    appendAudit(db, "注册 MCP Server", server.id, req.user?.name || db.user.name);
    const { apiKeySecretName, ...safeServer } = server;
    persist(res, { ...safeServer, hasApiKey: Boolean(apiKeySecretName) });
  });

  app.post("/api/mcp/:id/connect", requirePermission("write:mcp"), async (req, res) => {
    const result = await connectMcpServer(db, req.params.id);
    if (result.status === "missing_server") return notFound(res);
    persist(res, { ...result, message: result.status === "connected" ? `已连接，发现 ${result.server.toolCount} 个工具` : `连接失败：${result.error || result.status}` });
  });

  app.post("/api/mcp/:id/disable", requirePermission("write:mcp"), (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return notFound(res);
    server.enabled = false;
    appendAudit(db, "停用 MCP Server", server.id, db.user.name);
    persist(res, { message: `${server.name} 已停用`, server });
  });

  app.patch("/api/mcp/:id/permissions", requirePermission("admin:security"), (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return notFound(res);
    server.permissions = req.body.permissions || server.permissions || [];
    if (req.body.agentToolPolicies !== undefined) {
      const discovered = new Set((server.tools || []).map((tool) => tool.name));
      const next = {};
      for (const [toolName, value] of Object.entries(req.body.agentToolPolicies || {})) {
        if (!discovered.has(toolName) || !value || typeof value !== "object") continue;
        const effect = value.effect === "read" ? "read" : value.effect === "write" ? "write" : null;
        const requiredPermissions = [...new Set((value.requiredPermissions || []).map(String).filter(Boolean))];
        if (!effect || !requiredPermissions.length) continue;
        next[toolName] = { approved: value.approved === true, effect, requiredPermissions };
      }
      server.agentToolPolicies = next;
      server.agentPolicyApproved = true;
      server.agentPolicyApprovedAt = nowIso();
      server.agentPolicyApprovedBy = req.user?.id || null;
      server.allowedTools = [...new Set([
        ...(server.allowedTools || []),
        ...Object.entries(next).filter(([, policy]) => policy.approved).map(([toolName]) => toolName)
      ])];
    }
    server.updatedAt = nowIso();
    appendAudit(db, "更新 MCP 权限", server.id, db.user.name);
    persist(res, server);
  });
}
