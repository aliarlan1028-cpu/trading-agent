import assert from "node:assert/strict";
import test from "node:test";

import { ensureAnalysisConclusionFormat } from "../server/analysisConclusion.mjs";

test("analysis conclusion is rendered as whitelist, summary, and final decision", () => {
  const output = ensureAnalysisConclusionFormat([
    "### 结论",
    "本轮无交易计划。白名单内四币全部处于多周期冲突，没有方向对齐、盈亏比和结构质量同时达标的组合；大盘 risk_off，不追。",
    "",
    "已有观察哨仍有效，无需重复登记。",
    "",
    "### 依据",
    "- BTC 多周期冲突"
  ].join("\n"), { whitelist: ["BTC/USDT", "SUI/USDT", "ADA/USDT", "DOGE/USDT"] });
  assert.match(output, /^白名单：BTC，SUI，ADA，DOGE\n总结：白名单内四币全部处于多周期冲突/);
  assert.match(output, /\n结论：本轮无交易计划。/);
  assert.match(output, /已有观察哨仍有效/);
  assert.match(output, /### 依据/);
});

test("existing three-line format remains stable and does not duplicate labels", () => {
  const output = ensureAnalysisConclusionFormat("白名单：BTC，SUI\n总结：大盘偏弱，币种方向冲突。\n结论：本轮无交易计划。\n\n### 风险\n- PPI 临近", { whitelist: ["BTC/USDT", "SUI/USDT"] });
  assert.equal((output.match(/白名单：/g) || []).length, 1);
  assert.equal((output.match(/总结：/g) || []).length, 1);
  assert.equal((output.match(/结论：/g) || []).length, 1);
  assert.match(output, /### 风险/);
});

test("guard moves a later conclusion section to the first screen without deleting earlier analysis", () => {
  const output = ensureAnalysisConclusionFormat("### 大盘\n广度偏弱。\n\n### 结论\n继续观察，不开仓。", { whitelist: ["BTC/USDT"] });
  assert.match(output, /^白名单：BTC\n总结：继续观察，不开仓。\n结论：继续观察，不开仓。/);
  assert.match(output, /### 大盘\n广度偏弱。/);
});
