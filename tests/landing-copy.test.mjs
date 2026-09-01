import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = ["public/landing.html", "public/landing.js", "index.html"];
const source = files.map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");

test("营销页使用清晰的自主交易、权限、闭环、风控与知识库标题", () => {
  for (const phrase of [
    "数字货币自主交易 Agent",
    "持续理解市场",
    "范围由你设定",
    "自主交易能力 · CAPABILITIES",
    "交易闭环 · LIFECYCLE",
    "权限与风控 · GUARDRAILS",
    "交易知识库 · KNOWLEDGE",
    "持续沉淀为下一次判断的依据"
  ]) assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("产品名称和栏目名称使用独立的主视觉层级", () => {
  for (const className of [
    "taHeroProduct",
    "taHeroStatement",
    "taMandateTitle",
    "taMandateSupport",
    "taSectionTitle",
    "taSectionName",
    "taSectionSupport"
  ]) assert.match(source, new RegExp(`class=["'][^"']*${className}`));

  for (const rule of [
    [/\.taHeroProduct\s*\{[^}]*font-size:\s*38px/s, "首屏产品名称"],
    [/\.taHeroStatement\s*\{[^}]*font-size:\s*28px/s, "首屏辅助标题"],
    [/\.taSectionName\s*\{[^}]*font-size:\s*30px/s, "栏目名称"],
    [/\.taSectionSupport\s*\{[^}]*font-size:\s*19px/s, "栏目辅助文案"],
    [/\.taMandateTitle\s*\{[^}]*font-size:\s*30px/s, "交易权限名称"],
    [/\.taMandateSupport\s*\{[^}]*font-size:\s*19px/s, "交易权限辅助文案"]
  ]) assert.match(source, rule[0], `${rule[1]}字号层级应保持清晰`);

  assert.match(source, /<h1 class="taHeroProduct"/);
  assert.match(source, /<h2 class="taHeroStatement"/);
  assert.match(source, /<h2 class="taSectionName"[^>]*data-i18n="cap\.tag"/);
  assert.doesNotMatch(source, /<h1 class="taHeroStatement"/);
});

test("营销页面不再出现旧的抽象标题", () => {
  for (const phrase of [
    "授权后自主交易,绝不无边界",
    "让 Agent 自主交易，让每一步都有边界",
    "你划定边界",
    "你定义交易权限",
    "只在框内行动",
    "四个专业角色,一套交易大脑",
    "从感知到复盘的交易闭环",
    "边界写进系统",
    "每一笔交易，都必须通过权限与风控",
    "不是资料仓库"
  ]) assert.doesNotMatch(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
