import assert from "node:assert/strict";
import test from "node:test";
import { clearSecret, setConfig } from "../server/runtimeConfig.mjs";
import { seedDatabase } from "../server/store.mjs";

test("model policy changes and secret removal immediately invalidate live confirmation", () => {
  const oldModel = process.env.GEMINI_MODEL;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  const db = seedDatabase();
  db.system.realTradingAck = true;
  db.system.liveTradingEnabled = true;
  db.system.orderWriteEnabled = true;
  db.system.liveConfirmationPolicyFingerprint = "old";
  process.env.GEMINI_MODEL = "google/gemini-old";
  try {
    setConfig(db, { GEMINI_MODEL: "google/gemini-new" });
    assert.equal(db.system.realTradingAck, false);
    assert.equal(db.system.liveTradingEnabled, false);
    assert.equal(db.system.orderWriteEnabled, false);
    assert.equal(db.system.liveConfirmationInvalidationReason, "live_policy_changed");

    db.system.realTradingAck = true;
    db.system.liveTradingEnabled = true;
    db.system.orderWriteEnabled = true;
    process.env.DEEPSEEK_API_KEY = "configured";
    clearSecret(db, "DEEPSEEK_API_KEY");
    assert.equal(db.system.liveTradingEnabled, false);
    assert.equal(db.system.liveConfirmationInvalidationReason, "live_policy_secret_removed");
  } finally {
    if (oldModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = oldModel;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey;
  }
});

test("runtime configuration does not persist or report an unchanged effective value", () => {
  const previous = process.env.PORT;
  const db = seedDatabase();
  delete db.runtimeConfig.PORT;
  process.env.PORT = "3000";
  try {
    const applied = setConfig(db, { PORT: "3000" });
    assert.deepEqual(applied, []);
    assert.equal(Object.hasOwn(db.runtimeConfig, "PORT"), false);
    assert.equal(process.env.PORT, "3000");
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});
