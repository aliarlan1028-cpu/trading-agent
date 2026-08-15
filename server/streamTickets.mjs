import crypto from "node:crypto";

const tickets = new Map();
export const STREAM_TICKET_TTL_MS = Math.max(30_000, Number(process.env.STREAM_TICKET_TTL_MS || 5 * 60_000));

export function issueStreamTicket({
  userId,
  sessionId,
  tenantId = null,
  securityVersion = 0,
  scopes = [],
  ttlMs = STREAM_TICKET_TTL_MS
}) {
  const ticket = crypto.randomBytes(24).toString("hex");
  tickets.set(ticket, {
    userId,
    sessionId,
    tenantId,
    securityVersion: Number(securityVersion || 0),
    scopes: [...new Set((scopes || []).map(String))],
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlMs
  });
  return { ticket, expiresInMs: ttlMs };
}

export function consumeStreamTicket(ticket) {
  const key = String(ticket || "");
  const info = tickets.get(key) || null;
  tickets.delete(key);
  if (!info || info.expiresAt <= Date.now()) return null;
  return info;
}

export function invalidateStreamTickets({ userId = null, sessionId = null } = {}) {
  for (const [ticket, info] of tickets) {
    if ((userId && info.userId === userId) || (sessionId && info.sessionId === sessionId) || (!userId && !sessionId)) tickets.delete(ticket);
  }
}
