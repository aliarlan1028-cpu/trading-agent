import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithDeadline } from "../server/outboundHttp.mjs";

function pendingFetch(_url, options = {}) {
  return new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
}

function pendingBody(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function trackedSignal() {
  const listeners = new Set();
  return {
    signal: {
      aborted: false,
      reason: undefined,
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener);
      }
    },
    listeners
  };
}

test("outbound requests fail with a stable timeout error instead of waiting forever", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    fetchWithDeadline("https://example.test/slow", {}, {
      timeoutMs: 15,
      operation: "test_slow_request",
      fetchImpl: pendingFetch
    }),
    (error) => {
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.code, "outbound_timeout");
      assert.equal(error.operation, "test_slow_request");
      return true;
    }
  );

  assert.ok(Date.now() - startedAt < 500, "deadline must settle promptly");
});

test("caller cancellation keeps the caller's abort reason", async () => {
  const controller = new AbortController();
  const reason = Object.assign(new Error("request superseded"), { code: "request_superseded" });
  const request = fetchWithDeadline("https://example.test/cancelled", {
    signal: controller.signal
  }, {
    timeoutMs: 1_000,
    operation: "test_cancelled_request",
    fetchImpl: pendingFetch
  });

  controller.abort(reason);

  await assert.rejects(request, (error) => error === reason);
});

test("a completed request is not aborted by a stale deadline timer", async () => {
  let observedSignal;
  const response = { ok: true, status: 200 };
  const result = await fetchWithDeadline("https://example.test/fast", {}, {
    timeoutMs: 15,
    operation: "test_fast_request",
    fetchImpl: async (_url, options = {}) => {
      observedSignal = options.signal;
      return response;
    }
  });

  assert.equal(result, response);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(observedSignal.aborted, false);
});

test("the deadline remains active until the response consumer settles", async () => {
  const external = trackedSignal();

  await assert.rejects(
    fetchWithDeadline("https://example.test/stalled-body", {
      signal: external.signal
    }, {
      timeoutMs: 15,
      operation: "test_stalled_body",
      fetchImpl: async () => ({ ok: true, status: 200 }),
      consume: async (_response, signal) => pendingBody(signal)
    }),
    (error) => {
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.code, "outbound_timeout");
      return true;
    }
  );

  assert.equal(external.listeners.size, 0, "the caller abort listener must be removed after timeout");
});

test("a slow response consumer succeeds before its deadline", async () => {
  let observedSignal;
  const result = await fetchWithDeadline("https://example.test/slow-body", {}, {
    timeoutMs: 80,
    operation: "test_slow_body",
    fetchImpl: async () => ({ ok: true, status: 200 }),
    consume: async (_response, signal) => {
      observedSignal = signal;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return "parsed";
    }
  });

  assert.equal(result, "parsed");
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(observedSignal.aborted, false, "the deadline timer must be cleared after body consumption");
});

test("caller cancellation during body consumption preserves the caller reason", async () => {
  const controller = new AbortController();
  const reason = Object.assign(new Error("body no longer needed"), { code: "body_superseded" });
  let markBodyStarted;
  const bodyStarted = new Promise((resolve) => {
    markBodyStarted = resolve;
  });
  const request = fetchWithDeadline("https://example.test/cancelled-body", {
    signal: controller.signal
  }, {
    timeoutMs: 1_000,
    operation: "test_cancelled_body",
    fetchImpl: async () => ({ ok: true, status: 200 }),
    consume: async (_response, signal) => {
      markBodyStarted();
      return pendingBody(signal);
    }
  });

  await Promise.race([
    bodyStarted,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("response consumer did not start")), 100))
  ]);
  controller.abort(reason);

  await assert.rejects(request, (error) => error === reason);
});

test("ordinary network errors retain their identity", async () => {
  const networkError = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });

  await assert.rejects(
    fetchWithDeadline("https://example.test/network-error", {}, {
      timeoutMs: 1_000,
      operation: "test_network_error",
      fetchImpl: async () => {
        throw networkError;
      }
    }),
    (error) => error === networkError
  );
});
