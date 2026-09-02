import assert from "node:assert/strict";
import test from "node:test";
import {
  authIntentFromSearch,
  dispatchMarketingAuth,
  normalizeAuthMode
} from "../src/marketing/authIntent.js";

test("auth intent accepts only presentation-safe login and subscription modes", () => {
  assert.equal(normalizeAuthMode("login"), "login");
  assert.equal(normalizeAuthMode("subscribe"), "subscribe");
  assert.equal(normalizeAuthMode("token-value"), "");
  assert.equal(authIntentFromSearch("?auth=login"), "login");
  assert.equal(authIntentFromSearch("?auth=subscribe"), "subscribe");
  assert.equal(authIntentFromSearch("?auth=token-value"), "");
});

test("top-level marketing actions navigate only to the allowlisted app presentation URL", () => {
  const navigations = [];
  const messages = [];
  const navigate = (path) => navigations.push(path);
  const postMessage = (payload, origin) => messages.push({ payload, origin });

  dispatchMarketingAuth({ mode: "login", topLevel: true, origin: "https://app.example", navigate, postMessage });

  assert.deepEqual(navigations, ["/app?auth=login"]);
  assert.deepEqual(messages, []);
});

test("iframe marketing actions preserve the same-origin message and unknown modes do nothing", () => {
  const navigations = [];
  const messages = [];
  const navigate = (path) => navigations.push(path);
  const postMessage = (payload, origin) => messages.push({ payload, origin });

  dispatchMarketingAuth({ mode: "subscribe", topLevel: false, origin: "https://app.example", navigate, postMessage });
  dispatchMarketingAuth({ mode: "token-value", topLevel: true, origin: "https://app.example", navigate, postMessage });

  assert.deepEqual(messages, [{ payload: { type: "lp-start", mode: "subscribe" }, origin: "https://app.example" }]);
  assert.deepEqual(navigations, []);
});
