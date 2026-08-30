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
  "long-content": ["完整账户证据", "长内容保持完整并允许纵向阅读。"],
  "large-list": ["完整账户对象列表", "大列表不截断权威条目。"]
});

const retainedKinds = new Set(["stale", "degraded"]);
const MAX_LONG_CONTENT_CHARS = 12_000;
const MAX_LARGE_LIST_ROWS = 96;
const HOSTILE_TEXT_PATTERN = /<\s*\/?\s*(script|img|iframe|object|embed|svg)\b|\son[a-z]+\s*=/iu;

const text = (value, fallback) => (
  typeof value === "string" && value.trim() && !HOSTILE_TEXT_PATTERN.test(value)
    ? value
    : fallback
);
const list = (value) => Array.isArray(value) ? value : [];
const boundedText = (value, fallback) => text(value, fallback).slice(0, MAX_LONG_CONTENT_CHARS);
const rowLabel = (row, index) => {
  if (!row || typeof row !== "object") return `账户对象 ${index + 1}`;
  return text(row.label, text(row.id, `账户对象 ${index + 1}`));
};

function financeFacts(facts = {}) {
  const hasAuthoritativeZero = Object.hasOwn(facts, "authoritativeZero") && Number.isFinite(facts.authoritativeZero);
  const zeroValue = hasAuthoritativeZero ? String(facts.authoritativeZero) : "Unavailable";
  return [
    createElement("span", {
      key: "missing",
      "data-kordyn-v2-finance-missing": text(facts.missingFinanceLabel, "Unavailable")
    }, text(facts.missingFinanceLabel, "Unavailable")),
    createElement("span", {
      key: "zero",
      "data-kordyn-v2-finance-zero": zeroValue,
      "data-kordyn-v2-finance-zero-available": String(hasAuthoritativeZero)
    }, zeroValue)
  ];
}

function retainedFacts(facts = {}) {
  return [
    createElement("span", {
      key: "source",
      "data-kordyn-v2-last-valid-source": text(facts.source, "Task 5 account bounded production-shaped authority")
    }, text(facts.source, "Task 5 account bounded production-shaped authority")),
    createElement("time", {
      key: "time",
      dateTime: text(facts.lastValidAt, "2026-08-30T00:12:00.000Z"),
      "data-kordyn-v2-last-valid-at": text(facts.lastValidAt, "2026-08-30T00:12:00.000Z")
    }, text(facts.lastValidAt, "2026-08-30T00:12:00.000Z"))
  ];
}

function partialFacts(facts = {}) {
  const completed = list(facts.completedEffects);
  const failed = list(facts.failedEffects);
  return [
    createElement("ol", {
      key: "completed",
      "data-kordyn-v2-partial-completed": String(completed.length)
    }, completed.map((row) => createElement("li", { key: row.id || row.label }, row.label || row.id))),
    createElement("ol", {
      key: "failed",
      "data-kordyn-v2-partial-failed": String(failed.length)
    }, failed.map((row) => createElement("li", { key: row.id || row.label }, row.label || row.id)))
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
    children.push(createElement("article", {
      key: "long",
      tabIndex: 0,
      "data-kordyn-v2-long-content": true,
      "data-kordyn-v2-long-content-bounded": String(text(facts.longContent, "").length > MAX_LONG_CONTENT_CHARS)
    }, boundedText(facts.longContent, "完整账户证据。")));
  }
  if (kind === "large-list") {
    const rows = list(facts.largeList).slice(0, MAX_LARGE_LIST_ROWS);
    children.push(createElement("ol", {
      key: "list",
      tabIndex: 0,
      "data-kordyn-v2-large-list-count": String(rows.length),
      "data-kordyn-v2-large-list-source-count": String(list(facts.largeList).length)
    }, rows.map((row, index) => createElement("li", {
      key: row && typeof row === "object" ? row.id || row.label || index : index
    }, rowLabel(row, index)))));
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
