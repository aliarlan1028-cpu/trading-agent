const base = process.env.API_BASE_URL || "http://127.0.0.1:8787";

// 硬超时：服务挂起（事件循环被占死）时 fetch 会悬着，必须主动掐断判失败，
// 让 docker healthcheck 及时把容器标为 unhealthy（宿主机 watchdog 依据 HTTP 拨测自动重启）。
async function request(path, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, { signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${path} failed: ${response.status} ${text}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

try {
  const api = await request("/api/health");
  const ok = api.ok === true;
  console.log(JSON.stringify({ ok, api }));
  if (!ok) process.exit(1);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}
