import assert from "node:assert/strict";
import test from "node:test";
import { transportSecurityPolicy } from "../server/transportSecurity.mjs";
import { connectionSecurityStatus, shouldAttemptNativeFallback } from "../src/connectionSecurity.js";

test("production API transport rejects HTTP and permits HTTPS", () => {
  assert.equal(transportSecurityPolicy({ secure: false, protocol: "http", path: "/api/auth/login", ip: "203.0.113.4" }, { NODE_ENV: "production" }).allowed, false);
  assert.equal(transportSecurityPolicy({ secure: true, protocol: "https", path: "/api/auth/login" }, { NODE_ENV: "production" }).allowed, true);
  assert.equal(transportSecurityPolicy({ secure: false, protocol: "http", path: "/api/health", ip: "127.0.0.1" }, { NODE_ENV: "production" }).label, "local_health_exception");
});

test("client labels actual transport and only allows explicit local development HTTP", () => {
  assert.deepEqual(connectionSecurityStatus("https://example.com", { production: true }), { secure: true, allowed: true, protocol: "https" });
  assert.equal(connectionSecurityStatus("http://example.com", { production: true }).allowed, false);
  assert.equal(connectionSecurityStatus("http://example.com", { production: false, allowLocalDevelopment: true }).allowed, false);
  const local = connectionSecurityStatus("http://127.0.0.1:3000", { production: true, allowLocalDevelopment: true });
  assert.equal(local.allowed, true);
  assert.equal(local.secure, false);
  assert.equal(local.reason, "local_development_exception");
});

test("native fallback cannot be triggered by an obsolete or aborted request", () => {
  const base = { native: true, activeBase: "https://new.example", fallbackBase: "https://default.example" };
  assert.equal(shouldAttemptNativeFallback({ ...base, current: false, error: new Error("old backend failed") }), false);
  assert.equal(shouldAttemptNativeFallback({ ...base, current: true, error: Object.assign(new Error("cancelled"), { name: "AbortError" }) }), false);
  assert.equal(shouldAttemptNativeFallback({ ...base, current: true, error: new Error("network failed") }), true);
});
