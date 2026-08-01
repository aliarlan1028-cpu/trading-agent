// 下单编码硬约束:clOrdId 清洗 + 永续 instId 后缀。
// 这两处都出过"静默丢单/读空"的真 bug(clOrdId 带下划线→OKX 51000 整单拒;
// 资金费率历史用了现货 instId→永远空)。锁死回归。
import test from "node:test";
import assert from "node:assert/strict";
import { okxCleanClOrdId } from "../server/tradeActions.mjs";
import { toOkxSymbol } from "../server/exchangeConnector.mjs";

test("okxCleanClOrdId:只留字母数字,长度≤32", () => {
  // 曾用带下划线的 id(exec_/stop_/tp1_)→ OKX 整单拒 sCode=51000
  assert.equal(okxCleanClOrdId("exec_abc-123"), "execabc123");
  assert.equal(okxCleanClOrdId("stop_2026_07_31"), "stop20260731");
  assert.equal(okxCleanClOrdId("tp1@#$%^&*"), "tp1");
  assert.match(okxCleanClOrdId("coid_ms93n92d_p5zsu4"), /^[a-zA-Z0-9]+$/);
  // 超长截断到 32
  const long = "a".repeat(50);
  assert.equal(okxCleanClOrdId(long).length, 32);
  // 空/异常输入不崩
  assert.equal(okxCleanClOrdId(null), "");
  assert.equal(okxCleanClOrdId(undefined), "");
  assert.equal(okxCleanClOrdId(""), "");
});

test("toOkxSymbol:永续必须带 -SWAP 后缀(资金费率/永续下单专用)", () => {
  // 资金费率历史是永续专属;不带 swap 会拿现货 instId → 空数据(实锤过的 bug)
  assert.equal(toOkxSymbol("BTC/USDT", "swap"), "BTC-USDT-SWAP");
  assert.equal(toOkxSymbol("ETH/USDT", "perpetual_usdt"), "ETH-USDT-SWAP");
  assert.equal(toOkxSymbol("SOL/USDT", "perpetual"), "SOL-USDT-SWAP");
});

test("toOkxSymbol:现货(无 marketType)不加 -SWAP", () => {
  assert.equal(toOkxSymbol("BTC/USDT"), "BTC-USDT");
  assert.equal(toOkxSymbol("BTC/USDT", ""), "BTC-USDT");
});

test("toOkxSymbol:已带 -SWAP 不重复追加,大小写归一", () => {
  assert.equal(toOkxSymbol("BTC-USDT-SWAP", "swap"), "BTC-USDT-SWAP");
  assert.equal(toOkxSymbol("btc/usdt", "swap"), "BTC-USDT-SWAP");
});
