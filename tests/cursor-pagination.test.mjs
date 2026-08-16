import assert from "node:assert/strict";
import test from "node:test";
import { paginateTerminalHistory } from "../server/cursorPagination.mjs";

const rows = Array.from({ length: 12 }, (_, index) => ({
  id: `row-${String(index).padStart(2, "0")}`,
  status: index % 4 === 0 ? "pending" : "completed",
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
}));

test("cursor pages only terminal history without duplicates and returns totals", () => {
  const terminal = (row) => row.status === "completed";
  const first = paginateTerminalHistory(rows, { limit: 4, isTerminal: terminal });
  const second = paginateTerminalHistory(rows, { limit: 4, cursor: first.nextCursor, isTerminal: terminal });
  const third = paginateTerminalHistory(rows, { limit: 4, cursor: second.nextCursor, isTerminal: terminal });
  const ids = [...first.items, ...second.items, ...third.items].map((row) => row.id);
  assert.equal(new Set(ids).size, 9);
  assert.equal(ids.length, 9);
  assert.deepEqual(first.summary, { total: 12, terminalTotal: 9, nonTerminalTotal: 3, statusCounts: { completed: 9 } });
  assert.equal(third.nextCursor, null);
});

test("invalid cursors fail explicitly", () => {
  assert.throws(() => paginateTerminalHistory(rows, { cursor: "not-a-cursor" }), /invalid_cursor/);
});

test("pagination summary distinguishes terminal history from still-active rows", () => {
  const rows = [
    { id: "closed", status: "completed", createdAt: "2026-01-01T00:00:00Z" },
    { id: "active", status: "running", createdAt: "2026-01-02T00:00:00Z" }
  ];
  const page = paginateTerminalHistory(rows, { isTerminal: (row) => row.status === "completed" });
  assert.equal(page.summary.total, 2);
  assert.equal(page.summary.terminalTotal, 1);
  assert.equal(page.summary.nonTerminalTotal, 1);
  assert.deepEqual(page.items.map((row) => row.id), ["closed"]);
});
