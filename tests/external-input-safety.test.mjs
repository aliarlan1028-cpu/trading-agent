import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeExternalUrl, assertSafeGitHubRepositoryUrl, isPrivateIp, resolveContainedPath } from "../server/externalInputSafety.mjs";
import { mcpToolAllowed } from "../server/mcpClient.mjs";

test("external URL policy blocks loopback, metadata, and credential-bearing URLs", async () => {
  await assert.rejects(() => assertSafeExternalUrl("http://127.0.0.1:8787/private"), /私有|保留/);
  await assert.rejects(() => assertSafeExternalUrl("http://169.254.169.254/latest/meta-data"), /私有|保留/);
  await assert.rejects(() => assertSafeExternalUrl("https://user:pass@example.com"), /凭证/);
});

test("IPv4-mapped IPv6 and reserved ranges cannot bypass the private-IP filter", () => {
  // 旧实现的真实绕过：解析到 ::ffff:127.0.0.1 的域名会被放行
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("::ffff:10.0.0.5"), true);
  assert.equal(isPrivateIp("::ffff:7f00:1"), true);       // 十六进制映射形式的 127.0.0.1
  assert.equal(isPrivateIp("::ffff:c0a8:101"), true);     // 192.168.1.1
  assert.equal(isPrivateIp("198.18.0.1"), true);          // 基准测试保留段
  assert.equal(isPrivateIp("192.0.0.8"), true);           // IETF 保留段
  assert.equal(isPrivateIp("203.0.113.10"), true);        // 文档保留段
  assert.equal(isPrivateIp("224.0.0.1"), true);           // 组播
  assert.equal(isPrivateIp("2001:db8::1"), true);         // IPv6 文档保留段
  assert.equal(isPrivateIp("not-an-ip"), true);           // 非法输入 fail-closed
  assert.equal(isPrivateIp("8.8.8.8"), false);            // 公网仍放行
  assert.equal(isPrivateIp("2606:4700::1111"), false);    // 公网 IPv6 仍放行
});

test("knowledge Git imports accept only canonical HTTPS GitHub repositories", async () => {
  await assert.rejects(() => assertSafeGitHubRepositoryUrl("ssh://git@github.com/openai/openai-node.git"), /Git/);
  await assert.rejects(() => assertSafeGitHubRepositoryUrl("https://example.com/openai/openai-node.git"), /Git/);
  await assert.rejects(() => assertSafeGitHubRepositoryUrl("https://github.com/openai/openai-node/tree/main"), /格式/);
});

test("repository subpaths cannot escape the cloned repository", () => {
  assert.throws(() => resolveContainedPath("/tmp/repo", "../../etc"), /越过/);
  assert.equal(resolveContainedPath("/tmp/repo", "docs"), "/tmp/repo/docs");
});

test("MCP tools are default-deny and require explicit per-tool grant", () => {
  assert.equal(mcpToolAllowed({ permissions: [], allowedTools: [] }, "write_order"), false);
  assert.equal(mcpToolAllowed({ permissions: ["tool:market_search"] }, "market_search"), true);
  assert.equal(mcpToolAllowed({ allowedTools: ["read_news"] }, "read_news"), true);
});
