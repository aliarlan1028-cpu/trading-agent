export function agentChatRequestForSurface(surface = "dialog", sessionId = "") {
  if (surface === "patrol") return "/api/agent/chat?sessionId=chat_autocycle";
  if (surface === "poster") return "/api/agent/chat?scope=all";
  return sessionId ? `/api/agent/chat?sessionId=${encodeURIComponent(sessionId)}` : "/api/agent/chat";
}
