import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("KORDYN SVG 使用透明正方形视口，侧边栏不得裁切品牌图形", () => {
  const svg = fs.readFileSync(path.join(root, "public/kordyn-logo.svg"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(svg, /viewBox="0 0 884 884"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /fill="url\(#green\)"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /fill="url\(#red\)"/);
  assert.match(css, /\.brandMark\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.brandMark \.brandLogo\s*\{[^}]*object-fit:\s*contain/s);
});
