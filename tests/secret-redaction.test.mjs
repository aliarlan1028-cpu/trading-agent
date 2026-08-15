import test from "node:test";
import assert from "node:assert/strict";
import { containsLikelySecret, scrubSecrets } from "../server/secretRedaction.mjs";

test("all registered production credential families are blocked as naked outbound text and redacted by key", () => {
  const canaries = {
    TELEGRAM_BOT_TOKEN: "tg-canary-123456",
    WORM_AUDIT_TOKEN: "worm-canary-123456",
    REGISTRATION_EMAIL_WEBHOOK_TOKEN: "registration-canary-123456",
    ADMIN_PASSWORD: "admin-canary-123456",
    BINANCE_API_SECRET: "binance-canary-123456"
  };
  const previous = Object.fromEntries(Object.keys(canaries).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, canaries);
    for (const [key, value] of Object.entries(canaries)) {
      assert.equal(containsLikelySecret(`unlabelled value ${value}`), true, key);
      assert.equal(scrubSecrets({ [key]: value })[key], "[REDACTED]", key);
      assert.equal(JSON.stringify(scrubSecrets({ nested: [{ [key.toLowerCase()]: value }] })).includes(value), false, key);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("secret-shaped object keys are scrubbed without corrupting ordinary domain token fields", () => {
  const input = {
    webhook_url: "https://secret.invalid/hook/value",
    payment_token: "private-token-value",
    symbol: "TOKEN/USDT",
    token: "governance",
    tokenSymbol: "TOKEN"
  };
  const output = scrubSecrets(input);
  assert.equal(output.webhook_url, "[REDACTED]");
  assert.equal(output.payment_token, "[REDACTED]");
  assert.equal(output.symbol, "TOKEN/USDT");
  assert.equal(output.token, "governance");
  assert.equal(output.tokenSymbol, "TOKEN");
});
