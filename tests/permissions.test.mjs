import test from "node:test";
import assert from "node:assert/strict";
import { TRADER_PERMISSIONS } from "../server/store.mjs";
import { resolvePermissions } from "../server/auth.mjs";

test("trader cannot self-approve, execute, or administer security", () => {
  for (const forbidden of ["approve:trade_plan", "approve:knowledge_skill", "critical:trade_execution", "admin:security", "write:mcp", "write:skills", "write:risk"]) {
    assert.equal(TRADER_PERMISSIONS.includes(forbidden), false, forbidden);
  }
});

test("users without a role resolve to zero permissions (fail-closed)", () => {
  const db = {
    user: { id: "owner1" },
    roles: [{ id: "role_admin", name: "管理员", permissions: ["*"] }]
  };
  // 非 owner、无角色：绝不能落到默认管理员
  assert.deepEqual(resolvePermissions(db, { id: "u2", name: "无角色用户" }), []);
  // 被禁用用户无权限
  assert.deepEqual(resolvePermissions(db, { id: "u3", role: "管理员", status: "disabled" }), []);
});

test("legacy owner without explicit role keeps admin access", () => {
  const db = {
    user: { id: "owner1" },
    roles: [{ id: "role_admin", name: "管理员", permissions: ["*"] }]
  };
  assert.deepEqual(resolvePermissions(db, { id: "owner1" }), ["*"]);
});
