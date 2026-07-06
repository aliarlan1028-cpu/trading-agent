const base = process.env.API_BASE_URL || "http://127.0.0.1:8787";

async function request(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

const result = {
  ok: false,
  api: await request("/api/health")
};
result.ok = result.api.ok === true;

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
