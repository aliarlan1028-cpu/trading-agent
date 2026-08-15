import { appendTrace, deferOutboxEvent, markOutboxPublished, pendingOutboxEvents } from "./store.mjs";
import { assertActiveLease, isLeaseLostError } from "./leaseSafety.mjs";

// Transactional outbox dispatcher. Production may supply a durable broker
// publisher; the local default records delivery in trace and marks it published.
export async function dispatchOutbox(db, options = {}) {
  const events = pendingOutboxEvents(options.limit || 100);
  const publish = options.publish || (async (event) => {
    appendTrace(db, "outbox", `${event.eventType}:${event.aggregateId}`, "published", 0);
  });
  const results = [];
  for (const event of events) {
    let handedToPublisher = false;
    try {
      assertActiveLease(options);
      // 外部 publisher 必须把 event.id 当作幂等键。租约在远端已接收后丢失时，
      // 下一 owner 会用同一键重放查询/投递，而不是生成新的消息身份。
      await publish(event, { idempotencyKey: event.id, signal: options.signal });
      handedToPublisher = true;
      assertActiveLease(options);
      results.push({ id: event.id, published: markOutboxPublished(event.id) });
    } catch (error) {
      if (isLeaseLostError(error)) {
        results.push({ id: event.id, published: false, handedToPublisher, status: "lease_lost_pending_idempotent_replay" });
        throw error;
      }
      deferOutboxEvent(event.id, event.attempts); // 失败退避，避免每分钟无限原地重试
      results.push({ id: event.id, published: false, error: error.message });
    }
  }
  return { checked: events.length, published: results.filter((item) => item.published).length, results };
}
