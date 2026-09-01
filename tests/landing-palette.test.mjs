import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/landing.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/landing.js", import.meta.url), "utf8");

test("marketing restores the complete August 15 page and its real entry actions", () => {
  for (const id of ["top", "capabilities", "lifecycle", "guardrails", "knowledge", "contact"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing August 15 section ${id}`);
  }
  for (const action of ["login", "subscribe", "contact", "lang"]) {
    assert.match(html, new RegExp(`data-action=["']${action}["']`), `missing marketing action ${action}`);
  }
  assert.equal([...html.matchAll(/data-i18n(?:-html)?=/g)].length, 107);
  assert.match(script, /\/api\/public\/ticker-bar/);
  assert.match(script, /type:\s*["']lp-start["']/);
});

test("marketing restores the August 15 dark Web3 orange visual grammar", () => {
  for (const color of ["#0c0a08", "#ff7a2f", "#ffa259", "#f2ead9", "#4fd08a"]) {
    assert.match(html, new RegExp(color, "i"), `missing August 15 color ${color}`);
  }
  assert.match(html, /Space Grotesk/);
  assert.match(html, /IBM Plex Mono/);
  assert.match(html, /@keyframes taMarquee/);
  assert.match(html, /@keyframes taGridPan/);
  assert.match(html, /@media \(max-width: 560px\)/);
});

test("marketing copy remains bilingual and product capability claims stay bounded", () => {
  const keys = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 100);
  for (const key of new Set(keys)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(script, new RegExp(`"${escaped}"\\s*:\\s*\\[`), `missing bilingual copy for ${key}`);
  }
  assert.match(html, /提现权限永不开放/);
  assert.match(html, /默认只读/);
});
