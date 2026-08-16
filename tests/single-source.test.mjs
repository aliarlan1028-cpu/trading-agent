// 单一来源锁定测试：曾经桌面/移动各有一份 SKILL_STATE(已漂移出 4 处不一致)、
// 在途执行单状态集 3 份复制(1 份写错)、authHeaders 3 份、保证金率 4 套公式。
// 本测试在源码层面锁死"这些定义只允许存在于 lib.jsx"，任何新副本直接红灯。
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcFiles = fs.readdirSync(path.join(rootDir, "src")).filter((f) => f.endsWith(".jsx"));
const read = (f) => fs.readFileSync(path.join(rootDir, "src", f), "utf8");

test("SKILL_STATE 只定义在 lib.jsx，桌面/移动都从 lib 导入", () => {
  for (const f of srcFiles) {
    const s = read(f);
    const defs = (s.match(/const SKILL_STATE\s*=/g) || []).length;
    if (f === "lib.jsx") assert.equal(defs, 1, "lib.jsx 应有且仅有一份定义");
    else assert.equal(defs, 0, `${f} 不得自带 SKILL_STATE 副本`);
    assert.ok(!/const MSKILL\s*=/.test(s), `${f} 不得存在旧的 MSKILL 副本`);
  }
  for (const f of ["conceptPages.jsx", "mobile.jsx"]) {
    assert.match(read(f), /import\s*\{[^}]*\bSKILL_STATE\b[^}]*\}\s*from\s*"\.\/lib\.jsx"/, `${f} 应从 lib 导入 SKILL_STATE`);
  }
});

test("在途执行单状态集只定义在 lib.jsx（OPEN_EXECUTION_STATES）", () => {
  for (const f of srcFiles) {
    const hits = (read(f).match(/"entry_partial"/g) || []).length;
    if (f === "lib.jsx") assert.equal(hits, 1, "lib.jsx 应有且仅有一份状态字面量");
    else assert.equal(hits, 0, `${f} 不得内联复制在途状态集(用 lib.OPEN_EXECUTION_STATES/countOpenExecutions)`);
  }
});

test("authHeaders 只定义在 lib.jsx", () => {
  for (const f of srcFiles) {
    const defs = (read(f).match(/function authHeaders\s*\(/g) || []).length;
    assert.equal(defs, f === "lib.jsx" ? 1 : 0, `${f} 的 authHeaders 定义数不符`);
  }
});

test("保证金率公式只定义在 lib.jsx（marginUsage）", () => {
  for (const f of srcFiles) {
    const defs = (read(f).match(/function marginUsage\s*\(/g) || []).length;
    assert.equal(defs, f === "lib.jsx" ? 1 : 0, `${f} 的 marginUsage 定义数不符`);
    if (f !== "lib.jsx") {
      // 任何"净值−可用"式的就地推导都是回潮信号
      assert.ok(!/totalEquityUsdt\)?\s*-\s*Number\(\w*[Aa]vail/.test(read(f)), `${f} 不得就地计算保证金占用`);
    }
  }
});
