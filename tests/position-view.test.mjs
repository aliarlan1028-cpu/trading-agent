import test from "node:test";
import assert from "node:assert/strict";
import { normalizePositionsForUi, canonDirection } from "../server/positionView.mjs";

// 真实生产双行:同一 ADA 仓,引擎行(多/币量159/无liqPx/无杠杆) + 交易所行(long/1.5张/coinSize150/lev10)。
const ADA_ENGINE = { id: "eng", symbol: "ADA/USDT", source: "execution_engine", direction: "多", size: 159, entry: 0.192, mark: 0.1912, pnl: -0.13, unrealizedPnl: -0.13, roiPct: -0.42, entryRationale: "结构做多" };
const ADA_EXCHANGE = { id: "ex", exchangePositionKey: "OKX:ADA/USDT:long", symbol: "ADA/USDT", source: "exchange_rest", posSide: "long", direction: "long", size: 1.5, coinSize: 150, contractMultiplier: 100, entry: 0.192, mark: 0.1912, liqPx: 0.17, pnl: -0.12, unrealizedPnl: -0.12, leverage: 10, roiPct: -4.17 };

test("同一真实仓的引擎行+交易所行合并成一行(去重)", () => {
  const rows = normalizePositionsForUi([ADA_ENGINE, ADA_EXCHANGE]);
  assert.equal(rows.length, 1, "两行应合并为一行");
  assert.equal(rows[0].source, "execution_engine", "合并后保持 AI托管 身份");
  assert.equal(rows[0].entryRationale, "结构做多", "保留引擎的入场理由");
});

test("合并行补齐前端要的派生字段(此前恒缺)", () => {
  const [r] = normalizePositionsForUi([ADA_ENGINE, ADA_EXCHANGE]);
  assert.equal(r.quantity, 150, "数量统一为币量(交易所 coinSize 权威)");
  assert.equal(r.leverage, 10, "采用交易所真实杠杆");
  assert.equal(r.liquidationPrice, 0.17, "liqPx → liquidationPrice(对齐前端字段名)");
  assert.ok(Math.abs(r.notional - 150 * 0.1912) < 1e-6, "notional = 币量×标记价(此前恒 0)");
  assert.ok(Math.abs(r.margin - (150 * 0.1912) / 10) < 1e-6, "margin = 名义/杠杆(此前恒 —)");
  assert.ok(r.liqDistancePct > 0, "liqDistancePct 补上(此前缺→恒判安全)");
  assert.equal(r.direction, "多", "方向归一化为中文");
});

test("方向归一化:多/long/buy→多,空/short/sell→空", () => {
  for (const d of ["多", "long", "LONG", "buy"]) assert.equal(canonDirection(d), "多");
  for (const d of ["空", "short", "SHORT", "sell"]) assert.equal(canonDirection(d), "空");
});

test("纯手动/外部仓(无引擎行)保持来源标记、不误并", () => {
  const manual = { id: "m", symbol: "SUI/USDT", source: "exchange_rest", direction: "short", size: 2, coinSize: 20, mark: 0.7, leverage: 5, liqPx: 0.9, unrealizedPnl: 0.3 };
  const rows = normalizePositionsForUi([ADA_ENGINE, ADA_EXCHANGE, manual]);
  assert.equal(rows.length, 2, "不同币/方向不合并");
  const sui = rows.find((r) => r.symbol === "SUI/USDT");
  assert.equal(sui.source, "exchange_rest", "无引擎行→保持 手动/外部");
  assert.equal(sui.direction, "空");
});

test("已平仓不进视图", () => {
  const closed = { ...ADA_ENGINE, id: "c", status: "closed" };
  assert.equal(normalizePositionsForUi([closed]).length, 0);
});
