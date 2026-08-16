function rowTime(row = {}) {
  const value = row.updatedAt || row.completedAt || row.closedAt || row.createdAt || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ time: rowTime(row), id: String(row?.id || "") }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!Number.isFinite(Number(parsed.time)) || typeof parsed.id !== "string") throw new Error("invalid");
    return { time: Number(parsed.time), id: parsed.id };
  } catch {
    const error = new Error("invalid_cursor");
    error.status = 400;
    throw error;
  }
}

function beforeCursor(row, cursor) {
  if (!cursor) return true;
  const time = rowTime(row);
  if (time !== cursor.time) return time < cursor.time;
  return String(row?.id || "") < cursor.id;
}

export function paginateTerminalHistory(rows = [], options = {}) {
  const isTerminal = options.isTerminal || (() => true);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const cursor = decodeCursor(options.cursor);
  const list = (Array.isArray(rows) ? rows : []).slice();
  const terminal = list.filter(isTerminal).sort((a, b) => rowTime(b) - rowTime(a) || String(b?.id || "").localeCompare(String(a?.id || "")));
  const eligible = terminal.filter((row) => beforeCursor(row, cursor));
  const items = eligible.slice(0, limit);
  const hasMore = eligible.length > items.length;
  const statusCounts = {};
  for (const row of terminal) {
    const status = String(row?.status || row?.type || "unknown").toLowerCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return {
    items,
    nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null,
    hasMore,
    limit,
    summary: { total: list.length, terminalTotal: terminal.length, nonTerminalTotal: list.length - terminal.length, statusCounts }
  };
}
