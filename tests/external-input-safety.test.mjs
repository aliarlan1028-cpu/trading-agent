import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeExternalUrl, assertSafeGitHubRepositoryUrl, isPrivateIp, redirectHeaders, resolveContainedPath } from "../server/externalInputSafety.mjs";
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

test("the entire IPv6 link-local CIDR is blocked without overblocking the preceding range", async () => {
  assert.equal(isPrivateIp("fe7f::1"), false);
  for (const address of ["fe80::1", "fe8f::1", "fe90::1", "fea0::1", "febf::1", "fec0::1"]) {
    assert.equal(isPrivateIp(address), true, address);
  }
  await assert.rejects(
    () => assertSafeExternalUrl("https://link-local.example/path", {
      lookup: async () => [{ address: "fe90::1", family: 6 }]
    }),
    /私有|保留/
  );
  await assert.rejects(
    () => assertSafeExternalUrl("https://mixed.example/path", {
      lookup: async () => [{ address: "2606:4700::1111", family: 6 }, { address: "10.0.0.1", family: 4 }]
    }),
    /私有|保留/
  );
});

test("cross-origin redirects strip credentials while same-origin redirects retain them", () => {
  const original = {
    Authorization: "Bearer secret",
    Cookie: "sid=secret",
    "X-Worm-Token": "secret",
    "Content-Type": "application/json",
    "X-Request-Id": "safe"
  };
  const crossOrigin = redirectHeaders(original, "https://audit.example/start", "https://attacker.example/next");
  assert.equal(crossOrigin.has("authorization"), false);
  assert.equal(crossOrigin.has("cookie"), false);
  assert.equal(crossOrigin.has("x-worm-token"), false);
  assert.equal(crossOrigin.get("content-type"), "application/json");
  assert.equal(crossOrigin.get("x-request-id"), "safe");
  const sameOrigin = redirectHeaders(original, "https://audit.example/start", "https://audit.example/next");
  assert.equal(sameOrigin.get("authorization"), "Bearer secret");
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
