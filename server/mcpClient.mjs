import { appendAudit, appendTrace, nowIso } from "./store.mjs";
import { withSafeExternalResponse } from "./externalInputSafety.mjs";
import { readSecret } from "./securityOps.mjs";

// ---------------------------------------------------------------------------
// 真实 MCP 客户端（Streamable HTTP + JSON-RPC 2.0）。
// 连接已注册的远程 MCP Server → initialize → tools/list → 把工具暴露给 Agent；
// Agent 调用时走 tools/call。支持 SSE 响应、会话 id、Bearer 鉴权。
// 网络请求走全局 undici 代理（netProxy 已装）。无 Server 时一切降级，不报错。
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";
let rpcId = 0;

function authHeaders(db, server) {
  const headers = { ...(server.headers || {}) };
  const apiKey = server.apiKeySecretName ? readSecret(db, server.apiKeySecretName) : null;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function timeout(ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// 解析响应：application/json 直接 parse；text/event-stream 从 data: 行取 JSON-RPC 消息。
async function readRpcText(response, maxBytes = 2 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("MCP response exceeds size limit");
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("MCP response exceeds size limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseRpcResponse(response, requestId) {
  const contentType = response.headers.get("content-type") || "";
  const text = await readRpcText(response);
  if (contentType.includes("text/event-stream")) {
    const messages = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!trimmed || trimmed === "[DONE]") continue;
      try { messages.push(JSON.parse(trimmed)); } catch { /* 跳过非 JSON 行 */ }
    }
    return messages.find((m) => m.id === requestId) || messages.find((m) => m.result || m.error) || messages[messages.length - 1] || {};
  }
  return JSON.parse(text);
}

async function mcpRpc(db, server, method, params = {}, options = {}) {
  const isNotification = options.notification === true;
  const id = isNotification ? undefined : (rpcId += 1);
  const body = { jsonrpc: "2.0", method, ...(isNotification ? {} : { id }), params };
  const timer = timeout(options.timeoutMs || 15000);
  try {
    return await withSafeExternalResponse(server.url, {
      method: "POST",
      signal: timer.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...((server.sessionId && method !== "initialize") ? { "Mcp-Session-Id": server.sessionId } : {}),
        ...authHeaders(db, server)
      },
      body: JSON.stringify(body),
      timeoutMs: options.timeoutMs || 15000,
      maxRedirects: 3
    }, async (response) => {
      const sessionId = response.headers.get("mcp-session-id") || server.sessionId;
      if (isNotification) {
        // 即使 notification 无响应体，也消费/取消 body，确保连接资源可回收。
        await readRpcText(response).catch(() => "");
        return { sessionId };
      }
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${(await readRpcText(response)).slice(0, 200)}`);
      const message = await parseRpcResponse(response, id);
      if (message.error) throw new Error(`MCP ${method} error: ${message.error.message || JSON.stringify(message.error)}`);
      return { result: message.result, sessionId };
    });
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
  server.sessionId = undefined; // 每次连接前清掉持久化的旧会话:MCP 规范要求 initialize 不得带 sessionId(带了会被 CoinGecko 等以 -32600 拒绝)
  try {
    const init = await mcpRpc(db, server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "trading-agent", version: "1.0.0" }
    });
    server.sessionId = init.sessionId;
    await mcpRpc(db, server, "notifications/initialized", {}, { notification: true }).catch(() => {});
    const list = await mcpRpc(db, server, "tools/list", {});
    const previousFingerprints = new Map((server.tools || []).map((tool) => [tool.name, tool.agentDefinitionFingerprint]));
    const tools = (list.result?.tools || []).map((t) => {
      const inputSchema = t.inputSchema || { type: "object", properties: {} };
      const agentDefinitionFingerprint = JSON.stringify({ name: t.name, description: t.description || "", inputSchema });
      return { name: t.name, description: t.description || "", inputSchema, agentDefinitionFingerprint };
    });
    server.tools = tools;
    server.toolCount = tools.length;
    const discovered = new Set(tools.map((tool) => tool.name));
    server.allowedTools = (server.allowedTools || []).filter((toolName) => discovered.has(toolName));
    const retainedPolicies = {};
    for (const [toolName, policy] of Object.entries(server.agentToolPolicies || {})) {
      const tool = tools.find((item) => item.name === toolName);
      if (tool && previousFingerprints.get(toolName) === tool.agentDefinitionFingerprint) retainedPolicies[toolName] = policy;
    }
    server.agentToolPolicies = retainedPolicies;
    server.agentPolicyApproved = Object.keys(retainedPolicies).length > 0;
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

export function mcpToolAllowed(server, toolName) {
  const allowedTools = Array.isArray(server.allowedTools) ? server.allowedTools : [];
  const permissions = Array.isArray(server.permissions) ? server.permissions : [];
  return allowedTools.includes(toolName) || permissions.includes(`tool:${toolName}`);
}

function parsedMcpToolName(name) {
  const parts = String(name || "").split("__");
  return { serverId: parts[1] || "", toolName: parts.slice(2).join("__") };
}

// MCP 的“允许调用”与“可由哪个 Agent 主体调用”是两层权限。
// 第三方工具默认不进入 Agent；只有管理员批准且声明 RBAC 能力的逐工具策略可用。
// 即使是仓库内置的官方连接，也不按可写数据库字段获得豁免；工具发现或定义变化后
// 必须重新经过管理员逐工具批准。
export function resolveMcpAgentToolPolicy(db, name) {
  const { serverId, toolName } = parsedMcpToolName(name);
  const server = (db.mcpServers || []).find((item) => item.id === serverId);
  if (!server || server.status !== "connected" || server.enabled === false || !mcpToolAllowed(server, toolName)) return null;
  const policy = server.agentToolPolicies?.[toolName];
  if (server.agentPolicyApproved !== true || !policy || policy.approved !== true) return null;
  const effect = policy.effect === "read" ? "read" : policy.effect === "write" ? "write" : null;
  const declared = [...new Set((policy.requiredPermissions || []).map(String).filter(Boolean))];
  if (!effect || !declared.length) return null;
  if (effect === "write" && !declared.some((permission) => /^(write:|approve:|critical:|admin:|trade\.write_guarded$)/.test(permission))) return null;
  return { allowed: true, effect, requiredPermissions: declared, serverId, toolName };
}

// 已连接且启用的 MCP server 的工具，以 mcp__<serverId>__<tool> 前缀暴露给 LLM。
export function enabledMcpTools(db) {
  const out = [];
  for (const server of db.mcpServers || []) {
    if (server.status !== "connected" || server.enabled === false) continue;
    for (const tool of server.tools || []) {
      if (!mcpToolAllowed(server, tool.name)) continue;
      out.push({
        name: `mcp__${server.id}__${tool.name}`,
        description: `[MCP:${server.name}] ${tool.description}`.slice(0, 400),
        schema: tool.inputSchema || { type: "object", properties: {} },
        agentPolicy: resolveMcpAgentToolPolicy(db, `mcp__${server.id}__${tool.name}`)
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
  if (!mcpToolAllowed(server, toolName)) return { error: `MCP 工具未获授权：${server.name}:${toolName}` };
  try {
    const call = await mcpRpc(db, server, "tools/call", { name: toolName, arguments: args });
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

// 开机种子:接入 CoinGecko 官方免费 MCP(行业领先、免 key、10k 调用/月、只读行情/OHLCV/链上)。
// 幂等:已存在则不重复注册;返回是否需要连接。
export function ensureCoingeckoMcp(db) {
  db.mcpServers ||= [];
  const existing = db.mcpServers.find((s) => s.id === "mcp_coingecko");
  if (existing) return existing;
  const server = {
    id: "mcp_coingecko",
    name: "CoinGecko 行情",
    url: "https://mcp.api.coingecko.com/mcp",
    transport: "streamable_http",
    source: "official",
    builtInRegistryKey: "coingecko_market_data",
    status: "registered",
    enabled: true,
    autoAllowAll: false,
    permissions: [],
    allowedTools: [],
    tools: [],
    toolCount: 0,
    createdAt: nowIso()
  };
  db.mcpServers.unshift(server);
  appendAudit(db, "接入 CoinGecko 官方 MCP(免费只读行情)", server.id, "McpSeed");
  return server;
}
