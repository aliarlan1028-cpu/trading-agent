import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = ["public/landing.html", "public/landing.js", "index.html"];
const source = files.map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");

test("营销页使用清晰的自主交易、权限、闭环、风控与知识库标题", () => {
  for (const phrase of [
    "数字货币自主交易 Agent",
    "让 Agent 自主交易",
    "你定义交易权限",
    "自主交易能力 · CAPABILITIES",
    "交易闭环 · LIFECYCLE",
    "权限与风控 · GUARDRAILS",
    "交易知识库 · KNOWLEDGE",
    "沉淀为下一次更好的决策"
  ]) assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("营销页面不再出现旧的抽象标题", () => {
  for (const phrase of [
    "授权后自主交易,绝不无边界",
    "你划定边界",
    "只在框内行动",
    "四个专业角色,一套交易大脑",
    "从感知到复盘的交易闭环",
    "边界写进系统",
    "不是资料仓库"
  ]) assert.doesNotMatch(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
