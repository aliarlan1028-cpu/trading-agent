export function normalizeRelease(value) {
  const release = String(value || "").trim();
  return release && release !== "dev" && release !== "unknown" ? release : null;
}

export function hasNewWebRelease(clientRelease, serverRelease) {
  const client = normalizeRelease(clientRelease);
  const server = normalizeRelease(serverRelease);
  return Boolean(client && server && client !== server);
}
