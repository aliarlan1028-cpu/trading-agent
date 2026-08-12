import { appendTrace, commitAuditSinkCursor, readAuditSinkBatch } from "./store.mjs";
import { fetchExternalText } from "./externalInputSafety.mjs";

// Ships hash-chained audit records to an independently administered WORM sink.
// Cursor advances only after a successful 2xx acknowledgement.
export async function shipAuditToWorm(db, options = {}) {
  const endpoint = options.endpoint || process.env.WORM_AUDIT_ENDPOINT;
  if (!endpoint) return { status: "not_configured", shipped: 0 };
  const sinkId = options.sinkId || process.env.WORM_AUDIT_SINK_ID || "primary";
  const batch = readAuditSinkBatch(sinkId, options.limit || 100);
  if (!batch.length) return { status: "up_to_date", shipped: 0, lastSuccessAt: db.system?.wormAuditLastSuccessAt || null };
  const { response } = await fetchExternalText(endpoint, {
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
    }),
    timeoutMs: 10_000,
    maxBytes: 256 * 1024
  });
  if (!response.ok) {
    // 软失败：游标不前移（下轮重试同一批），记 warning 而不是 throw——
    // 抛异常会让定时任务每分钟产生一次失败噪音，WORM 端点抖动即刷屏。
    appendTrace(db, "audit_worm", `WORM 端点拒收（HTTP ${response.status}），批次保留待重试`, "warning", 0);
    db.system.wormAuditLastFailureAt = new Date().toISOString();
    db.system.wormAuditLastStatus = `http_${response.status}`;
    return { status: "deferred", shipped: 0, httpStatus: response.status };
  }
  commitAuditSinkCursor(sinkId, batch.at(-1).cursor);
  db.system.wormAuditLastSuccessAt = new Date().toISOString();
  db.system.wormAuditLastStatus = "ok";
  appendTrace(db, "audit_worm", `审计外送 ${batch.length} 条`, "ok", 0);
  return { status: "ok", shipped: batch.length, cursor: batch.at(-1).cursor };
}
