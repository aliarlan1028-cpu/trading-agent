import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("artifacts/chatgpt-ui-review-2026-09-04");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (!new Set(["manifest.json", "capture-harness.html", "capture-harness.jsx", "make-contact-sheets.mjs", "make-manifest.mjs", "verify-package.mjs"]).has(entry.name)) files.push(full);
  }
  return files;
}

const files = [];
for (const full of (await walk(root)).sort()) {
  const data = await readFile(full);
  const item = {
    path: path.relative(root, full),
    bytes: (await stat(full)).size,
    sha256: createHash("sha256").update(data).digest("hex")
  };
  if (/\.(png|jpe?g)$/i.test(full)) {
    const metadata = await sharp(data).metadata();
    item.width = metadata.width;
    item.height = metadata.height;
    item.format = metadata.format;
  }
  files.push(item);
}

const counts = {
  desktopScreenshots: files.filter((item) => item.path.startsWith("screenshots/desktop/")).length,
  appScreenshots: files.filter((item) => item.path.startsWith("screenshots/app/")).length,
  authScreenshots: files.filter((item) => item.path.startsWith("screenshots/auth/")).length,
  overlayScreenshots: files.filter((item) => item.path.startsWith("screenshots/overlays/")).length,
  contactSheets: files.filter((item) => item.path.startsWith("contact-sheets/")).length
};
counts.originalScreenshots = counts.desktopScreenshots + counts.appScreenshots + counts.authScreenshots + counts.overlayScreenshots;

await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({ generatedAt: "2026-09-04", counts, files }, null, 2)}\n`);
console.log(JSON.stringify(counts));
