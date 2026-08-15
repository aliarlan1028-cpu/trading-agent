import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/landing.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/landing.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/landing.css", import.meta.url), "utf8");
const source = `${html}\n${script}\n${styles}`;

test("营销页完整回答系统是什么、解决什么、如何解决、特色与竞品差异", () => {
  for (const phrase of [
    "TO THE MOON",
    "不是靠冲动起飞",
    "市场没有下班，人的注意力会",
    "一条航线，连接感知、判断与行动",
    "不是一个聊天框，是一套交易操作系统",
    "AI Agent 很多，交易闭环很少",
    "飞得更远之前，先知道哪里不能去",
    "知识图谱 + 审批规则",
    "持久意图 + 对账恢复"
  ]) assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("To the Moon 明确是工程主题而不是收益承诺", () => {
  assert.match(source, /不是收益承诺/);
  assert.match(source, /不构成投资建议或收益承诺/);
  assert.doesNotMatch(html, /今日盈亏|胜率 WIN|MAX DD|data-count=/);
});

test("页面提供月球任务控制、证据链、飞行路线、Bento 与对比表等原生视觉结构", () => {
  for (const className of [
    "lunar-stage",
    "moon",
    "mission-console",
    "console-route",
    "flight-plan",
    "capability-bento",
    "comparison-wrap",
    "guardrail-list",
    "closing-moon"
  ]) assert.match(html, new RegExp(`class=["'][^"']*${className}`));
  assert.match(styles, /@keyframes moonBreath/);
  assert.match(styles, /@keyframes satellite/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media \(max-width: 580px\)/);
});

test("营销页保留真实行情、登录、订阅、联系与中英切换入口", () => {
  assert.match(html, /id="taTicker"/);
  assert.match(script, /\/api\/public\/ticker-bar/);
  assert.match(script, /type: "lp-start"/);
  assert.match(html, /data-action="login"/);
  assert.match(html, /data-action="subscribe"/);
  assert.match(html, /data-action="contact"/);
  assert.match(html, /data-action="lang"/);
});

test("每个 HTML i18n key 都有中英文文案", () => {
  const keys = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 70);
  for (const key of new Set(keys)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(script, new RegExp(`"${escaped}"\\s*:\\s*\\["[^"\\n]+",\\s*"[^"\\n]+"\\]`), `missing bilingual copy for ${key}`);
  }
});

test("关键页面层级和品牌色存在，且不是旧营销稿的内联样式堆叠", () => {
  assert.match(html, /<h1 class="taHeroProduct">TO THE/);
  assert.match(html, /<h2 class="taHeroStatement"/);
  assert.match(styles, /--violet:\s*#a78bfa/);
  assert.match(styles, /--orange:\s*#ff7a32/);
  assert.match(styles, /\.taHeroProduct\s*\{[^}]*clamp\(/s);
  assert.doesNotMatch(html, /style="/);
});
