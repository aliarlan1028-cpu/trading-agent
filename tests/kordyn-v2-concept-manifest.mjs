import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const foundationRoot = path.join(reviewRoot, "foundation");

let catalog;
let catalogImportError = null;
try {
  catalog = await import("./helpers/kordyn-v2-concept-manifest.mjs");
} catch (error) {
  catalogImportError = error;
}

let comparison;
let comparisonImportError = null;
try {
  comparison = await import("../scripts/compare-kordyn-v2-concepts.mjs");
} catch (error) {
  comparisonImportError = error;
}

test("the executable visual manifest pins every approved source and stages only the implemented shell pair", async () => {
  assert.ifError(catalogImportError);
  const { KORDYN_V2_CONCEPTS: concepts, KORDYN_V2_TARGET_VIEWPORTS: targets } = catalog;
  assert.deepEqual(targets, ["1440x900", "1180x800", "390x844", "430x932"]);
  assert.equal(concepts.length, 15);
  assert.equal(new Set(concepts.map((row) => row.id)).size, 15);
  assert.equal(concepts.filter((row) => row.foundationComparison === true).length, 2);
  assert.equal(concepts.filter((row) => row.status === "pending domain implementation").length, 13);
  for (const concept of concepts) {
    const bytes = await readFile(concept.absoluteFile);
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, concept.sha256, concept.id);
    assert.match(concept.file, /^\.impeccable\/mocks\/kordyn-v2-approved\/[a-z0-9-]+\.png$/);
    assert.ok(Number.isInteger(concept.source.width) && concept.source.width > 0, concept.id);
    assert.ok(Number.isInteger(concept.source.height) && concept.source.height > 0, concept.id);
    assert.ok(["desktop", "mobile"].includes(concept.device), concept.id);
    assert.ok(concept.targets.length > 0 && concept.targets.every((target) => targets.includes(target)), concept.id);
    assert.equal(typeof concept.domainId, "string", concept.id);
    assert.equal(typeof concept.workspaceId, "string", concept.id);
  }
});

test("foundation comparison mappings use only actual AI Mission shell captures", () => {
  assert.ifError(catalogImportError);
  const implemented = catalog.KORDYN_V2_CONCEPTS.filter((row) => row.foundationComparison === true);
  assert.deepEqual(implemented.map((row) => row.id), [
    "desktop-ai-mission-control",
    "mobile-ai-mission-home"
  ]);
  assert.deepEqual(implemented.flatMap((row) => row.captures.map((capture) => capture.viewport)), [
    "1440x900", "1180x800", "390x844", "430x932"
  ]);
});

test("the comparison harness exposes one import-safe deterministic API", () => {
  assert.ifError(comparisonImportError);
  assert.equal(typeof comparison.compareKordynV2Concepts, "function");
});

const implementedCaptures = [
  ["desktop-1440x900.png", "1440x900", "desktop", 1440, 900],
  ["desktop-1180x800.png", "1180x800", "desktop", 1180, 800],
  ["mobile-390x844.png", "390x844", "mobile", 390, 844],
  ["mobile-430x932.png", "430x932", "mobile", 430, 932]
];

