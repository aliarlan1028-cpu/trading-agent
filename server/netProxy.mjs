import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

// Node 的 fetch 默认忽略 HTTP(S)_PROXY 环境变量；本机若配置了系统代理
// （如 Clash），交易所与 LLM API 都需要经由代理才能访问。
export function installProxyFromEnv() {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    console.log(`[net] 使用系统代理：${process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy}`);
  }
}
