import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const conceptCss = await readFile(new URL("../src/aug15/conceptPages.css", import.meta.url), "utf8");
const appCss = await readFile(new URL("../src/aug15/styles.css", import.meta.url), "utf8");

test("desktop summary surfaces use the same light card language as their workspaces", () => {
  assert.match(conceptCss, /\.wmHero\{[^}]*background:#fff[^}]*color:var\(--text\)/);
  assert.match(conceptCss, /\.tcEffective\{[^}]*background:#fff[^}]*color:var\(--text\)/);
  assert.match(conceptCss, /\.erPageHeader\{[^}]*background:#fff[^}]*color:var\(--text\)/);
  assert.doesNotMatch(conceptCss, /\.wmHero\{[^}]*#24211d/);
  assert.doesNotMatch(conceptCss, /\.tcEffective\{[^}]*#29251f/);
  assert.doesNotMatch(conceptCss, /\.erPageHeader\{[^}]*linear-gradient\([^}]*#27231e/);
});

test("mobile intelligence and subscription summaries no longer introduce dark cards", () => {
  assert.match(appCss, /\.mIntelHero\s*\{[^}]*background:\s*#FFFEFB[^}]*color:\s*#1E1B16/);
  assert.match(appCss, /\.mPlanCard\s*\{[^}]*background:\s*#FFFEFB[^}]*border-color:\s*#E3DCCE/);
  assert.doesNotMatch(appCss, /\.mIntelHero\s*\{[^}]*#29251F/);
  assert.doesNotMatch(appCss, /\.mPlanCard\s*\{[^}]*#26221B/);
});
