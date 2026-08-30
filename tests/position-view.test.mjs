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

test("合并行只继承实际选中交易所镜像的同步时间与账户绑定", () => {
  const rest = {
    ...ADA_EXCHANGE, accountId: "okx-rest", exchange: "OKX", rawSyncedAt: "2026-08-30T06:00:00Z", mark: 0.1912
  };
  const ws = {
    ...ADA_EXCHANGE, id: "ws", source: "exchange_ws", accountId: "okx-ws", exchange: "OKX-WS",
    rawSyncedAt: "2026-08-30T06:01:00Z", mark: 0.1999
  };
  const [row] = normalizePositionsForUi([ADA_ENGINE, rest, ws]);
  assert.equal(row.mark, 0.1912, "当前归一化事实优先 REST 时，镜像归属必须同时来自 REST");
  assert.deepEqual(
    { rawSyncedAt: row.rawSyncedAt, accountId: row.accountId, exchange: row.exchange },
    { rawSyncedAt: "2026-08-30T06:00:00Z", accountId: "okx-rest", exchange: "OKX" }
  );

  const [wsOnly] = normalizePositionsForUi([ADA_ENGINE, ws]);
  assert.deepEqual(
    { rawSyncedAt: wsOnly.rawSyncedAt, accountId: wsOnly.accountId, exchange: wsOnly.exchange },
    { rawSyncedAt: "2026-08-30T06:01:00Z", accountId: "okx-ws", exchange: "OKX-WS" }
  );
});

test("没有交易所镜像时不把引擎时间或绑定冒充镜像事实", () => {
  const [row] = normalizePositionsForUi([{
    ...ADA_ENGINE, rawSyncedAt: "2026-08-30T06:00:00Z", accountId: "engine-account", exchange: "ENGINE"
  }]);
  assert.deepEqual(
    { rawSyncedAt: row.rawSyncedAt, accountId: row.accountId, exchange: row.exchange },
    { rawSyncedAt: null, accountId: null, exchange: null }
  );
});

test("方向归一化:多/long/buy→多,空/short/sell→空", () => {
  for (const d of ["多", "long", "LONG", "buy"]) assert.equal(canonDirection(d), "多");
  for (const d of ["空", "short", "SHORT", "sell"]) assert.equal(canonDirection(d), "空");
});

test("纯手动/外部仓(无引擎行)保持来源标记、不误并", () => {
  const manual = { id: "m", symbol: "SUI/USDT", source: "exchange_rest", direction: "short", size: 2, coinSize: 20, mark: 0.7, leverage: 5, liqPx: 0.9, unrealizedPnl: 0.3, rawSyncedAt: "2026-08-30T06:02:00Z", accountId: "manual-account", exchange: "OKX" };
  const rows = normalizePositionsForUi([ADA_ENGINE, ADA_EXCHANGE, manual]);
  assert.equal(rows.length, 2, "不同币/方向不合并");
  const sui = rows.find((r) => r.symbol === "SUI/USDT");
  assert.equal(sui.source, "exchange_rest", "无引擎行→保持 手动/外部");
  assert.equal(sui.direction, "空");
  assert.equal(sui.rawSyncedAt, manual.rawSyncedAt);
  assert.equal(sui.accountId, manual.accountId);
  assert.equal(sui.exchange, manual.exchange);
});

test("已平仓不进视图", () => {
  const closed = { ...ADA_ENGINE, id: "c", status: "closed" };
  assert.equal(normalizePositionsForUi([closed]).length, 0);
});

