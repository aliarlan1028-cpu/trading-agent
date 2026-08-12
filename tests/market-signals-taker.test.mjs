import test from "node:test";
import assert from "node:assert/strict";
import { parseContractTakerVolumeRow } from "../server/marketSignals.mjs";

test("单合约taker量解析锁定OKX数组顺序为ts/sell/buy", () => {
  const parsed = parseContractTakerVolumeRow(["1781222400000", "20", "30"]);
  assert.deepEqual(parsed, { buy: 30, sell: 20, sourceAt: "2026-06-12T00:00:00.000Z" });
});

test("单合约taker量兼容字段化响应且拒绝负数/缺时间", () => {
  assert.deepEqual(parseContractTakerVolumeRow({ ts: "1781222400000", sellVol: "20", buyVol: "30" }), { buy: 30, sell: 20, sourceAt: "2026-06-12T00:00:00.000Z" });
  assert.equal(parseContractTakerVolumeRow(["1781222400000", "-1", "30"]), null);
  assert.equal(parseContractTakerVolumeRow([null, "20", "30"]), null);
});
