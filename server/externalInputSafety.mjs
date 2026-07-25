import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";

export function isPrivateIp(address) {
  const kind = net.isIP(String(address || ""));
  if (!kind) return true; // 无法识别的地址一律视为不安全（fail-closed）
  let candidate = String(address).toLowerCase();
  if (kind === 6) {
    if (candidate === "::1" || candidate === "::") return true;
    if (candidate.startsWith("fc") || candidate.startsWith("fd") || candidate.startsWith("fe80:")) return true;
    // IPv4-mapped 形式（::ffff:127.0.0.1 / ::ffff:7f00:1）必须拆出 IPv4 再判——
    // 旧实现对 ::ffff:127.0.0.1 会误判为公网（split "." 得到 NaN 段全部落空）。
    const dotted = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
      candidate = dotted[1];
    } else {
      const hex = candidate.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        candidate = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      } else {
        return false; // 其余视为公网 IPv6
      }
    }
  }
  const parts = candidate.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // fail-closed
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)      // 192.0.0.0/24 保留
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))  // 198.18.0.0/15 基准测试段
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
  // 已知局限（TOCTOU/DNS rebinding）：此处校验后 fetch 仍按 hostname 重新解析，短 TTL 恶意域名
  // 存在换址窗口。彻底修复需 IP-pinning（undici Agent 自定义 connect），当前威胁面为
  // Owner 自填 URL + 每跳重定向重校验，风险可接受；引入 undici 依赖时再收口。
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
