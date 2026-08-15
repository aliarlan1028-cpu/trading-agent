import dns from "node:dns/promises";
import dnsCallback from "node:dns";
import net from "node:net";
import path from "node:path";
import { Agent, fetch as undiciFetch } from "undici";

function ipv4Octets(address) {
  const parts = String(address || "").split(".").map(Number);
  return parts.length === 4 && parts.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? parts
    : null;
}

function ipv6Bytes(address) {
  let value = String(address || "").toLowerCase();
  const zoneAt = value.indexOf("%");
  if (zoneAt >= 0) value = value.slice(0, zoneAt);
  if (value.includes(".")) {
    const splitAt = value.lastIndexOf(":");
    const octets = ipv4Octets(value.slice(splitAt + 1));
    if (!octets) return null;
    value = `${value.slice(0, splitAt)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  if ((value.match(/::/g) || []).length > 1) return null;
  const [leftRaw, rightRaw] = value.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = value.includes("::") ? 8 - left.length - right.length : 0;
  if (missing < 0 || (!value.includes("::") && left.length !== 8)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.flatMap((word) => {
    const numeric = Number.parseInt(word, 16);
    return [numeric >> 8, numeric & 0xff];
  });
}

function matchesPrefix(bytes, prefix, bits) {
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  if (!remainingBits) return true;
  const mask = 0xff << (8 - remainingBits);
  return (bytes[wholeBytes] & mask) === (prefix[wholeBytes] & mask);
}

function isPrivateIpv4(parts) {
  if (!parts) return true;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
    || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224;
}

export function isPrivateIp(address) {
  const kind = net.isIP(String(address || ""));
  if (!kind) return true; // 无法识别的地址一律视为不安全（fail-closed）
  if (kind === 4) return isPrivateIpv4(ipv4Octets(address));
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const prefixes = [
    [ipv6Bytes("::"), 128],
    [ipv6Bytes("::1"), 128],
    [ipv6Bytes("fc00::"), 7],
    [ipv6Bytes("fe80::"), 10],
    [ipv6Bytes("fec0::"), 10],
    [ipv6Bytes("ff00::"), 8],
    [ipv6Bytes("2001:db8::"), 32],
    [ipv6Bytes("3fff::"), 20],
    [ipv6Bytes("64:ff9b::"), 96]
  ];
  if (prefixes.some(([prefix, bits]) => matchesPrefix(bytes, prefix, bits))) return true;
  // IPv4-mapped/compatible IPv6 继承内嵌 IPv4 的安全属性。
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (mapped || compatible) return isPrivateIpv4(bytes.slice(12));
  return false;
}

export async function assertSafeExternalUrl(value, { lookup = dns.lookup } = {}) {
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
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("外部 URL 解析到私有或保留地址");
  return url;
}

const SENSITIVE_REDIRECT_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|.*(?:secret|token|passphrase|password|webhook).*)$/i;

export function redirectHeaders(headers, fromUrl, toUrl) {
  const result = new Headers(headers || {});
  if (new URL(fromUrl).origin !== new URL(toUrl).origin) {
    for (const [name] of result) {
      if (SENSITIVE_REDIRECT_HEADER.test(name)) result.delete(name);
    }
  }
  result.delete("host");
  return result;
}

// fetch 真正建连时再次检查被选中的 IP，关闭“校验时公网、连接时变私网”的 DNS rebinding 窗口。
export function createSafeExternalDispatcher() {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        const all = options?.all === true;
        dnsCallback.lookup(hostname, { family: options?.family || 0, all, verbatim: true }, (error, address, family) => {
          if (error) return callback(error);
          if (all) {
            const addresses = Array.isArray(address) ? address : [];
            if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) return callback(new Error("外部 URL 连接解析到私有或保留地址"));
            return callback(null, addresses);
          }
          if (isPrivateIp(address)) return callback(new Error("外部 URL 连接解析到私有或保留地址"));
          return callback(null, address, family);
        });
      }
    }
  });
}

export async function assertSafeGitHubRepositoryUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("GitHub 仓库地址格式无效"); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") throw new Error("Git 仓库仅允许 https://github.com");
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("GitHub 仓库地址格式无效");
  }
  return assertSafeExternalUrl(url.toString());
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
  return withSafeExternalResponse(value, options, async (response, context) => ({
    response,
    text: await readBodyLimited(response, Math.max(1024, Number(options.maxBytes ?? 5 * 1024 * 1024))),
    finalUrl: context.finalUrl
  }));
}

// 唯一安全远程 HTTP 边界：npm undici 的 Agent 必须与同版本 undici.fetch 配套。
// consume 在 dispatcher 关闭前完成响应读取；重定向逐跳做 SSRF 校验并跨 origin 脱敏。
export async function withSafeExternalResponse(value, options = {}, consume) {
  const maxRedirects = Math.max(0, Number(options.maxRedirects ?? 3));
  let current = await assertSafeExternalUrl(value);
  let requestHeaders = new Headers(options.headers || {});
  let requestMethod = String(options.method || "GET").toUpperCase();
  let requestBody = options.body;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15_000));
    const dispatcher = createSafeExternalDispatcher();
    try {
      // dispatcher 来自 npm undici，必须配同版本 undici.fetch；传给 Node 内置 fetch
      // 会因内部 undici 协议版本不同报 UND_ERR_INVALID_ARG，导致所有安全外部抓取假性断网。
      const signal = options.signal && typeof globalThis.AbortSignal?.any === "function"
        ? globalThis.AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      const response = await undiciFetch(current, {
        method: requestMethod,
        headers: requestHeaders,
        body: requestBody,
        signal,
        redirect: "manual",
        dispatcher
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect === maxRedirects) throw new Error("外部 URL 重定向次数过多");
        const location = response.headers.get("location");
        if (!location) throw new Error("外部 URL 重定向缺少目标地址");
        const next = await assertSafeExternalUrl(new URL(location, current).toString());
        requestHeaders = redirectHeaders(requestHeaders, current, next);
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestMethod === "POST")) {
          requestMethod = "GET";
          requestBody = undefined;
          requestHeaders.delete("content-length");
          requestHeaders.delete("content-type");
        }
        current = next;
        continue;
      }
      if (typeof consume !== "function") throw new Error("安全外部请求缺少响应消费器");
      return await consume(response, { finalUrl: current.toString() });
    } finally {
      clearTimeout(timer);
      await dispatcher.close().catch(() => {});
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
