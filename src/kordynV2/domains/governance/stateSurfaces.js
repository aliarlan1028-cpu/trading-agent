import { createElement } from "react";

const COPY = Object.freeze({
  loading: ["正在读取系统治理事实", "等待边界、运行与配置事实返回；不会显示推测状态。"],
  empty: ["当前范围没有记录", "权威来源已返回空集合。"],
  processing: ["服务器正在处理治理动作", "完成前保留当前有效状态，不提前显示成功。"],
  stale: ["显示上次有效治理事实", "数据已过期，写动作暂时禁用。"],
  degraded: ["运行来源降级", "保留最后有效状态，并明确当前降级原因。"],
  failed: ["事件来源读取失败", "失败来源保持失败，不会被解释为无事件。"],
  forbidden: ["当前身份无权编辑配置", "有效事实仍可查看，持久化动作不显示为可用。"],
  disabled: ["系统托管任务不可修改", "任务定义只读；仅已部署生命周期动作按权限开放。"],
  approval: ["需要明确确认", "确认前配置、授权或恢复动作不会提交。"],
  partial: ["服务器只完成了部分恢复动作", "已完成与失败影响分开展示。"],
  "no-result": ["审计筛选没有结果", "筛选为空不代表审计账本为空。"],
  "long-content": ["原始恢复上下文较长", "保留来源与时间，超出显示边界时明确截断。"],
  "large-list": ["治理 Registry 大列表", "当前边界内对象完整呈现并保留真实计数。"]
});
const MAX_TEXT = 6_000;
const MAX_ROWS = 96;
const HOSTILE = /<\s*\/?\s*(?:script|img|iframe|object|embed|svg)\b|\son[a-z]+\s*=/iu;

function own(record, key) { try { const descriptor = record && (typeof record === "object" || typeof record === "function") ? Object.getOwnPropertyDescriptor(record, key) : null; return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined; } catch { return undefined; } }
function text(value, fallback) { if (!["string", "number", "boolean"].includes(typeof value)) return fallback; const normalized = String(value); return normalized.trim() && !HOSTILE.test(normalized) ? normalized : fallback; }
function rows(value) { try { if (!Array.isArray(value)) return { values: [], count: 0 }; const length = own(value, "length"); if (!Number.isSafeInteger(length) || length < 0) return { values: [], count: 0 }; const values = []; for (let index = 0; index < Math.min(length, MAX_ROWS); index += 1) { const row = own(value, String(index)); if (row && typeof row === "object") values.push(row); } return { values, count: length }; } catch { return { values: [], count: 0 }; } }

function special(kind, facts) {
  if (["stale", "degraded"].includes(kind)) return [
    createElement("span", { key: "source", "data-kordyn-v2-last-valid-source": text(own(facts, "source"), "Unavailable") }, text(own(facts, "source"), "Unavailable")),
    createElement("time", { key: "time", "data-kordyn-v2-last-valid-at": text(own(facts, "lastValidAt"), "Unavailable") }, text(own(facts, "lastValidAt"), "Unavailable"))
  ];
  if (kind === "failed") { const source = own(facts, "failedSource"); return [createElement("article", { key: "source", "data-kordyn-v2-event-source-stage": text(own(source, "status"), "failed") }, text(own(source, "name"), "Event source unavailable"))]; }
  if (kind === "forbidden") return [createElement("span", { key: "forbidden", "data-kordyn-v2-configuration-access": "forbidden" }, "Owner authority required")];
  if (kind === "disabled") { const task = own(facts, "disabledTask"); return [createElement("button", { key: "task", type: "button", disabled: true, "data-kordyn-v2-system-task-control": text(own(task, "id"), "system-task") }, text(own(task, "name"), "System-managed task"))]; }
  if (kind === "partial") { const complete = rows(own(facts, "completedEffects")).values; const failed = rows(own(facts, "failedEffects")).values; return [createElement("ol", { key: "complete", "data-kordyn-v2-partial-completed": complete.length }, complete.map((row, index) => createElement("li", { key: text(own(row, "id"), `complete-${index}`) }, text(own(row, "label"), "Completed effect")))), createElement("ol", { key: "failed", "data-kordyn-v2-partial-failed": failed.length }, failed.map((row, index) => createElement("li", { key: text(own(row, "id"), `failed-${index}`) }, text(own(row, "label"), "Failed effect"))))]; }
  if (kind === "no-result") return [createElement("span", { key: "none", "data-kordyn-v2-audit-filter-result": "none" }, "No matching audit records")];
  if (kind === "long-content") { const source = text(own(facts, "longContext"), "Recovery context unavailable"); return [createElement("article", { key: "long", tabIndex: 0, "data-kordyn-v2-long-content-bounded": String(source.length > MAX_TEXT), "data-kordyn-v2-long-content-source-chars": source.length }, source.slice(0, MAX_TEXT))]; }
  if (kind === "large-list") { const registry = rows(own(facts, "largeRegistry")); return [createElement("ol", { key: "list", tabIndex: 0, "data-kordyn-v2-large-list-count": registry.values.length, "data-kordyn-v2-large-list-source-count": registry.count }, registry.values.map((row, index) => createElement("li", { key: text(own(row, "id"), `config-${index}`) }, text(own(row, "label"), `配置对象 ${index + 1}`))))]; }
  return [];
}

function render(kind, facts = {}) {
  return createElement("section", { "data-kordyn-v2-state": kind, "data-kordyn-v2-governance-state-content": kind, ...(["stale", "degraded"].includes(kind) ? { "data-kordyn-v2-actions-disabled": "true" } : {}) }, createElement("h2", { "data-kordyn-v2-state-heading": true }, COPY[kind][0]), createElement("p", { "data-kordyn-v2-state-message": true }, COPY[kind][1]), ...special(kind, facts));
}

export const GOVERNANCE_STATE_SURFACES = Object.freeze(Object.fromEntries(Object.keys(COPY).map((kind) => [kind, (facts) => render(kind, facts)])));
