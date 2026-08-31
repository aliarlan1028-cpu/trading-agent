import { createElement } from "react";

const COPY = Object.freeze({
  loading: ["正在读取智能资产", "等待来源、Registry 与复盘事实返回；当前不会显示推测数据。"],
  empty: ["当前范围没有智能资产", "权威来源已返回空集合。"],
  processing: ["服务器正在处理资产动作", "完成前保持原生命周期，不会提前显示已发布。"],
  stale: ["显示上次有效资产事实", "能力健康已过期，写动作暂时禁用。"],
  degraded: ["来源降级，保留上次有效事实", "来源恢复前候选审批与发布动作已禁用。"],
  failed: ["知识来源处理失败", "失败来源保持失败，不会生成健康证据或候选。"],
  forbidden: ["当前身份无权访问 Owner 队列", "受保护候选、证据与发布动作不会显示。"],
  disabled: ["能力授权当前不可用", "MCP 未获得明确授权，调用保持禁用。"],
  approval: ["需要 Owner 确认", "确认前候选不会进入验证或发布新版本。"],
  partial: ["服务器只完成了部分资产动作", "已完成与失败影响分开展示，不会合并成成功。"],
  "no-result": ["没有可验证的资产关系", "缺少显式引用时关系图保持空白。"],
  "long-content": ["证据长内容阅读边界", "保留来源与页码；超出显示边界时明确标记。"],
  "large-list": ["Registry 大列表边界", "边界内对象保持完整；超出时显示来源总数。"]
});
const retained = new Set(["stale", "degraded"]);
const MAX_TEXT = 6_000;
const MAX_ROWS = 96;
const HOSTILE = /<\s*\/?\s*(?:script|img|iframe|object|embed|svg)\b|\son[a-z]+\s*=/iu;

function own(record, key) {
  try {
    if (!record || (typeof record !== "object" && typeof record !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch { return undefined; }
}
function text(input, fallback) {
  if (!["string", "number", "boolean"].includes(typeof input)) return fallback;
  const normalized = String(input);
  return normalized.trim() && !HOSTILE.test(normalized) ? normalized : fallback;
}
function rows(input) {
  try {
    if (!Array.isArray(input)) return { values: [], count: 0 };
    const length = own(input, "length");
    if (!Number.isSafeInteger(length) || length < 0) return { values: [], count: 0 };
    const values = [];
    for (let index = 0; index < Math.min(length, MAX_ROWS); index += 1) {
      const row = own(input, String(index));
      if (row && typeof row === "object") values.push(row);
    }
    return { values, count: length };
  } catch { return { values: [], count: 0 }; }
}
function safeFact(row, fallbackId, fallbackLabel) {
  return { id: text(own(row, "id"), fallbackId), label: text(own(row, "label"), fallbackLabel) };
}
function retainedFacts(facts) {
  const source = text(own(facts, "source"), "Plan 04 intelligent assets production-shaped fixture");
  const at = text(own(facts, "lastValidAt"), "2026-08-31T09:18:00.000Z");
  return [
    createElement("span", { key: "source", "data-kordyn-v2-last-valid-source": source }, source),
    createElement("time", { key: "at", dateTime: at, "data-kordyn-v2-last-valid-at": at }, at),
    createElement("span", { key: "health", "data-kordyn-v2-capability-health": text(own(own(facts, "staleCapability"), "health"), "stale") }, text(own(own(facts, "staleCapability"), "name"), "Capability health unavailable"))
  ];
}
function partialFacts(facts) {
  const completed = rows(own(facts, "completedEffects")).values.map((row, index) => safeFact(row, `complete-${index}`, `已完成影响 ${index + 1}`));
  const failed = rows(own(facts, "failedEffects")).values.map((row, index) => safeFact(row, `failed-${index}`, `失败影响 ${index + 1}`));
  return [
    createElement("ol", { key: "completed", "data-kordyn-v2-partial-completed": completed.length }, completed.map((row) => createElement("li", { key: row.id }, row.label))),
    createElement("ol", { key: "failed", "data-kordyn-v2-partial-failed": failed.length }, failed.map((row) => createElement("li", { key: row.id }, row.label)))
  ];
}
function special(kind, facts) {
  if (kind === "failed") {
    const source = own(facts, "failedSource");
    return [createElement("article", { key: "failed-source", "data-kordyn-v2-source-stage": text(own(source, "stage"), "failed") }, text(own(source, "title"), "Knowledge source unavailable"))];
  }
  if (kind === "forbidden") return [createElement("span", { key: "forbidden", "data-kordyn-v2-owner-queue-access": "forbidden" }, "Owner authority required")];
  if (kind === "disabled") {
    const mcp = own(facts, "disabledMcp");
    return [createElement("button", { key: "mcp", type: "button", disabled: true, "data-kordyn-v2-mcp-grant": text(own(mcp, "grant"), "not-granted") }, text(own(mcp, "name"), "MCP unavailable"))];
  }
  if (kind === "no-result") return [createElement("span", { key: "none", "data-kordyn-v2-relationship-result": "none" }, "No explicit relationship")];
  if (kind === "partial") return partialFacts(facts);
  if (kind === "long-content") {
    const source = text(own(facts, "longEvidence"), "证据内容不可用。");
    const bounded = source.length > MAX_TEXT;
    return [createElement("article", { key: "long", tabIndex: 0, "data-kordyn-v2-long-content-bounded": String(bounded), "data-kordyn-v2-long-content-source-chars": source.length, "data-kordyn-v2-long-content-shown-chars": Math.min(source.length, MAX_TEXT) }, source.slice(0, MAX_TEXT))];
  }
  if (kind === "large-list") {
    const registry = rows(own(facts, "largeRegistry"));
    return [createElement("ol", { key: "list", tabIndex: 0, "data-kordyn-v2-large-list-count": registry.values.length, "data-kordyn-v2-large-list-source-count": registry.count, "data-kordyn-v2-large-list-complete": String(registry.values.length === registry.count) }, registry.values.map((row, index) => {
      const fact = safeFact(row, `asset-${index + 1}`, `智能资产 ${index + 1}`);
      return createElement("li", { key: fact.id }, fact.label);
    }))];
  }
  return [];
}
function render(kind, facts = {}) {
  const children = [
    createElement("h2", { key: "title", "data-kordyn-v2-state-heading": true }, COPY[kind][0]),
    createElement("p", { key: "message", "data-kordyn-v2-state-message": true }, COPY[kind][1])
  ];
  if (retained.has(kind)) children.push(...retainedFacts(facts));
  children.push(...special(kind, facts));
  return createElement("section", {
    "data-kordyn-v2-state": kind,
    "data-kordyn-v2-assets-state-content": kind,
    ...(retained.has(kind) ? { "data-kordyn-v2-actions-disabled": "true" } : {})
  }, children);
}

export const ASSET_STATE_SURFACES = Object.freeze(Object.fromEntries(Object.keys(COPY).map((kind) => [kind, (facts) => render(kind, facts)])));
