import { appendTrace, commitAuditSinkCursor, readAuditSinkBatch } from "./store.mjs";

// Ships hash-chained audit records to an independently administered WORM sink.
// Cursor advances only after a successful 2xx acknowledgement.
export async function shipAuditToWorm(db, options = {}) {
  const endpoint = options.endpoint || process.env.WORM_AUDIT_ENDPOINT;
  if (!endpoint) return { status: "not_configured", shipped: 0 };
  const sinkId = options.sinkId || process.env.WORM_AUDIT_SINK_ID || "primary";
  const batch = readAuditSinkBatch(sinkId, options.limit || 100);
  if (!batch.length) return { status: "up_to_date", shipped: 0 };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.WORM_AUDIT_TOKEN ? { Authorization: `Bearer ${process.env.WORM_AUDIT_TOKEN}` } : {})
    },
    body: JSON.stringify({
      sinkId,
      fromCursor: batch[0].cursor,
      toCursor: batch.at(-1).cursor,
      records: batch.map((item) => item.entry)
    })
  });
  if (!response.ok) throw new Error(`WORM audit sink rejected batch: ${response.status}`);
  commitAuditSinkCursor(sinkId, batch.at(-1).cursor);
  appendTrace(db, "audit_worm", `审计外送 ${batch.length} 条`, "ok", 0);
  return { status: "ok", shipped: batch.length, cursor: batch.at(-1).cursor };
}
