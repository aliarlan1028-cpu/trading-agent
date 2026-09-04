import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("artifacts/chatgpt-ui-review-2026-09-04");
const screenshots = path.join(root, "screenshots");
const output = path.join(root, "contact-sheets");
await mkdir(output, { recursive: true });

const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function pngs(folder, prefix = "") {
  const dir = path.join(screenshots, folder);
  return (await readdir(dir))
    .filter((name) => name.endsWith(".png") && (!prefix || name.startsWith(prefix)))
    .sort()
    .map((name) => ({ name, file: path.join(dir, name) }));
}

async function contactSheet({ items, name, columns, tileWidth, imageHeight }) {
  const labelHeight = 30;
  const gap = 8;
  const tileHeight = labelHeight + imageHeight;
  const rows = Math.ceil(items.length / columns);
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const left = gap + (index % columns) * (tileWidth + gap);
    const top = gap + Math.floor(index / columns) * (tileHeight + gap);
    const image = await sharp(item.file)
      .resize({ width: tileWidth, height: imageHeight, fit: "contain", background: "#f4f1e9" })
      .png()
      .toBuffer();
    const label = Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111311"/><text x="8" y="20" font-size="12" font-family="Arial, sans-serif" fill="#ffffff">${xml(item.name.replace(/\.png$/, ""))}</text></svg>`);
    composites.push({ input: label, left, top }, { input: image, left, top: top + labelHeight });
  }
  await sharp({ create: { width, height, channels: 3, background: "#dedbd3" } })
    .composite(composites)
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toFile(path.join(output, name));
}

await contactSheet({ items: await pngs("desktop"), name: "01-desktop-all.jpg", columns: 5, tileWidth: 280, imageHeight: 175 });
await contactSheet({ items: await pngs("app"), name: "02-app-all.jpg", columns: 8, tileWidth: 156, imageHeight: 338 });
await contactSheet({ items: await pngs("auth"), name: "03-auth-all.jpg", columns: 4, tileWidth: 320, imageHeight: 220 });
await contactSheet({ items: await pngs("overlays", "desktop-"), name: "04-desktop-overlays.jpg", columns: 5, tileWidth: 280, imageHeight: 175 });
await contactSheet({ items: await pngs("overlays", "app-"), name: "05-app-overlays.jpg", columns: 8, tileWidth: 156, imageHeight: 338 });

console.log("contact sheets created");
