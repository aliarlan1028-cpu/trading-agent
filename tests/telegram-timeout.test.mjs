import assert from "node:assert/strict";
import test from "node:test";

const { sendTelegramClosedTradePoster, sendTelegramText } = await import("../server/telegramNotifier.mjs");

function telegramResponse(options = {}, spec = {}) {
  const status = Number(spec.status || 200);
  return {
    ok: status >= 200 && status < 300,
    status,
    json() {
      spec.onRead?.();
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        let timer;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener?.("abort", onAbort);
        };
        const onAbort = () => {
          cleanup();
          reject(signal.reason);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener?.("abort", onAbort, { once: true });
        if (!spec.hangs) {
          timer = setTimeout(() => {
            cleanup();
            try {
              resolve(JSON.parse(spec.body ?? '{"ok":true,"result":{"message_id":42}}'));
            } catch (error) {
              reject(error);
            }
          }, Number(spec.delayMs || 0));
        }
      });
    }
  };
}

test("Telegram text delivery stops at its deadline and does not retry the POST", async () => {
  const saved = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    fetch: globalThis.fetch
  };
  let calls = 0;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    return telegramResponse(options, { hangs: true });
  };

  try {
    await assert.rejects(
      Promise.race([
        sendTelegramText("deadline test", { timeoutMs: 15 }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Telegram call did not settle")), 100))
      ]),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.equal(error.code, "outbound_timeout");
        return true;
      }
    );
    assert.equal(calls, 1, "Telegram POSTs must not be retried automatically");
  } finally {
    if (saved.botToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved.botToken;
    if (saved.chatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = saved.chatId;
    globalThis.fetch = saved.fetch;
  }
});

test("Telegram multipart delivery stops at its deadline and does not retry the POST", async () => {
  const saved = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: process.env.TELEGRAM_PROFIT_POSTER_ENABLED,
    minPnl: process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT,
    minRoi: process.env.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT,
    fetch: globalThis.fetch
  };
  let calls = 0;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  process.env.TELEGRAM_PROFIT_POSTER_ENABLED = "true";
  process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT = "0";
  process.env.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT = "0";
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    return telegramResponse(options, { hangs: true });
  };

  try {
    const result = await Promise.race([
      sendTelegramClosedTradePoster({}, {
        exchange: "OKX",
        symbol: "BTC/USDT",
        direction: "long",
        filledPrice: 62_000,
        exitPrice: 64_800,
        quantity: 0.03,
        leverage: 10,
        realizedPnl: 84,
        realizedRoiPct: 45.2,
        feeUsdt: 1.24,
        holdingMinutes: 222,
        exitReason: "止盈",
        closedAt: "2026-08-13T10:00:00.000Z",
        isSample: true
      }, { timeoutMs: 15 }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Telegram multipart call did not settle")), 2_000))
    ]);
    assert.equal(result.status, "send_failed");
    assert.match(result.error, /timed out after 15ms/);
    assert.equal(calls, 1, "Telegram multipart POSTs must not be retried automatically");
  } finally {
    for (const [name, value] of [
      ["TELEGRAM_BOT_TOKEN", saved.botToken],
      ["TELEGRAM_CHAT_ID", saved.chatId],
      ["TELEGRAM_PROFIT_POSTER_ENABLED", saved.enabled],
      ["TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT", saved.minPnl],
      ["TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT", saved.minRoi]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = saved.fetch;
  }
});

test("Telegram accepts a response body that completes before its deadline", async () => {
  const saved = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    fetch: globalThis.fetch
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  globalThis.fetch = async (_url, options = {}) => telegramResponse(options, { delayMs: 15 });

  try {
    const result = await sendTelegramText("slow body", { timeoutMs: 100 });
    assert.equal(result.message_id, 42);
  } finally {
    if (saved.botToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved.botToken;
    if (saved.chatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = saved.chatId;
    globalThis.fetch = saved.fetch;
  }
});

test("Telegram preserves caller cancellation during response body consumption", async () => {
  const saved = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    fetch: globalThis.fetch
  };
  const controller = new AbortController();
  const reason = Object.assign(new Error("notification superseded"), { code: "notification_superseded" });
  let markBodyStarted;
  const bodyStarted = new Promise((resolve) => {
    markBodyStarted = resolve;
  });
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  globalThis.fetch = async (_url, options = {}) => telegramResponse(options, {
    hangs: true,
    onRead: markBodyStarted
  });

  try {
    const request = sendTelegramText("cancel body", { timeoutMs: 1_000, signal: controller.signal });
    await Promise.race([
      bodyStarted,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Telegram body consumer did not start")), 100))
    ]);
    controller.abort(reason);
    await assert.rejects(
      Promise.race([
        request,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Telegram caller abort did not settle")), 100))
      ]),
      (error) => error === reason
    );
  } finally {
    if (saved.botToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved.botToken;
    if (saved.chatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = saved.chatId;
    globalThis.fetch = saved.fetch;
  }
});

test("Telegram still tolerates a malformed JSON response body", async () => {
  const saved = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    fetch: globalThis.fetch
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  globalThis.fetch = async (_url, options = {}) => telegramResponse(options, { body: "{" });

  try {
    assert.equal(await sendTelegramText("malformed JSON", { timeoutMs: 100 }), undefined);
  } finally {
    if (saved.botToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved.botToken;
    if (saved.chatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = saved.chatId;
    globalThis.fetch = saved.fetch;
  }
});
