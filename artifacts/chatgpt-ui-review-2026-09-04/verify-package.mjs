import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("artifacts/chatgpt-ui-review-2026-09-04");
const failures = [];
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => failures.push(message);
const json = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const pngs = async (folder, prefix = "") => (await readdir(path.join(root, "screenshots", folder)))
  .filter((name) => name.endsWith(".png") && (!prefix || name.startsWith(prefix)))
  .sort();

const desktop = await json("desktop-inventory.json");
const app = await json("app-inventory.json");
const auth = await json("auth-inventory.json");
const overlays = await json("overlay-inventory.json");
const manifest = await json("manifest.json");

for (const [label, inventory, expected] of [["desktop inventory", desktop, 45], ["app inventory", app, 45], ["auth inventory", auth, 7]]) {
  if (inventory.length !== expected) fail(`${label}: expected ${expected}, got ${inventory.length}`);
  else pass(`${label}: ${expected} entries`);
  if (!inventory.every((item, index) => item.index === index + 1)) fail(`${label}: indices are not continuous`);
}

if (desktop.every((item, index) => item.file === app[index]?.file)) pass("desktop/app filenames map 1:1 by index");
else fail("desktop/app filenames do not map 1:1 by index");
if (desktop.every((item) => item.overflow === 0) && app.every((item) => item.overflow === 0)) pass("all 90 route captures report zero document overflow");
else fail("one or more route captures report overflow");

const actual = {
  desktop: await pngs("desktop"),
  app: await pngs("app"),
  auth: await pngs("auth"),
  desktopOverlays: await pngs("overlays", "desktop-"),
  appOverlays: await pngs("overlays", "app-")
};
for (const [label, items, expected] of [["desktop screenshots", actual.desktop, 45], ["app screenshots", actual.app, 45], ["auth screenshots", actual.auth, 7], ["desktop overlays", actual.desktopOverlays, 19], ["app overlays", actual.appOverlays, 19]]) {
  if (items.length === expected) pass(`${label}: ${expected}`);
  else fail(`${label}: expected ${expected}, got ${items.length}`);
}

const dimensions = [
  ...actual.desktop.map((name) => [path.join(root, "screenshots/desktop", name), 1440, 900]),
  ...actual.app.map((name) => [path.join(root, "screenshots/app", name), 390, 844]),
  ...actual.desktopOverlays.map((name) => [path.join(root, "screenshots/overlays", name), 1440, 900]),
  ...actual.appOverlays.map((name) => [path.join(root, "screenshots/overlays", name), 390, 844])
];
for (const [file, width, height] of dimensions) {
  const meta = await sharp(file).metadata();
  if (meta.width !== width || meta.height !== height) fail(`${path.relative(root, file)}: expected ${width}x${height}, got ${meta.width}x${meta.height}`);
}
if (!failures.some((item) => item.includes("expected") && item.includes("got"))) pass("all desktop/app route and overlay PNG dimensions are correct");

const expectedCounts = { desktopScreenshots: 45, appScreenshots: 45, authScreenshots: 7, overlayScreenshots: 38, contactSheets: 5, originalScreenshots: 135 };
for (const [key, value] of Object.entries(expectedCounts)) {
  if (manifest.counts[key] !== value) fail(`manifest ${key}: expected ${value}, got ${manifest.counts[key]}`);
}
if (Object.entries(expectedCounts).every(([key, value]) => manifest.counts[key] === value)) pass("manifest counts match the package");

if (overlays.length === 25 && overlays.filter((item) => item.scope === "desktop+app").length === 13) pass("overlay inventory represents 38 files via 13 paired and 12 platform-specific entries");
else fail("overlay inventory structure is unexpected");

for (const doc of ["README.md", "CHATGPT_REVIEW_PROMPT_ZH.md"]) {
  const markdown = await readFile(path.join(root, doc), "utf8");
  const links = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]).filter((target) => !target.includes(":"));
  for (const target of links) {
    try { await access(path.join(root, target)); }
    catch { fail(`${doc}: missing link target ${target}`); }
  }
  pass(`${doc}: ${links.length} local links checked`);
}

if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exitCode = 1;
} else {
  console.log("PASS package verification complete: 0 failures");
}
