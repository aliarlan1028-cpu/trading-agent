import assert from "node:assert/strict";
import test from "node:test";

import { registerKnowledgeImportRoutes } from "../server/routes/knowledgeImport.mjs";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function harness() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "delete"]) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  }
  const db = {
    user: { id: "configured-owner", tenantId: "tenant-owner" },
    tenants: [
      { id: "tenant-a", ownerUserId: "user-a" },
      { id: "tenant-b", ownerUserId: "user-b" }
    ],
    knowledge: {
      sources: [
        { id: "book-a", tenantId: "tenant-a", ownerUserId: "user-a", title: "Book A" },
        { id: "book-b", tenantId: "tenant-a", ownerUserId: "user-a", title: "Book B" },
        { id: "foreign-book", tenantId: "tenant-b", ownerUserId: "user-b", title: "Foreign" }
      ],
      chunks: [
        { id: "a-1", sourceId: "book-a", tenantId: "tenant-a", ownerUserId: "user-a", text: "A evidence" },
        { id: "b-1", sourceId: "book-b", tenantId: "tenant-a", ownerUserId: "user-a", text: "B evidence" },
        { id: "x-1", sourceId: "foreign-book", tenantId: "tenant-b", ownerUserId: "user-b", text: "foreign evidence" }
      ]
    }
  };
  const calls = [];
  registerKnowledgeImportRoutes(app, {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    persist: (res, payload) => res.json(payload),
    ragQuery: async (_db, query, options) => {
      calls.push({ query, options });
      return { summary: "scoped", retrievedRefs: options.chunks.map((chunk) => ({ chunkId: chunk.id })) };
    }
  });
  return { routes, calls };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

test("source-scoped knowledge retrieval cannot disguise another source as the selected book", async () => {
  const { routes, calls } = harness();
  const handler = routes.get("POST /api/knowledge/rag-query").at(-1);
  const principal = { tenantId: "tenant-a", user: { id: "user-a", tenantId: "tenant-a", isOwner: true } };

  const selected = await invoke(handler, { ...principal, body: { query: "breakout", topK: 5, sourceId: "book-a" } });
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(calls[0].options.chunks.map((chunk) => chunk.id), ["a-1"]);
  assert.deepEqual(selected.body.retrievedRefs.map((ref) => ref.chunkId), ["a-1"]);

  const foreign = await invoke(handler, { ...principal, body: { query: "secret", sourceId: "foreign-book" } });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.body.error, "Knowledge source not found");
  assert.equal(calls.length, 1, "foreign source must be rejected before retrieval");
});
