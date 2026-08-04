import test from "node:test";
import assert from "node:assert/strict";
import { entryRationale } from "../server/executionEngine.mjs";

// 回归:入场理由捕获。plan 把 LLM 推理存在 reasoningSummary,提取函数必须读它。
// 旧 bug:只找 rationale/analysis/reason/summary,漏了 reasoningSummary → 每笔成交都落
// "未记录入场理由",复盘拿空输入,还把有完整结构分析的单子误判成"无纪律追单"。

test("reasoningSummary 必须被当成入场理由读出来(旧 bug 根因)", () => {
  assert.equal(
    entryRationale({ reasoningSummary: "4H下降趋势BOS完整，1H跌破支撑CHoCH转空" }),
    "4H下降趋势BOS完整，1H跌破支撑CHoCH转空"
  );
});

test("rationale 优先于 reasoningSummary(不改既有优先级)", () => {
  assert.equal(entryRationale({ rationale: "A", reasoningSummary: "B" }), "A");
});

test("真的没有任何理由字段才落占位符", () => {
  assert.equal(entryRationale({}), "未记录入场理由");
  assert.equal(entryRationale({ symbol: "BTC/USDT" }), "未记录入场理由");
});
