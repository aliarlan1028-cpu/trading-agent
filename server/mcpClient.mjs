import { appendAudit, appendTrace, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 真实 MCP 客户端（Streamable HTTP + JSON-RPC 2.0）。
// 连接已注册的远程 MCP Server → initialize → tools/list → 把工具暴露给 Agent；
// Agent 调用时走 tools/call。支持 SSE 响应、会话 id、Bearer 鉴权。
// 网络请求走全局 undici 代理（netProxy 已装）。无 Server 时一切降级，不报错。
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";
let rpcId = 0;

function authHeaders(server) {
  const headers = { ...(server.headers || {}) };
  if (server.apiKey) headers.Authorization = `Bearer ${server.apiKey}`;
  return headers;
}

function timeout(ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// 解析响应：application/json 直接 parse；text/event-stream 从 data: 行取 JSON-RPC 消息。
async function parseRpcResponse(response, requestId) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const messages = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!trimmed || trimmed === "[DONE]") continue;
      try { messages.push(JSON.parse(trimmed)); } catch { /* 跳过非 JSON 行 */ }
    }
    return messages.find((m) => m.id === requestId) || messages.find((m) => m.result || m.error) || messages[messages.length - 1] || {};
  }
  return response.json();
}

async function mcpRpc(server, method, params = {}, options = {}) {
  const isNotification = options.notification === true;
  const id = isNotification ? undefined : (rpcId += 1);
  const body = { jsonrpc: "2.0", method, ...(isNotification ? {} : { id }), params };
  const timer = timeout(options.timeoutMs || 15000);
  try {
    const response = await fetch(server.url, {
      method: "POST",
      signal: timer.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(server.sessionId ? { "Mcp-Session-Id": server.sessionId } : {}),
        ...authHeaders(server)
      },
      body: JSON.stringify(body)
    });
    const sessionId = response.headers.get("mcp-session-id") || server.sessionId;
    if (isNotification) return { sessionId };
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const message = await parseRpcResponse(response, id);
    if (message.error) throw new Error(`MCP ${method} error: ${message.error.message || JSON.stringify(message.error)}`);
    return { result: message.result, sessionId };
  } finally {
    timer.cancel();
  }
}

export async function connectMcpServer(db, serverId) {
  const server = (db.mcpServers || []).find((item) => item.id === serverId);
  if (!server) return { status: "missing_server" };
  if (!server.url || /^local:/i.test(server.url)) {
    server.status = "unreachable";
    server.lastError = "无有效 URL（本地占位不可连接）";
    return { status: "unreachable", server };
  }
  try {
    const init = await mcpRpc(server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "trading-agent", version: "1.0.0" }
    });
    server.sessionId = init.sessionId;
    await mcpRpc(server, "notifications/initialized", {}, { notification: true }).catch(() => {});
    const list = await mcpRpc(server, "tools/list", {});
    const tools = (list.result?.tools || []).map((t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} } }));
    server.tools = tools;
    server.toolCount = tools.length;
    server.status = "connected";
    server.enabled = server.enabled !== false;
    server.connectedAt = nowIso();
    server.lastError = null;
    appendAudit(db, `连接 MCP：${server.name}，发现 ${tools.length} 个工具`, server.id, "McpClient");
    appendTrace(db, "mcp_connect", `${server.name} (${tools.length} tools)`, "ok");
    return { status: "connected", server };
  } catch (error) {
    server.status = "error";
    server.lastError = error.message;
    appendAudit(db, `连接 MCP 失败：${server.name}`, server.id, "McpClient", "warning");
    appendTrace(db, "mcp_connect", server.name, "error");
    return { status: "error", error: error.message, server };
  }
}

export function isMcpTool(name) {
  return String(name || "").startsWith("mcp__");
}

// 已连接且启用的 MCP server 的工具，以 mcp__<serverId>__<tool> 前缀暴露给 LLM。
export function enabledMcpTools(db) {
  const out = [];
  for (const server of db.mcpServers || []) {
    if (server.status !== "connected" || server.enabled === false) continue;
    for (const tool of server.tools || []) {
      out.push({
        name: `mcp__${server.id}__${tool.name}`,
        description: `[MCP:${server.name}] ${tool.description}`.slice(0, 400),
        schema: tool.inputSchema || { type: "object", properties: {} }
      });
    }
  }
  return out;
}

export async function runMcpTool(db, name, args = {}) {
  const parts = String(name).split("__");
  const serverId = parts[1];
  const toolName = parts.slice(2).join("__");
  const server = (db.mcpServers || []).find((item) => item.id === serverId);
  if (!server) return { error: `未知 MCP server：${serverId}` };
  if (server.status !== "connected" || server.enabled === false) return { error: `MCP「${server.name}」未连接或未启用` };
  try {
    const call = await mcpRpc(server, "tools/call", { name: toolName, arguments: args });
    const content = (call.result?.content || [])
      .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
      .join("\n");
    server.lastCalledAt = nowIso();
    appendTrace(db, "mcp_call", `${server.name}:${toolName}`, call.result?.isError ? "error" : "ok");
    return { server: server.name, tool: toolName, isError: Boolean(call.result?.isError), content: content.slice(0, 6000) };
  } catch (error) {
    return { error: error.message };
  }
}

export function mcpStatus(db) {
  const servers = db.mcpServers || [];
  return {
    total: servers.length,
    connected: servers.filter((s) => s.status === "connected").length,
    tools: servers.reduce((sum, s) => sum + (s.toolCount || 0), 0)
  };
}
