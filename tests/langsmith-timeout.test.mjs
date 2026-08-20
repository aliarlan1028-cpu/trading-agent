import assert from "node:assert/strict";
import test from "node:test";

const { recordLangSmithRun } = await import("../server/langSmith.mjs");

test("LangSmith timeout degrades to send_failed without retrying or blocking the Agent", async () => {
  const saved = {
    apiKey: process.env.LANGSMITH_API_KEY,
    endpoint: process.env.LANGSMITH_ENDPOINT,
    fetch: globalThis.fetch
  };
  let calls = 0;
  process.env.LANGSMITH_API_KEY = "test-langsmith-key";
  process.env.LANGSMITH_ENDPOINT = "https://langsmith.example.test";
  globalThis.fetch = (_url, options = {}) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  };

  try {
    const result = await Promise.race([
      recordLangSmithRun({ traces: [] }, {
        name: "deadline-test",
        inputs: { prompt: "hello" },
        outputs: { status: "completed" }
      }, { timeoutMs: 15 }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("LangSmith call did not settle")), 100))
    ]);

    assert.equal(result.status, "send_failed");
    assert.match(result.error, /timed out/i);
    assert.equal(result.payload.name, "deadline-test");
    assert.equal(calls, 1, "observability POSTs must not be retried automatically");
  } finally {
    if (saved.apiKey === undefined) delete process.env.LANGSMITH_API_KEY;
    else process.env.LANGSMITH_API_KEY = saved.apiKey;
    if (saved.endpoint === undefined) delete process.env.LANGSMITH_ENDPOINT;
    else process.env.LANGSMITH_ENDPOINT = saved.endpoint;
    globalThis.fetch = saved.fetch;
  }
});
