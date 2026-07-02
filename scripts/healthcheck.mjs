const base = process.env.API_BASE_URL || "http://127.0.0.1:8787";

async function request(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

const [health, readiness, auditChain] = await Promise.all([
  request("/api/health"),
  request("/api/system/readiness"),
  request("/api/security/audit-chain")
]);

const failedImplemented = readiness.checks.filter((item) => item.implemented !== true);
const result = {
  ok: health.ok && auditChain.ok && failedImplemented.length === 0,
  api: health,
  implementationCompletionPct: readiness.implementationCompletionPct,
  configurationCompletionPct: readiness.configurationCompletionPct,
  auditChain: { ok: auditChain.ok, checked: auditChain.checked },
  userOwnedValidation: readiness.userOwnedValidation
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
