import { appendTrace, markOutboxPublished, pendingOutboxEvents } from "./store.mjs";

// Transactional outbox dispatcher. Production may supply a durable broker
// publisher; the local default records delivery in trace and marks it published.
export async function dispatchOutbox(db, options = {}) {
  const events = pendingOutboxEvents(options.limit || 100);
  const publish = options.publish || (async (event) => {
    appendTrace(db, "outbox", `${event.eventType}:${event.aggregateId}`, "published", 0);
  });
  const results = [];
  for (const event of events) {
    try {
      await publish(event);
      results.push({ id: event.id, published: markOutboxPublished(event.id) });
    } catch (error) {
      results.push({ id: event.id, published: false, error: error.message });
    }
  }
  return { checked: events.length, published: results.filter((item) => item.published).length, results };
}
