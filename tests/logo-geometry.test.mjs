import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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

test("iOS 图标由最新白色中心 Logo 生成", async () => {
  const iconPath = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
  const metadata = await sharp(iconPath).metadata();
  const center = await sharp(iconPath).extract({ left: 511, top: 511, width: 2, height: 2 }).removeAlpha().raw().toBuffer();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.hasAlpha, false);
  for (let index = 0; index < center.length; index += 3) {
    assert.ok(center[index] >= 250 && center[index + 1] >= 250 && center[index + 2] >= 250, "图标中心必须是白色");
  }
});
