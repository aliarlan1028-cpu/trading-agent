import assert from "node:assert/strict";
import test from "node:test";

const { embedBatch } = await import("../server/embeddings.mjs");

function saveEnvironment() {
  return {
    provider: process.env.EMBEDDING_PROVIDER,
    model: process.env.EMBEDDING_MODEL,
    openaiKey: process.env.OPENAI_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
    fetch: globalThis.fetch
  };
}

function restoreEnvironment(saved) {
  for (const [name, value] of [
    ["EMBEDDING_PROVIDER", saved.provider],
    ["EMBEDDING_MODEL", saved.model],
    ["OPENAI_API_KEY", saved.openaiKey],
    ["GEMINI_API_KEY", saved.geminiKey]
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = saved.fetch;
}

function providerResponse(options = {}, spec = {}) {
  const status = Number(spec.status || 200);
  const readBody = () => {
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
          resolve(String(spec.body ?? "{}"));
        }, Number(spec.delayMs || 0));
      }
    });
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    text: readBody,
    json: async () => JSON.parse(await readBody())
  };
}

test("OpenAI embedding batches stop at their deadline without retrying", async () => {
  const saved = saveEnvironment();
  let calls = 0;
  process.env.EMBEDDING_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    return providerResponse(options, { hangs: true });
  };

  try {
    await assert.rejects(
      Promise.race([
        embedBatch(["deadline test"], { timeoutMs: 15 }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Embedding call did not settle")), 100))
      ]),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.equal(error.code, "outbound_timeout");
        return true;
      }
    );
    assert.equal(calls, 1, "embedding POSTs must not be retried automatically");
  } finally {
    restoreEnvironment(saved);
  }
});

test("OpenAI embedding output remains ordered by response index", async () => {
  const saved = saveEnvironment();
  let requestBody;
  process.env.EMBEDDING_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return providerResponse(options, {
      delayMs: 15,
      body: JSON.stringify({ data: [
        { index: 1, embedding: [2, 2] },
        { index: 0, embedding: [1, 1] }
      ] })
    });
  };

  try {
    assert.deepEqual(await embedBatch(["first", "second"], { timeoutMs: 100 }), [[1, 1], [2, 2]]);
    assert.deepEqual(requestBody.input, ["first", "second"]);
  } finally {
    restoreEnvironment(saved);
  }
});

test("Gemini rejects instead of returning partial vectors when a later response body times out", async () => {
  const saved = saveEnvironment();
  let calls = 0;
  process.env.EMBEDDING_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    if (calls === 1) {
      return providerResponse(options, {
        body: JSON.stringify({
          embeddings: Array.from({ length: 32 }, (_value, index) => ({ values: [index] }))
        })
      });
    }
    return providerResponse(options, { hangs: true });
  };

  try {
    await assert.rejects(
      Promise.race([
        embedBatch(Array.from({ length: 33 }, (_value, index) => `text ${index}`), { timeoutMs: 15 }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Gemini body did not settle")), 100))
      ]),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.equal(error.code, "outbound_timeout");
        return true;
      }
    );
    assert.equal(calls, 2);
  } finally {
    restoreEnvironment(saved);
  }
});

test("OpenAI error response bodies remain covered by the batch deadline", async () => {
  const saved = saveEnvironment();
  process.env.EMBEDDING_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async (_url, options = {}) => providerResponse(options, { status: 503, hangs: true });

  try {
    await assert.rejects(
      Promise.race([
        embedBatch(["error body"], { timeoutMs: 15 }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("OpenAI error body did not settle")), 100))
      ]),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.equal(error.code, "outbound_timeout");
        return true;
      }
    );
  } finally {
    restoreEnvironment(saved);
  }
});

test("OpenAI preserves caller cancellation during response body consumption", async () => {
  const saved = saveEnvironment();
  const controller = new AbortController();
  const reason = Object.assign(new Error("embedding superseded"), { code: "embedding_superseded" });
  let markBodyStarted;
  const bodyStarted = new Promise((resolve) => {
    markBodyStarted = resolve;
  });
  process.env.EMBEDDING_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async (_url, options = {}) => providerResponse(options, {
    hangs: true,
    onRead: markBodyStarted
  });

  try {
    const request = embedBatch(["cancel body"], { timeoutMs: 1_000, signal: controller.signal });
    await Promise.race([
      bodyStarted,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("OpenAI body consumer did not start")), 100))
    ]);
    controller.abort(reason);
    await assert.rejects(
      Promise.race([
        request,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("OpenAI caller abort did not settle")), 100))
      ]),
      (error) => error === reason
    );
  } finally {
    restoreEnvironment(saved);
  }
});

test("Gemini embedding output mapping remains unchanged", async () => {
  const saved = saveEnvironment();
  let requestBody;
  process.env.EMBEDDING_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ embeddings: [{ values: [3, 4] }, { values: [5, 6] }] })
    };
  };

  try {
    assert.deepEqual(await embedBatch(["first", "second"]), [[3, 4], [5, 6]]);
    assert.equal(requestBody.requests[0].content.parts[0].text, "first");
  } finally {
    restoreEnvironment(saved);
  }
});
