import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../landing.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/marketing/landing.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/marketing/landing.css", import.meta.url), "utf8");

test("营销页迁移配色时保留现有内容层级和真实入口", () => {
  for (const id of ["top", "problem", "system", "capabilities", "guardrails", "compare"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing marketing section ${id}`);
  }
  for (const action of ["login", "subscribe", "contact", "lang"]) {
    assert.match(html, new RegExp(`data-action=["']${action}["']`), `missing marketing action ${action}`);
  }
  assert.equal([...html.matchAll(/data-i18n(?:-html)?=/g)].length, 413);
  assert.match(script, /\/api\/public\/ticker-bar/);
});

test("营销页使用获准的 e2p Web3 配色与系统字体", () => {
  for (const [token, value] of [
    ["paper", "#F4F1E9"],
    ["ink", "#111311"],
    ["acid", "#CCFF3D"],
    ["green", "#4FB78B"],
    ["danger", "#E25645"],
    ["amber", "#EFB44B"],
    ["muted", "#697169"]
  ]) {
    assert.match(styles, new RegExp(`--${token}:\\s*${value}`, "i"), `missing ${token} token`);
  }
  assert.match(styles, /--display:\s*"Avenir Next"/);
  assert.match(styles, /--body:\s*Inter/);
  assert.match(styles, /--mono:\s*"SFMono-Regular"/);
});

test("营销页不再依赖阻塞渲染的远程字体或旧紫橙品牌色", () => {
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.doesNotMatch(styles, /#a78bfa|#ff7a32|#ffb47f/i);
  assert.doesNotMatch(styles, /--violet:|--orange(?:-soft)?:/);
});
