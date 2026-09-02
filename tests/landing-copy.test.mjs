import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../landing.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/marketing/landing.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/marketing/landing.css", import.meta.url), "utf8");
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

test("页面提供月球任务控制、飞行路线、真实产品工作台与对比表等原生视觉结构", () => {
  for (const className of [
    "lunar-stage",
    "moon",
    "mission-console",
    "console-route",
    "flight-plan",
    "flight-map",
    "flight-vehicle",
    "product-proof",
    "app-showcase",
    "app-showcase__nav",
    "app-market-strip",
    "product-panel",
    "ui-intel-grid",
    "ui-signal-mix",
    "ui-knowledge-grid",
    "ui-knowledge-stats",
    "ui-strategy-grid",
    "ui-performance-snapshot",
    "ui-operations-grid",
    "ui-risk-grid",
    "ui-risk-telemetry",
    "cap-boundary-strip",
    "cap-boundary-list",
    "comparison-wrap",
    "closing-moon"
  ]) assert.match(html, new RegExp(`class=["'][^"']*${className}`));
  assert.match(styles, /@keyframes moonBreath/);
  assert.match(styles, /@keyframes satellite/);
  assert.match(styles, /@keyframes flightSignal/);
  assert.match(styles, /@keyframes panelEnter/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media \(max-width: 580px\)/);
  for (const panel of ["intel", "knowledge", "strategy", "operations", "risk"]) {
    assert.match(html, new RegExp(`data-product-panel=["']${panel}["']`));
    assert.match(html, new RegExp(`data-product-tab=["']${panel}["']`));
  }
  assert.match(script, /function initProductShowcase\(/);
  assert.ok(html.indexOf('id="guardrails"') < html.indexOf('id="compare"'), "能力与安全边界应位于对比板块之前");
});

test("产品工作台使用明确标注的丰富示例数据，而不是伪装成客户实绩", () => {
  assert.match(html, /data-i18n="app\.demoData"/);
  assert.match(html, /12,486\.30/);
  assert.match(html, /2,184/);
  assert.match(html, /7\/7/);
  assert.match(html, /示例验证数据 · 不代表未来表现/);
  assert.match(styles, /@keyframes dataPulse/);
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

test("关键页面层级和新品牌色存在，且不是旧营销稿的内联样式堆叠", () => {
  assert.match(html, /<h1 class="taHeroProduct">TO THE/);
  assert.match(html, /<h2 class="taHeroStatement"/);
  assert.match(html, /KORDYN · AI AUTONOMOUS TRADING/);
  assert.match(styles, /--green:\s*#4FB78B/i);
  assert.match(styles, /--acid:\s*#CCFF3D/i);
  assert.match(styles, /\.taHeroProduct\s*\{[^}]*clamp\(/s);
  assert.doesNotMatch(html, /style="/);
});
