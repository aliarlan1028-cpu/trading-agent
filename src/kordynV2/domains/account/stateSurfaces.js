import { createElement } from "react";

const COPY = Object.freeze({
  loading: ["正在读取账户与交易事实", "等待权威来源返回，当前没有可复用的旧事实。"],
  empty: ["当前范围没有账户交易事实", "权威来源已返回空集合。"],
  processing: ["服务器正在处理账户动作", "结果返回前不会显示完成，也不会假定交易已落地。"],
  stale: ["显示上次有效账户事实", "当前数据已过期，受保护交易动作已禁用。"],
  degraded: ["来源降级，保留上次有效账户事实", "来源恢复前受保护交易动作已禁用。"],
  failed: ["账户事实读取失败", "当前没有可安全复用的账户、仓位或订单事实，请重试。"],
  forbidden: ["当前身份无权访问账户事实", "受保护账户、仓位和交易内容不会显示。"],
  disabled: ["账户操作当前已禁用", "权威状态不允许执行该动作。"],
  approval: ["需要你确认", "确认前不会授权计划、提交订单或平仓。"],
  partial: ["服务器只完成了部分账户动作", "已完成与失败影响分开展示，不会合并为成功。"],
  "no-result": ["尚无服务器结果", "请求尚未产生可展示的账户或交易结果。"],
  "long-content": ["账户证据阅读边界", "长内容保持可读；超出证据边界时会明确标记。"],
  "large-list": ["账户对象证据边界", "边界内对象保持完整；超出时会明确显示已展示与来源总数。"]
});

const retainedKinds = new Set(["stale", "degraded"]);
const MAX_LONG_CONTENT_CHARS = 12_000;
const MAX_LARGE_LIST_ROWS = 96;
const HOSTILE_TEXT_PATTERN = /<\s*\/?\s*(script|img|iframe|object|embed|svg)\b|\son[a-z]+\s*=/iu;

