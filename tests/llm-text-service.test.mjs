import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  activeProvider as compatibilityActiveProvider,
  llmComplete as compatibilityLlmComplete,
  sanitizeLlmMessageContent as compatibilitySanitizer
} from "../server/agentChat.mjs";
import { resetLlmCircuits } from "../server/llmGateway.mjs";

const leafService = await import("../server/llmTextService.mjs").catch(() => null);
const llmComplete = leafService?.llmComplete || compatibilityLlmComplete;
const activeProvider = leafService?.activeProvider || compatibilityActiveProvider;

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY"
];

function saveEnvironment() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function clearProviderEnvironment() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function completionResponse(content = "completion ok") {
  return new Response(JSON.stringify({
    id: "llm-text-service-test",
    model: "google/gemini-3.1-pro-preview",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("LLM text completion has one leaf implementation with agentChat compatibility exports", () => {
  assert.ok(leafService, "expected the independent LLM text leaf service to exist");
  assert.equal(compatibilityActiveProvider, leafService.activeProvider);
  assert.equal(compatibilityLlmComplete, leafService.llmComplete);
  assert.equal(compatibilitySanitizer, leafService.sanitizeLlmMessageContent);
});

test("the shared external-model safety boundary remains available to agentChat", () => {
  assert.equal(typeof leafService?.assertExternalModelInputSafe, "function");
  assert.throws(
    () => leafService.assertExternalModelInputSafe("API_KEY=abcdef123456", "LLM"),
    (error) => error?.code === "external_model_secret_blocked"
  );
});

test("knowledgePipeline imports the leaf service instead of agentChat", () => {
  const source = fs.readFileSync(new URL("../server/knowledgePipeline.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']\.\/agentChat\.mjs["']/);
  assert.match(source, /from\s+["']\.\/llmTextService\.mjs["']/);
});

test("llmComplete returns null without the existing primary provider", async () => {
  const saved = saveEnvironment();
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  clearProviderEnvironment();
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return completionResponse();
  };
  resetLlmCircuits();
  try {
    assert.equal(await llmComplete("hello"), null);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnvironment(saved);
    resetLlmCircuits();
  }
});

test("llmComplete preserves external-model secret blocking", async () => {
  const saved = saveEnvironment();
  clearProviderEnvironment();
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  resetLlmCircuits();
  try {
    await assert.rejects(
      () => llmComplete("API_KEY=abcdef123456"),
      (error) => error?.code === "external_model_secret_blocked"
    );
  } finally {
    restoreEnvironment(saved);
    resetLlmCircuits();
  }
});

test("llmComplete degrades provider failures to null", async () => {
  const saved = saveEnvironment();
  const oldFetch = globalThis.fetch;
  clearProviderEnvironment();
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => { throw new Error("provider unavailable"); };
  resetLlmCircuits();
  try {
    assert.equal(await llmComplete("hello"), null);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnvironment(saved);
    resetLlmCircuits();
  }
});

test("llmComplete preserves the default prompt, truncation, sanitizer, and request options", async () => {
  const saved = saveEnvironment();
  const oldFetch = globalThis.fetch;
  let requestBody = null;
  clearProviderEnvironment();
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(String(options.body || "{}"));
    return completionResponse("stable result");
  };
  resetLlmCircuits();
  try {
    const userText = `${"a".repeat(23_995)}\\x123456789`;
    assert.equal(await llmComplete(userText), "stable result");
    assert.equal(requestBody.messages[0].role, "system");
    assert.equal(requestBody.messages[0].content, "你是专业的金融知识蒸馏助手。");
    assert.equal(requestBody.messages[1].role, "user");
    assert.equal(requestBody.messages[1].content.length, 24_000);
    assert.equal(requestBody.messages[1].content, compatibilitySanitizer(userText.slice(0, 24_000)));
    assert.equal(requestBody.temperature, 0.2);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnvironment(saved);
    resetLlmCircuits();
  }
});

test("activeProvider preserves OpenRouter-only selection and configured model mapping", () => {
  const saved = saveEnvironment();
  try {
    clearProviderEnvironment();
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    assert.equal(activeProvider(), null);

    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.GEMINI_MODEL = "gemini-custom";
    assert.deepEqual(activeProvider(), {
      role: "primary",
      gateway: "openrouter",
      family: "gemini",
      name: "openrouter",
      model: "google/gemini-custom",
      endpoint: "https://openrouter.ai/api/v1"
    });
  } finally {
    restoreEnvironment(saved);
  }
});
