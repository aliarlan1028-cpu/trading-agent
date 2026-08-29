import { createElement } from "react";
import { StateBoundary } from "../../shell/StateBoundary.jsx";
import { normalizeResourceState } from "../../viewModels/state.js";

const COPY = Object.freeze({
  loading: ["正在读取 AI 事实", "等待权威来源返回，当前没有可复用的旧事实。"],
  empty: ["当前范围没有 AI 事实", "权威来源已返回空集合。"],
  processing: ["服务器正在处理", "结果返回前不会显示完成。"],
  stale: ["显示上次有效 AI 事实", "当前数据已过期，所有变更操作已禁用。"],
  degraded: ["来源降级，保留上次有效事实", "来源恢复前所有变更操作已禁用。"],
  failed: ["AI 事实读取失败", "当前没有可安全复用的事实，请重试。"],
  forbidden: ["当前身份无权访问 AI 事实", "受保护内容不会显示。"],
  disabled: ["AI 操作当前已禁用", "权威状态不允许执行该动作。"],
  approval: ["需要你确认", "确认前不会授权或执行。"],
  partial: ["服务器只完成了部分步骤", "保留权威部分结果，未完成动作不会标为成功。"],
  "no-result": ["尚无服务器结果", "请求尚未产生可展示的权威结果。"],
  "long-content": ["完整任务证据", "长内容保持完整并允许纵向阅读。"],
  "large-list": ["完整 AI 事实列表", "大列表不截断权威条目。"]
});

function stateData(kind, facts) {
  if (!["stale", "degraded"].includes(kind)) return null;
  return {
    source: facts?.source,
    asOf: facts?.lastValidAt
  };
}

function Content({ kind, facts }) {
  const [title, message] = COPY[kind];
  const retained = ["stale", "degraded"].includes(kind);
  const children = [
    createElement("h2", { key: "heading", "data-kordyn-v2-state-heading": true }, title),
    createElement("p", { key: "message", "data-kordyn-v2-state-message": true }, message)
  ];
  if (retained) {
    children.push(createElement("span", {
      key: "source",
      "data-kordyn-v2-last-valid-source": facts.source
    }, facts.source));
    children.push(createElement("time", {
      key: "time",
      dateTime: facts.lastValidAt,
      "data-kordyn-v2-last-valid-at": facts.lastValidAt
    }, facts.lastValidAt));
  }
  if (kind === "long-content") children.push(createElement("article", { key: "long" }, facts.longContent));
  if (kind === "large-list") {
    children.push(createElement("ol", {
      key: "list",
      "data-kordyn-v2-large-list-count": facts.largeList.length
    }, facts.largeList.map((row) => createElement("li", { key: row.id }, row.label))));
  }
  return createElement("section", {
    "data-kordyn-v2-ai-state-content": kind,
    ...(retained ? { "data-kordyn-v2-actions-disabled": "true" } : {})
  }, children);
}

function renderState(kind, facts = {}) {
  const state = normalizeResourceState({ resourceState: kind, data: stateData(kind, facts) });
  return createElement(
    StateBoundary,
    { state },
    createElement(Content, { kind, facts })
  );
}

export const AI_STATE_SURFACES = Object.freeze(Object.fromEntries(
  Object.keys(COPY).map((kind) => [kind, (facts) => renderState(kind, facts)])
));
