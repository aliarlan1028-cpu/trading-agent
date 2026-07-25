import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeExternalUrl, resolveContainedPath } from "../server/externalInputSafety.mjs";
import { mcpToolAllowed } from "../server/mcpClient.mjs";

test("external URL policy blocks loopback, metadata, and credential-bearing URLs", async () => {
  await assert.rejects(() => assertSafeExternalUrl("http://127.0.0.1:8787/private"), /私有|保留/);
  await assert.rejects(() => assertSafeExternalUrl("http://169.254.169.254/latest/meta-data"), /私有|保留/);
  await assert.rejects(() => assertSafeExternalUrl("https://user:pass@example.com"), /凭证/);
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
