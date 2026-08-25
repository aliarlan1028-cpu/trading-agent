import assert from "node:assert/strict";
import test from "node:test";

import { agentChatRequestForSurface } from "../src/chatArchive.js";
import { buildAgentChatPayload } from "../server/routes/agentChatRoutes.mjs";

test("AI archive surfaces request an explicit production message scope", () => {
  assert.equal(agentChatRequestForSurface("patrol"), "/api/agent/chat?sessionId=chat_autocycle");
  assert.equal(agentChatRequestForSurface("poster"), "/api/agent/chat?scope=all");
  assert.equal(agentChatRequestForSurface("dialog", "chat-manual"), "/api/agent/chat?sessionId=chat-manual");
  assert.equal(agentChatRequestForSurface("dialog"), "/api/agent/chat");
});

test("the production chat payload never substitutes a newer manual session for patrol", () => {
  const sessions = [
    { id: "chat-manual", updatedAt: "2026-08-26T02:00:00.000Z" },
    { id: "chat_autocycle", updatedAt: "2026-08-26T01:00:00.000Z" }
  ];
  const db = { chatMessages: [
    { id: "manual", sessionId: "chat-manual", createdAt: "2026-08-26T02:00:00.000Z" },
    { id: "patrol", sessionId: "chat_autocycle", createdAt: "2026-08-26T01:00:00.000Z" }
  ] };
  const patrol = buildAgentChatPayload({ db, sessions, query: { sessionId: "chat_autocycle" }, provider: { name: "test" } });
  assert.equal(patrol.activeSessionId, "chat_autocycle");
  assert.deepEqual(patrol.messages.map((row) => row.id), ["patrol"]);

  const missing = buildAgentChatPayload({ db, sessions, query: { sessionId: "missing" }, provider: null });
  assert.equal(missing.activeSessionId, null);
  assert.deepEqual(missing.messages, []);
});

test("poster scope aggregates only accessible sessions and remains bounded", () => {
  const sessions = [{ id: "chat-manual" }, { id: "chat_autocycle" }];
  const db = { chatMessages: [
    { id: "manual", sessionId: "chat-manual", createdAt: "2026-08-26T02:00:00.000Z" },
    { id: "patrol", sessionId: "chat_autocycle", createdAt: "2026-08-26T01:00:00.000Z" },
    { id: "private", sessionId: "not-accessible", createdAt: "2026-08-26T03:00:00.000Z" }
  ] };
  const payload = buildAgentChatPayload({ db, sessions, query: { scope: "all" }, provider: null });
  assert.deepEqual(payload.messages.map((row) => row.id), ["patrol", "manual"]);
  assert.equal(payload.messageScope, "all-accessible-sessions");
});
