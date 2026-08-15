export function okxEnvironmentConfig(env = process.env) {
  const demo = String(env.OKX_DEMO_TRADING || "").toLowerCase() === "true";
  return Object.freeze({
    name: demo ? "demo" : "production",
    demo,
    restBase: env.OKX_BASE_URL || "https://www.okx.com",
    publicWs: demo ? "wss://wspap.okx.com:8443/ws/v5/public" : "wss://ws.okx.com:8443/ws/v5/public",
    privateWs: demo ? "wss://wspap.okx.com:8443/ws/v5/private" : "wss://ws.okx.com:8443/ws/v5/private",
    businessWs: demo ? "wss://wspap.okx.com:8443/ws/v5/business" : "wss://ws.okx.com:8443/ws/v5/business"
  });
}

export function okxRestUrl(pathname, env = process.env) {
  return `${okxEnvironmentConfig(env).restBase}${pathname}`;
}
