import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { extractFromEpub, listTextFilesBounded } from "../server/knowledgePipeline.mjs";

async function withTemp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-limits-"));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function writeEpub(filePath, files) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
}

test("EPUB rejects excessive central-directory entries before extraction", async () => withTemp(async (dir) => {
  const file = path.join(dir, "many.epub");
  await writeEpub(file, { "a.html": "<body>A</body>", "b.html": "<body>B</body>", "c.html": "<body>C</body>" });
  await assert.rejects(() => extractFromEpub(file, { maxEntries: 2 }), /too many entries/i);
}));

test("EPUB rejects a highly compressed oversized chapter", async () => withTemp(async (dir) => {
  const file = path.join(dir, "bomb.epub");
  await writeEpub(file, { "chapter.xhtml": `<body>${"A".repeat(100_000)}</body>` });
  await assert.rejects(
    () => extractFromEpub(file, { maxEntryBytes: 200_000, maxTotalBytes: 200_000, maxCompressionRatio: 10 }),
    /compression ratio exceeds/i
  );
}));

test("EPUB enforces the actual parsed-text limit while valid books pass", async () => withTemp(async (dir) => {
  const file = path.join(dir, "book.epub");
  await writeEpub(file, { "chapter.xhtml": `<html><body>${"word ".repeat(100)}</body></html>` });
  assert.match(await extractFromEpub(file, { maxCompressionRatio: 1_000, maxTextChars: 1_000 }), /word/);
  await assert.rejects(() => extractFromEpub(file, { maxCompressionRatio: 1_000, maxTextChars: 50 }), /text exceeds safety limit/i);
}));

test("GitHub worktree traversal stops at node/file/byte budgets", async () => withTemp(async (dir) => {
  await Promise.all(Array.from({ length: 20 }, (_, index) => fs.writeFile(path.join(dir, `${index}.md`), "x".repeat(32))));
  const result = await listTextFilesBounded(dir, { maxNodes: 10, maxFiles: 100, maxObservedBytes: 1024 });
  assert.equal(result.truncated, true);
  assert.ok(result.visitedNodes <= 11);
  assert.ok(result.files.length <= 10);
}));