const text = (value, fallback) => {
  if (!["string", "number", "boolean"].includes(typeof value)) return fallback;
  const normalized = String(value);
  return normalized.trim() && !HOSTILE_TEXT_PATTERN.test(normalized) ? normalized : fallback;
};
const ownData = (record, key) => {
  try {
    if ((typeof record !== "object" && typeof record !== "function") || record === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};
const arrayFacts = (value, limit = MAX_LARGE_LIST_ROWS) => {
  try {
    if (!Array.isArray(value)) return { rows: [], sourceCount: 0 };
    const length = ownData(value, "length");
    if (!Number.isSafeInteger(length) || length < 0) return { rows: [], sourceCount: 0 };
    const rows = [];
    for (let index = 0; index < Math.min(length, limit); index += 1) {
      const item = ownData(value, String(index));
      if (item !== undefined) rows.push(item);
    }
    return { rows, sourceCount: length };
  } catch {
    return { rows: [], sourceCount: 0 };
  }
};
const boundedText = (value, fallback) => text(value, fallback).slice(0, MAX_LONG_CONTENT_CHARS);
const rowLabel = (row, index) => {
  if (!row || typeof row !== "object") return `账户对象 ${index + 1}`;
  return text(ownData(row, "label"), text(ownData(row, "id"), `账户对象 ${index + 1}`));
};
const effectFact = (row, index) => ({
  id: text(ownData(row, "id"), `account-effect-${index + 1}`),
  label: text(ownData(row, "label"), text(ownData(row, "id"), `账户影响 ${index + 1}`))
});

function financeFacts(facts = {}) {
  const authoritativeZero = ownData(facts, "authoritativeZero");
  const missingFinanceLabel = text(ownData(facts, "missingFinanceLabel"), "Unavailable");
  const hasAuthoritativeZero = Number.isFinite(authoritativeZero);
  const zeroValue = hasAuthoritativeZero ? String(authoritativeZero) : "Unavailable";
  return [
    createElement("span", {
      key: "missing",
      "data-kordyn-v2-finance-missing": missingFinanceLabel
    }, missingFinanceLabel),
    createElement("span", {
      key: "zero",
      "data-kordyn-v2-finance-zero": zeroValue,
      "data-kordyn-v2-finance-zero-available": String(hasAuthoritativeZero)
    }, zeroValue)
  ];
}

function retainedFacts(facts = {}) {
  const source = text(ownData(facts, "source"), "Task 5 account bounded production-shaped authority");
  const lastValidAt = text(ownData(facts, "lastValidAt"), "2026-08-30T00:12:00.000Z");
  return [
    createElement("span", {
      key: "source",
      "data-kordyn-v2-last-valid-source": source
    }, source),
    createElement("time", {
      key: "time",
      dateTime: lastValidAt,
      "data-kordyn-v2-last-valid-at": lastValidAt
    }, lastValidAt)
  ];
}

function partialFacts(facts = {}) {
  const completed = arrayFacts(ownData(facts, "completedEffects")).rows.map(effectFact);
  const failed = arrayFacts(ownData(facts, "failedEffects")).rows.map(effectFact);
  return [
    createElement("ol", {
      key: "completed",
      "data-kordyn-v2-partial-completed": String(completed.length)
    }, completed.map((row) => createElement("li", { key: row.id }, row.label))),
    createElement("ol", {
      key: "failed",
      "data-kordyn-v2-partial-failed": String(failed.length)
    }, failed.map((row) => createElement("li", { key: row.id }, row.label)))
  ];
}

function contentFor(kind, facts = {}) {
  const children = [
    createElement("h2", { key: "heading", "data-kordyn-v2-state-heading": true }, COPY[kind][0]),
    createElement("p", { key: "message", "data-kordyn-v2-state-message": true }, COPY[kind][1]),
    createElement("div", { key: "finance", "data-kordyn-v2-account-finance-boundary": true }, financeFacts(facts))
  ];
  if (retainedKinds.has(kind)) children.push(...retainedFacts(facts));
  if (kind === "partial") children.push(...partialFacts(facts));
  if (kind === "long-content") {
    const longContent = text(ownData(facts, "longContent"), "");
    const bounded = longContent.length > MAX_LONG_CONTENT_CHARS;
    children.push(createElement("article", {
      key: "long",
      tabIndex: 0,
      "data-kordyn-v2-long-content": true,
      "data-kordyn-v2-long-content-bounded": String(bounded),
      "data-kordyn-v2-long-content-source-chars": String(longContent.length),
      "data-kordyn-v2-long-content-shown-chars": String(Math.min(longContent.length, MAX_LONG_CONTENT_CHARS))
    }, boundedText(longContent, "完整账户证据。")));
  }
  if (kind === "large-list") {
    const { rows, sourceCount } = arrayFacts(ownData(facts, "largeList"));
    const complete = rows.length === sourceCount;
    children.push(createElement("ol", {
      key: "list",
      tabIndex: 0,
      "data-kordyn-v2-large-list-count": String(rows.length),
      "data-kordyn-v2-large-list-source-count": String(sourceCount),
      "data-kordyn-v2-large-list-complete": String(complete),
      "data-kordyn-v2-large-list-evidence-bound": String(MAX_LARGE_LIST_ROWS)
    }, rows.map((row, index) => createElement("li", {
      key: text(ownData(row, "id"), text(ownData(row, "label"), String(index)))
    }, rowLabel(row, index)))));
    if (!complete) children.push(createElement("p", {
      key: "list-disclosure",
      role: "status",
      "data-kordyn-v2-large-list-disclosure": true,
      "data-kordyn-v2-large-list-shown-count": String(rows.length),
      "data-kordyn-v2-large-list-source-count": String(sourceCount)
    }, `已显示 ${rows.length} / ${sourceCount} 条；当前视图受 ${MAX_LARGE_LIST_ROWS} 条证据边界约束，列表证据不完整。`));
  }
  return children;
}

function renderState(kind, facts = {}) {
  return createElement("section", {
    "data-kordyn-v2-state": kind,
    "data-kordyn-v2-account-state-content": kind,
    ...(retainedKinds.has(kind) ? { "data-kordyn-v2-actions-disabled": "true" } : {})
  }, contentFor(kind, facts));
}

export const ACCOUNT_STATE_SURFACES = Object.freeze(Object.fromEntries(
  Object.keys(COPY).map((kind) => [kind, (facts) => renderState(kind, facts)])
));