async function hashFile(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function prepareCaptureRoot(testRoot, overrides = {}) {
  const screenshotsDir = path.join(testRoot, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const captures = [];
  for (const [file, viewport, device, width, height] of implementedCaptures) {
    const target = path.join(screenshotsDir, file);
    await copyFile(path.join(foundationRoot, file), target);
    captures.push({
      file,
      viewport,
      device,
      domainId: "ai",
      workspaceId: "missions",
      sha256: await hashFile(target),
      viewportGeometry: { width, height },
      document: { clientWidth: width, scrollWidth: width },
      shell: { left: 0, top: 0, width, height },
      noProductionWrites: true,
      legacyProductStyles: false
    });
  }
  const evidence = {
    schemaVersion: 1,
    runner: "tests/run-kordyn-v2-shell-browser.mjs",
    fixture: "tests/kordyn-v2-production-fixture.js",
    captures
  };
  Object.assign(evidence, overrides);
  await writeFile(path.join(screenshotsDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return { screenshotsDir, evidence };
}

async function snapshotOutput(outputDir) {
  const names = (await readdir(outputDir)).sort();
  const rows = {};
  for (const name of names) {
    const target = path.join(outputDir, name);
    if ((await lstat(target)).isFile()) rows[name] = await hashFile(target);
  }
  return rows;
}

test("foundation comparison emits deterministic provenance for exactly four implemented shell captures", async () => {
  assert.ifError(comparisonImportError);
  const testRoot = await mkdtemp(path.join(reviewRoot, ".task7-comparison-success-"));
  try {
    const { screenshotsDir } = await prepareCaptureRoot(testRoot);
    const outputDir = path.join(testRoot, "output");
    const first = await comparison.compareKordynV2Concepts({ screenshotsDir, outputDir, scope: "shell" });
    assert.deepEqual(first.counts, { concepts: 15, completedConcepts: 2, pendingConcepts: 13, comparisons: 4, artifacts: 17 });
    assert.equal(first.releaseVerdict, "human region review required");
    const firstSnapshot = await snapshotOutput(outputDir);
    assert.equal(Object.keys(firstSnapshot).length, 17);
    assert.ok("comparison-index.json" in firstSnapshot);

    for (const [file, viewport, device, width, height] of implementedCaptures) {
      const conceptId = device === "desktop" ? "desktop-ai-mission-control" : "mobile-ai-mission-home";
      const identity = `${conceptId}--${viewport}`;
      for (const suffix of ["reference.png", "overlay.png", "difference.png", "geometry.json"]) {
        assert.ok(`${identity}--${suffix}` in firstSnapshot, `${identity} ${suffix}`);
      }
      for (const suffix of ["reference.png", "overlay.png", "difference.png"]) {
        const metadata = await sharp(path.join(outputDir, `${identity}--${suffix}`)).metadata();
        assert.deepEqual([metadata.width, metadata.height], [width, height], `${identity} ${suffix}`);
      }
      const geometry = JSON.parse(await readFile(path.join(outputDir, `${identity}--geometry.json`), "utf8"));
      assert.equal(geometry.identity, identity);
      assert.equal(geometry.actual.file, file);
      assert.equal(geometry.actual.sha256, await hashFile(path.join(screenshotsDir, file)));
      assert.equal(geometry.documentOverflow, 0);
      assert.equal(geometry.diagnostics.pixelDifference.role, "diagnostic only");
      assert.equal(geometry.releaseVerdict, "human region review required");
      if (device === "desktop") {
        assert.equal(geometry.diagnostics.contentAwareComparator.fixedShellThreshold, true);
        assert.equal(geometry.diagnostics.contentAwareComparator.accepted, true);
      }
    }

    await writeFile(path.join(outputDir, "stale-extra.txt"), "must be removed");
    const second = await comparison.compareKordynV2Concepts({ screenshotsDir, outputDir, scope: "shell" });
    assert.deepEqual(second, first);
    assert.deepEqual(await snapshotOutput(outputDir), firstSnapshot);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("comparison fails closed on unsafe paths and untrustworthy capture evidence", async () => {
  assert.ifError(comparisonImportError);
  const testRoot = await mkdtemp(path.join(reviewRoot, ".task7-comparison-reject-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-comparison-external-"));
  try {
    const { screenshotsDir, evidence } = await prepareCaptureRoot(testRoot);
    const outputDir = path.join(testRoot, "output");
    await assert.rejects(
      comparison.compareKordynV2Concepts({ screenshotsDir: rootDir, outputDir, scope: "shell" }),
      /unsafe_screenshots_path/
    );
    await assert.rejects(
      comparison.compareKordynV2Concepts({ screenshotsDir, outputDir: path.join(reviewRoot, "..", "escaped"), scope: "shell" }),
      /unsafe_output_path/
    );

    const linked = path.join(testRoot, "linked-input");
    await symlink(external, linked);
    await assert.rejects(
      comparison.compareKordynV2Concepts({ screenshotsDir: linked, outputDir, scope: "shell" }),
      /symlink|unsafe_screenshots_path/
    );

    const first = evidence.captures[0];
    await sharp({ create: { width: first.viewportGeometry.width, height: first.viewportGeometry.height, channels: 3, background: "#07101b" } })
      .png()
      .toFile(path.join(screenshotsDir, first.file));
    first.sha256 = await hashFile(path.join(screenshotsDir, first.file));
    await writeFile(path.join(screenshotsDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await assert.rejects(
      comparison.compareKordynV2Concepts({ screenshotsDir, outputDir, scope: "shell" }),
      /near_flat_screenshot/
    );

    await copyFile(path.join(foundationRoot, first.file), path.join(screenshotsDir, first.file));
    first.sha256 = await hashFile(path.join(screenshotsDir, first.file));
    first.document.scrollWidth = first.document.clientWidth + 1;
    await writeFile(path.join(screenshotsDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await assert.rejects(
      comparison.compareKordynV2Concepts({ screenshotsDir, outputDir, scope: "shell" }),
      /document_overflow/
    );

    first.document.scrollWidth = first.document.clientWidth;
    await sharp(path.join(foundationRoot, first.file)).resize(100, 100).png().toFile(path.join(screenshotsDir, first.file));
    first.sha256 = await hashFile(path.join(screenshotsDir, first.file));
    await writeFile(path.join(screenshotsDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await assert.rejects(
      comparison.compareKordynV2Concepts({ screenshotsDir, outputDir, scope: "shell" }),
      /screenshot_dimension_mismatch/
    );

    assert.equal(typeof comparison.verifyApprovedConceptSource, "function");
    await assert.rejects(
      comparison.verifyApprovedConceptSource({ ...catalog.KORDYN_V2_CONCEPTS[0], sha256: "0".repeat(64) }),
      /approved_source_hash_mismatch/
    );
  } finally {
    await rm(testRoot, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
