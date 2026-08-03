import test from "node:test";
import assert from "node:assert/strict";
import { applyBinanceSnapshot, applyOkxSnapshot } from "../server/exchangeConnector.mjs";

// 回归:持仓盈亏曲线读的是每条 accountSnapshot 的 totalEquityUsdt。
// 旧 bug:净值只写 db.portfolio.totalEquityUsdt(最新一个数),从没盖到快照上 →
// 前端 accountSnapshots.map(i=>i.totalEquityUsdt) 永远是 [undefined,...] → 曲线永远"暂无数据"。
// 修复后:apply* 把净值同时盖到快照对象上,曲线才有历史点可画。

const minimalDb = () => ({ positions: [], orders: [], portfolio: {}, accountSnapshots: [] });

test("Binance 快照:净值盖到快照上,曲线才读得到", () => {
  const db = minimalDb();
  const snapshot = { exchange: "BINANCE", positions: [], openOrders: [], balances: [{ asset: "USDT", free: "500", locked: "100" }] };
  applyBinanceSnapshot(db, snapshot);
  assert.equal(snapshot.totalEquityUsdt, 600, "快照应带上当时净值(free+locked)");
  assert.equal(db.portfolio.totalEquityUsdt, 600, "portfolio 最新值仍照写");
});

test("OKX 快照:净值盖到快照上", async () => {
  const db = minimalDb();
  const snapshot = { exchange: "OKX", positions: [], openOrders: [], balances: [{ totalEq: "1234.5", details: [{ ccy: "USDT", availEq: "1000" }] }] };
  await applyOkxSnapshot(db, snapshot);
  assert.equal(snapshot.totalEquityUsdt, 1234.5);
  assert.equal(db.portfolio.totalEquityUsdt, 1234.5);
});

test("同步失败(无净值)不伪造点:快照不带 totalEquityUsdt,曲线诚实略过", () => {
  const db = minimalDb();
  const snapshot = { exchange: "BINANCE", positions: [], openOrders: [], balances: [] }; // missing_credentials 等:无余额
  applyBinanceSnapshot(db, snapshot);
  assert.equal(snapshot.totalEquityUsdt, undefined, "无净值时不盖假点(MiniLine 会 filter 掉)");
});