test("revoked, accessor, symbol-key, and non-plain Position siblings are isolated before grouping", () => {
  const sourceAccessor = { ...ADA_EXCHANGE, id: "hostile-source" };
  Object.defineProperty(sourceAccessor, "source", { enumerable: true, get() { throw new Error("source getter must not run"); } });
  const statusAccessor = { ...ADA_EXCHANGE, id: "hostile-status" };
  Object.defineProperty(statusAccessor, "status", { enumerable: true, get() { throw new Error("status getter must not run"); } });
  const symbolAccessor = { ...ADA_EXCHANGE, id: "hostile-symbol" };
  Object.defineProperty(symbolAccessor, "symbol", { enumerable: true, get() { throw new Error("symbol getter must not run"); } });
  const directionAccessor = { ...ADA_EXCHANGE, id: "hostile-direction", posSide: undefined };
  Object.defineProperty(directionAccessor, "direction", { enumerable: true, get() { throw new Error("direction getter must not run"); } });
  const symbolKey = { ...ADA_EXCHANGE, id: "hostile-symbol-key", [Symbol("hostile")]: true };
  const nonPlain = Object.assign(Object.create({ inherited: true }), ADA_EXCHANGE, { id: "hostile-prototype" });
  const excessive = { ...ADA_EXCHANGE, id: "hostile-excessive" };
  for (let index = 0; index < 260; index += 1) excessive[`extra${index}`] = index;
  const hostileTimestamp = { ...ADA_EXCHANGE, id: "hostile-timestamp", rawSyncedAt: { [Symbol.toPrimitive]() { throw new Error("timestamp coercion must not run"); } } };
  const revoked = Proxy.revocable({ ...ADA_EXCHANGE, id: "hostile-revoked" }, {});
  revoked.revoke();

  let rows;
  assert.doesNotThrow(() => {
    rows = normalizePositionsForUi([
      ADA_ENGINE, ADA_EXCHANGE, revoked.proxy, sourceAccessor, statusAccessor, symbolAccessor, directionAccessor,
      symbolKey, nonPlain, excessive, hostileTimestamp
    ]);
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { source: rows[0].source, symbol: rows[0].symbol, quantity: rows[0].quantity, mark: rows[0].mark },
    { source: "execution_engine", symbol: "ADA/USDT", quantity: 150, mark: 0.1912 }
  );
});

test("hostile numeric coercion is never invoked and cannot displace a valid mirror", () => {
  const hostileNumber = { [Symbol.toPrimitive]() { throw new Error("numeric coercion must not run"); } };
  const hostileMirror = {
    ...ADA_EXCHANGE,
    id: "hostile-number",
    rawSyncedAt: "2026-08-31T00:00:00.000Z",
    mark: hostileNumber
  };
  let rows;
  assert.doesNotThrow(() => {
    rows = normalizePositionsForUi([ADA_ENGINE, ADA_EXCHANGE, hostileMirror]);
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { quantity: rows[0].quantity, mark: rows[0].mark, liquidationPrice: rows[0].liquidationPrice },
    { quantity: 150, mark: 0.1912, liquidationPrice: 0.17 }
  );
});

test("hostile Execution siblings cannot abort or rewrite an unrelated valid account-bound Position", () => {
  const at = "2026-08-31T00:00:00.000Z";
  const validEngine = { ...ADA_ENGINE, executionOrderId: "exec-valid" };
  const validMirror = { ...ADA_EXCHANGE, accountId: "account-a", exchange: "OKX", rawSyncedAt: at };
  const unrelatedEngine = {
    id: "eng-sol", positionId: "position-sol", executionOrderId: "exec-hostile", symbol: "SOL/USDT",
    source: "execution_engine", direction: "long", quantity: 2, entry: 20, mark: 21
  };
  const unrelatedMirror = {
    id: "mirror-sol", symbol: "SOL/USDT", source: "exchange_rest", direction: "long", coinSize: 2,
    mark: 21, entry: 20, leverage: 2, accountId: "account-b", exchange: "OKX", rawSyncedAt: at
  };
  const validExecution = {
    id: "exec-valid", symbol: "ADA/USDT", direction: "long", accountId: "account-a", exchange: "OKX"
  };
  const symbolAccessor = {
    id: "exec-hostile", direction: "long", accountId: "account-b", exchange: "OKX"
  };
  Object.defineProperty(symbolAccessor, "symbol", { enumerable: true, get() { throw new Error("execution symbol getter must not run"); } });
  const hostileDuplicate = {
    id: "exec-valid", direction: "long", accountId: "account-a", exchange: "OKX"
  };
  Object.defineProperty(hostileDuplicate, "symbol", { enumerable: true, get() { throw new Error("duplicate execution getter must not run"); } });
  const getTrap = new Proxy({
    id: "exec-hostile", symbol: "SOL/USDT", direction: "long", accountId: "account-b", exchange: "OKX"
  }, {
    get(target, field, receiver) {
      if (field === "symbol" || field === "direction") throw new Error("execution get trap must not run");
      return Reflect.get(target, field, receiver);
    }
  });
  const revoked = Proxy.revocable({
    id: "exec-hostile", symbol: "SOL/USDT", direction: "long", accountId: "account-b", exchange: "OKX"
  }, {});
  revoked.revoke();

  for (const hostileExecution of [symbolAccessor, hostileDuplicate, getTrap, revoked.proxy]) {
    let rows;
    assert.doesNotThrow(() => {
      rows = normalizePositionsForUi(
        [validEngine, validMirror, unrelatedEngine, unrelatedMirror],
        { executionOrders: [validExecution, hostileExecution] }
      );
    });
    const valid = rows.find((row) => row.positionId === "eng" || row.id === "eng");
    assert.deepEqual(
      { source: valid?.source, accountId: valid?.accountId, exchange: valid?.exchange, mark: valid?.mark },
      { source: "execution_engine", accountId: "account-a", exchange: "OKX", mark: 0.1912 }
    );
  }
});

for (const hostile of [
  {
    label: "an unknown nested getter",
    field: "hostileMetadata",
    value() {
      const nested = {};
      Object.defineProperty(nested, "secret", {
        enumerable: true,
        get() { throw new Error("nested getter must not run during response serialization"); }
      });
      return nested;
    }
  },
  {
    label: "an unknown revoked proxy",
    field: "hostileMetadata",
    value() {
      const revoked = Proxy.revocable({ secret: "must not serialize" }, {});
      revoked.revoke();
      return revoked.proxy;
    }
  },
  {
    label: "an own throwing toJSON function",
    field: "toJSON",
    value() {
      return function toJSON() { throw new Error("row toJSON must not run during response serialization"); };
    }
  }
]) {
  test(`normalized Position output is JSON-safe with ${hostile.label}`, () => {
    const engine = {
      ...ADA_ENGINE,
      positionId: "position-json-safe",
      executionOrderId: "execution-json-safe",
      planId: "plan-json-safe",
      stopLoss: 0.18,
      takeProfits: [0.2, "0.21"],
      openedAt: "2026-08-31T00:00:00.000Z",
      [hostile.field]: hostile.value()
    };
    const mirror = {
      ...ADA_EXCHANGE,
      accountId: "account-json-safe",
      exchange: "OKX",
      rawSyncedAt: "2026-08-31T00:01:00.000Z"
    };
    const rows = normalizePositionsForUi([engine, mirror], {
      executionOrders: [{
        id: "execution-json-safe", symbol: "ADA/USDT", direction: "long",
        accountId: "account-json-safe", exchange: "OKX"
      }]
    });

    let encoded;
    assert.doesNotThrow(() => { encoded = JSON.stringify(rows); });
    const [row] = JSON.parse(encoded);
    assert.equal(row.positionId, "position-json-safe");
    assert.equal(row.executionOrderId, "execution-json-safe");
    assert.equal(row.stopLoss, 0.18);
    assert.deepEqual(row.takeProfits, [0.2, 0.21]);
    assert.equal(Object.hasOwn(row, hostile.field), false);
  });
}

test("malformed target collections are omitted without invalidating an otherwise truthful Position", () => {
  const revokedTargets = Proxy.revocable([0.2, 0.21], {});
  revokedTargets.revoke();
  const [row] = normalizePositionsForUi([{
    ...ADA_ENGINE,
    positionId: "position-malformed-targets",
    stopLoss: 0.18,
    takeProfits: revokedTargets.proxy
  }, ADA_EXCHANGE]);

  let encoded;
  assert.doesNotThrow(() => { encoded = JSON.stringify(row); });
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.positionId, "position-malformed-targets");
  assert.equal(parsed.stopLoss, 0.18);
  assert.equal(Object.hasOwn(parsed, "takeProfits"), false);
});
