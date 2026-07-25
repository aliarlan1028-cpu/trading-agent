import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";

function isPrivateIp(address) {
  if (!net.isIP(address)) return false;
  if (address === "::1" || address === "0.0.0.0" || address === "::") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

export async function assertSafeExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("外部 URL 无效");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("外部 URL 只允许 http/https");
  if (url.username || url.password) throw new Error("外部 URL 禁止内嵌凭证");
  const host = url.hostname.toLowerCase();
  if (["localhost", "localhost.localdomain"].includes(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("外部 URL 禁止访问本机或内部域名");
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("外部 URL 解析到私有或保留地址");
  return url;
}

async function readBodyLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`外部内容超过 ${maxBytes} 字节限制`);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`外部内容超过 ${maxBytes} 字节限制`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchExternalText(value, options = {}) {
  const maxRedirects = Math.max(0, Number(options.maxRedirects ?? 3));
  const maxBytes = Math.max(1024, Number(options.maxBytes ?? 5 * 1024 * 1024));
  let current = await assertSafeExternalUrl(value);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15_000));
    try {
      const response = await fetch(current, {
        method: options.method || "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
        redirect: "manual"
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect === maxRedirects) throw new Error("外部 URL 重定向次数过多");
        current = await assertSafeExternalUrl(new URL(response.headers.get("location"), current).toString());
        continue;
      }
      const text = await readBodyLimited(response, maxBytes);
      return { response, text, finalUrl: current.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("外部 URL 获取失败");
}

export function resolveContainedPath(base, subPath = "") {
  const root = path.resolve(base);
  const target = path.resolve(root, String(subPath || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("子路径越过允许目录");
  return target;
}
