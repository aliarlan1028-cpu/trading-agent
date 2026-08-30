import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { compareKordynV2Concepts } from "../scripts/compare-kordyn-v2-concepts.mjs";
import { KORDYN_V2_CONCEPTS } from "./helpers/kordyn-v2-concept-manifest.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const expectedConcepts = [
  "desktop-ai-mission-control",
  "desktop-ai-signals",
  "mobile-ai-mission-home",
  "mobile-ai-task-approval"
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function prepareAiCaptureRoot(testRoot, provenance = {}) {
  const screenshotsDir = path.join(testRoot, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const captures = [];
  for (const concept of KORDYN_V2_CONCEPTS.filter((row) => expectedConcepts.includes(row.id))) {
    for (const viewport of concept.targets) {
      const [width, height] = viewport.split("x").map(Number);
      const file = `${concept.id}--${viewport}.png`;
      const bytes = await sharp(await readFile(concept.absoluteFile)).resize(width, height, { fit: "fill" }).png().toBuffer();
      await writeFile(path.join(screenshotsDir, file), bytes);
      captures.push({
        file,
        viewport,
        device: concept.device,
        domainId: concept.domainId,
        workspaceId: concept.workspaceId,
        sha256: sha256(bytes),
        viewportGeometry: { width, height },
        document: { clientWidth: width, scrollWidth: width },
        shell: { left: 0, top: 0, width, height },
        noProductionWrites: true,
        legacyProductStyles: false
      });
    }
  }
  await writeFile(path.join(screenshotsDir, "capture-evidence.json"), `${JSON.stringify({
    schemaVersion: 1,
    runner: provenance.runner || "tests/run-kordyn-v2-ai-browser.mjs",
    fixture: provenance.fixture || "tests/kordyn-v2-production-fixture.js",
    productionSourceCommit: provenance.productionSourceCommit ?? "a".repeat(40),
    captures
  }, null, 2)}\n`);
  return screenshotsDir;
}

test("AI comparison emits exactly four approved concepts and eight immutable-viewport captures", async () => {
  const testRoot = await mkdtemp(path.join(reviewRoot, ".task5-ai-comparison-"));
  try {
    const screenshotsDir = await prepareAiCaptureRoot(testRoot);
    const outputDir = path.join(testRoot, "output");
    const result = await compareKordynV2Concepts({ screenshotsDir, outputDir, scope: "ai" });
    assert.deepEqual(result.counts, {
      concepts: 15,
      completedConcepts: 4,
      pendingConcepts: 11,
      comparisons: 8,
      artifacts: 33
    });
    const names = (await readdir(outputDir)).sort();
    assert.equal(names.length, 33);
    const index = JSON.parse(await readFile(path.join(outputDir, "comparison-index.json"), "utf8"));
    assert.deepEqual(index.completed, expectedConcepts);
    assert.deepEqual(index.scopeCounts, {
      manifestConcepts: 15,
      scopedConcepts: 4,
      completedScopedConcepts: 4,
      pendingScopedConcepts: 0,
      outOfScopeConcepts: 11
    });
    assert.deepEqual(index.scopedPending, []);
    assert.equal(index.outOfScope.length, 11);
    assert.equal(index.scope, "ai");
    assert.equal(index.productionSourceCommit, "a".repeat(40));
    assert.equal(index.comparisons.length, 8);
    for (const row of index.comparisons) {
      assert.equal(row.viewport === "1180x820", false);
      assert.ok(["1440x900", "1180x800", "390x844", "430x932"].includes(row.viewport));
      const geometry = JSON.parse(await readFile(path.join(outputDir, row.artifacts.geometry.file), "utf8"));
      assert.equal(geometry.actual.runner, "tests/run-kordyn-v2-ai-browser.mjs");
      assert.equal(geometry.actual.fixture, "tests/kordyn-v2-production-fixture.js");
      assert.equal(geometry.actual.productionSourceCommit, "a".repeat(40));
    }
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("AI comparison rejects shell or forged capture provenance", async () => {
  const testRoot = await mkdtemp(path.join(reviewRoot, ".task5-ai-provenance-"));
  try {
    for (const provenance of [
      { runner: "tests/run-kordyn-v2-shell-browser.mjs" },
      { fixture: "tests/fixture-presenter.js" },
      { productionSourceCommit: "not-a-commit" }
    ]) {
      const screenshotsDir = await prepareAiCaptureRoot(testRoot, provenance);
      await assert.rejects(
        compareKordynV2Concepts({ screenshotsDir, outputDir: path.join(testRoot, "output"), scope: "ai" }),
        /invalid_capture_provenance/
      );
      await rm(screenshotsDir, { recursive: true, force: true });
    }
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
