import { binanceSignedRequest, okxSignedRequest } from "../server/exchangeConnector.mjs";

const exchange = String(process.env.EXCHANGE_UNDER_TEST || "").toUpperCase();
if (!["BINANCE", "OKX"].includes(exchange)) {
  throw new Error("Set EXCHANGE_UNDER_TEST=BINANCE or OKX");
}
if (exchange === "BINANCE" && process.env.BINANCE_TESTNET !== "true") {
  throw new Error("Contract checks refuse Binance production; set BINANCE_TESTNET=true");
}
if (exchange === "OKX" && process.env.OKX_DEMO_TRADING !== "true") {
  throw new Error("Contract checks refuse OKX production; set OKX_DEMO_TRADING=true");
}

const startedAt = Date.now();
let result;
if (exchange === "BINANCE") {
  const account = await binanceSignedRequest("/fapi/v3/account");
  const openOrders = await binanceSignedRequest("/fapi/v1/openOrders");
  result = {
    exchange,
    environment: "testnet",
    accountReadable: Boolean(account),
    openOrdersReadable: Array.isArray(openOrders),
    openOrderCount: Array.isArray(openOrders) ? openOrders.length : null
  };
} else {
  const balance = await okxSignedRequest("/api/v5/account/balance");
  const positions = await okxSignedRequest("/api/v5/account/positions");
  result = {
    exchange,
    environment: "demo",
    balanceReadable: balance?.code === "0",
    positionsReadable: positions?.code === "0",
    positionCount: positions?.data?.length ?? null
  };
}
console.log(JSON.stringify({ ok: true, latencyMs: Date.now() - startedAt, ...result }, null, 2));
