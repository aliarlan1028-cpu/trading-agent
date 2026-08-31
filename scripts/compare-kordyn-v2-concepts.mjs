import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  KORDYN_V2_CONCEPTS,
  KORDYN_V2_TARGET_VIEWPORTS
} from "../tests/helpers/kordyn-v2-concept-manifest.mjs";
import { verifyAccountSourceProvenance } from "../tests/helpers/kordyn-v2-account-source-provenance.mjs";
import { evaluateKordynV2VisualContract } from "../tests/helpers/kordyn-v2-visual-contract.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const approvedRoot = path.join(rootDir, ".impeccable/mocks/kordyn-v2-approved");
const captureEvidenceFile = "capture-evidence.json";
const SCOPE_CONFIG = Object.freeze({
  shell: Object.freeze({
    runner: "tests/run-kordyn-v2-shell-browser.mjs",
    fixture: "tests/kordyn-v2-production-fixture.js",
    captureKey: "captures"
  }),
  ai: Object.freeze({
    runner: "tests/run-kordyn-v2-ai-browser.mjs",
    fixture: "tests/kordyn-v2-production-fixture.js",
    captureKey: "aiCaptures",
    productionCommit: true
  }),
  account: Object.freeze({
    runner: "tests/run-kordyn-v2-account-browser.mjs",
    fixture: "tests/kordyn-v2-account-browser.jsx",
    captureKey: "accountCaptures",
    productSourceCommit: true,
    captureTestCommit: true
  }),
  assets: Object.freeze({
    runner: "tests/run-kordyn-v2-assets-browser.mjs",
    fixture: "tests/kordyn-v2-assets-browser.jsx",
    captureKey: "assetCaptures",
    productionCommit: true
  })
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativeInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function rejectSymlinksBetween(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (!relativeInside(parent, candidate)) throw new Error(`unsafe_${label}_path:${candidate}`);
  let current = parent;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let identity;
    try {
      identity = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (identity.isSymbolicLink()) throw new Error(`symlink_${label}_path:${current}`);
  }
}

async function validatedEvidenceDirectory(input, label, { mustExist }) {
  if (typeof input !== "string" || !input.trim()) throw new Error(`missing_${label}_path`);
  const candidate = path.resolve(rootDir, input);
  await rejectSymlinksBetween(reviewRoot, candidate, label);
  if (!mustExist) return candidate;
  const resolved = await realpath(candidate).catch(() => {
    throw new Error(`missing_${label}_path:${candidate}`);
  });
  const realReview = await realpath(reviewRoot);
  if (!relativeInside(realReview, resolved)) throw new Error(`unsafe_${label}_path:${candidate}`);
  const identity = await lstat(resolved);
  if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error(`invalid_${label}_path:${candidate}`);
  return resolved;
}

async function regularContainedFile(parent, filename, label) {
  if (typeof filename !== "string" || !filename || path.basename(filename) !== filename) {
    throw new Error(`invalid_${label}_file:${filename}`);
  }
  const target = path.resolve(parent, filename);
  if (!relativeInside(parent, target)) throw new Error(`unsafe_${label}_file:${filename}`);
  const identity = await lstat(target).catch(() => {
    throw new Error(`missing_${label}_file:${filename}`);
  });
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error(`invalid_${label}_file:${filename}`);
  return target;
}

export async function verifyApprovedConceptSource(concept) {
  if (!concept || typeof concept !== "object") throw new Error("invalid_approved_concept");
  const allowlisted = KORDYN_V2_CONCEPTS.find((row) => row.id === concept.id);
  if (!allowlisted || concept.file !== allowlisted.file) throw new Error(`unapproved_concept:${concept.id ?? "unknown"}`);
  const target = path.resolve(rootDir, concept.file);
  const realApproved = await realpath(approvedRoot);
  const resolved = await realpath(target).catch(() => {
    throw new Error(`missing_approved_source:${concept.id}`);
  });
  if (!relativeInside(realApproved, resolved)) throw new Error(`approved_source_escape:${concept.id}`);
  const identity = await lstat(resolved);
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error(`invalid_approved_source:${concept.id}`);
  const bytes = await readFile(resolved);
  if (bytes.length === 0) throw new Error(`empty_approved_source:${concept.id}`);
  const actualHash = sha256(bytes);
  if (actualHash !== concept.sha256) throw new Error(`approved_source_hash_mismatch:${concept.id}`);
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== concept.source.width || metadata.height !== concept.source.height) {
    throw new Error(`approved_source_dimension_mismatch:${concept.id}`);
  }
  return { bytes, sha256: actualHash };
}

function captureMap(evidence, scopeConfig) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || evidence.schemaVersion !== 1) {
    throw new Error("invalid_capture_evidence");
  }
  if (evidence.runner !== scopeConfig.runner
    || evidence.fixture !== scopeConfig.fixture
    || !Array.isArray(evidence.captures)) {
    throw new Error("invalid_capture_provenance");
  }
  if (scopeConfig.productionCommit && !/^[0-9a-f]{40}$/.test(evidence.productionSourceCommit || "")) {
    throw new Error("invalid_capture_provenance");
  }
  if (scopeConfig.productSourceCommit && !/^[0-9a-f]{40}$/.test(evidence.productSourceCommit || "")) {
    throw new Error("invalid_capture_provenance");
  }
  if (scopeConfig.captureTestCommit && !/^[0-9a-f]{40}$/.test(evidence.captureTestSourceCommit || "")) {
    throw new Error("invalid_capture_provenance");
  }
  const mapped = new Map();
  for (const capture of evidence.captures) {
    if (!capture || typeof capture !== "object" || typeof capture.file !== "string") {
      throw new Error("invalid_capture_record");
    }
    if (mapped.has(capture.file)) throw new Error(`duplicate_capture_identity:${capture.file}`);
    mapped.set(capture.file, capture);
  }
  return mapped;
}

export function verifyComparisonCaptureProvenance({ scope, evidence, sourceRoot = rootDir } = {}) {
  if (scope !== "account") return null;
  return verifyAccountSourceProvenance(sourceRoot, evidence);
}

function viewportSize(viewport) {
  if (!KORDYN_V2_TARGET_VIEWPORTS.includes(viewport)) throw new Error(`invalid_viewport:${viewport}`);
  const [width, height] = viewport.split("x").map(Number);
  return { width, height };
}

function imageStructure(raw, width, height) {
  const pixels = width * height;
  const sums = [0, 0, 0];
  const squared = [0, 0, 0];
  let edgeTotal = 0;
  let edgeSamples = 0;
  for (let pixel = 0; pixel < raw.length; pixel += 3) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = raw[pixel + channel] / 255;
      sums[channel] += value;
      squared[channel] += value * value;
    }
  }
  for (let y = 0; y < height - 1; y += 3) {
    for (let x = 0; x < width - 1; x += 3) {
      const offset = (y * width + x) * 3;
      const right = offset + 3;
      const below = offset + width * 3;
      const luma = (index) => (0.2126 * raw[index] + 0.7152 * raw[index + 1] + 0.0722 * raw[index + 2]) / 255;
      edgeTotal += Math.hypot(luma(right) - luma(offset), luma(below) - luma(offset));
      edgeSamples += 1;
    }
  }
  const variance = sums.reduce((total, sum, channel) => (
    total + Math.max(0, squared[channel] / pixels - (sum / pixels) ** 2)
  ), 0) / 3;
  const edgeDensity = edgeSamples ? edgeTotal / edgeSamples : 0;
  return { variance, edgeDensity, nearFlat: variance < 0.00002 || edgeDensity < 0.0005 };
}

function pixelDifference(actual, reference) {
  if (actual.length !== reference.length) throw new Error("comparison_raw_length_mismatch");
  let total = 0;
  for (let index = 0; index < actual.length; index += 1) {
    total += Math.abs(actual[index] - reference[index]);
  }
  return total / actual.length / 255;
}

function buildComparisonPlan(scope, scopeConfig) {
  const plan = [];
  const identities = new Set();
  for (const concept of KORDYN_V2_CONCEPTS.filter((row) => row.comparisonScopes.includes(scope))) {
    for (const capture of concept[scopeConfig.captureKey]) {
      const identity = `${concept.id}--${capture.viewport}`;
      if (identities.has(identity)) throw new Error(`duplicate_output_identity:${identity}`);
      identities.add(identity);
      plan.push({ concept, capture, identity, ...viewportSize(capture.viewport) });
    }
  }
  return plan;
}

export function comparisonScopeLedger(scope) {
  const scopeConfig = SCOPE_CONFIG[scope];
  if (!scopeConfig) throw new Error(`invalid_comparison_scope:${scope ?? "missing"}`);
  const scopedConcepts = KORDYN_V2_CONCEPTS.filter((row) => row.comparisonScopes.includes(scope));
  const completed = scopedConcepts
    .filter((row) => Array.isArray(row[scopeConfig.captureKey]) && row[scopeConfig.captureKey].length > 0)
    .map((row) => row.id);
  const scopedPending = scopedConcepts
    .filter((row) => !completed.includes(row.id))
    .map((row) => ({ id: row.id, status: row.status }));
  const outOfScope = KORDYN_V2_CONCEPTS
    .filter((row) => !row.comparisonScopes.includes(scope))
    .map((row) => ({ id: row.id, status: row.status }));
  return {
    counts: {
      concepts: scopedConcepts.length,
      completedConcepts: completed.length,
      pendingConcepts: scopedPending.length
    },
    scopeCounts: {
      manifestConcepts: KORDYN_V2_CONCEPTS.length,
      scopedConcepts: scopedConcepts.length,
      completedScopedConcepts: completed.length,
      pendingScopedConcepts: scopedPending.length,
      outOfScopeConcepts: outOfScope.length
    },
    completed,
    scopedPending,
    outOfScope
  };
}

async function removeValidatedOutput(outputDir) {
  let identity;
  try {
    identity = await lstat(outputDir);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error(`invalid_output_path:${outputDir}`);
  for (const name of await readdir(outputDir)) {
    const child = path.join(outputDir, name);
    const childIdentity = await lstat(child);
    if (childIdentity.isSymbolicLink()) throw new Error(`output_contains_symlink:${name}`);
  }
  await rm(outputDir, { recursive: true, force: false });
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

export async function compareKordynV2Concepts({ screenshotsDir: screenshotsInput, outputDir: outputInput, scope } = {}) {
  const scopeConfig = SCOPE_CONFIG[scope];
  if (!scopeConfig) throw new Error(`invalid_comparison_scope:${scope ?? "missing"}`);
  const screenshotsDir = await validatedEvidenceDirectory(screenshotsInput, "screenshots", { mustExist: true });
  const outputDir = await validatedEvidenceDirectory(outputInput, "output", { mustExist: false });
  if (outputDir === screenshotsDir || relativeInside(screenshotsDir, outputDir)) {
    throw new Error(`unsafe_output_overlap:${outputDir}`);
  }

  for (const concept of KORDYN_V2_CONCEPTS) await verifyApprovedConceptSource(concept);
  const evidencePath = await regularContainedFile(screenshotsDir, captureEvidenceFile, "capture_evidence");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const captures = captureMap(evidence, scopeConfig);
  verifyComparisonCaptureProvenance({ scope, evidence });
  const plan = buildComparisonPlan(scope, scopeConfig);
  const artifactBuffers = new Map();
  const comparisons = [];

  for (const item of plan) {
    const { concept, capture, identity, width, height } = item;
    const captured = captures.get(capture.file);
    if (!captured) throw new Error(`missing_capture_evidence:${capture.file}`);
    if (captured.viewport !== capture.viewport
      || captured.device !== concept.device
      || captured.domainId !== concept.domainId
      || captured.workspaceId !== concept.workspaceId) {
      throw new Error(`capture_identity_mismatch:${capture.file}`);
    }
    if (captured.viewportGeometry?.width !== width || captured.viewportGeometry?.height !== height) {
      throw new Error(`capture_viewport_mismatch:${capture.file}`);
    }
    const clientWidth = captured.document?.clientWidth;
    const scrollWidth = captured.document?.scrollWidth;
    if (!Number.isFinite(clientWidth) || !Number.isFinite(scrollWidth)) {
      throw new Error(`invalid_document_geometry:${capture.file}`);
    }
    if (clientWidth !== width || scrollWidth > clientWidth) {
      throw new Error(`document_overflow:${capture.file}:${scrollWidth - clientWidth}`);
    }
    if (captured.noProductionWrites !== true || captured.legacyProductStyles !== false) {
      throw new Error(`untrusted_capture_authority:${capture.file}`);
    }

    const screenshotPath = await regularContainedFile(screenshotsDir, capture.file, "screenshot");
    const actualBytes = await readFile(screenshotPath);
    if (actualBytes.length === 0) throw new Error(`empty_screenshot:${capture.file}`);
    const actualHash = sha256(actualBytes);
    if (actualHash !== captured.sha256) throw new Error(`capture_hash_mismatch:${capture.file}`);
    const metadata = await sharp(actualBytes).metadata();
    if (metadata.width !== width || metadata.height !== height) {
      throw new Error(`screenshot_dimension_mismatch:${capture.file}`);
    }
    const actualRaw = await sharp(actualBytes).removeAlpha().raw().toBuffer();
    const structure = imageStructure(actualRaw, width, height);
    if (structure.nearFlat) throw new Error(`near_flat_screenshot:${capture.file}`);

    const source = await verifyApprovedConceptSource(concept);
    const referenceBytes = await sharp(source.bytes).resize(width, height, { fit: "fill" }).png().toBuffer();
    const referenceRaw = await sharp(referenceBytes).removeAlpha().raw().toBuffer();
    const overlayBytes = await sharp(referenceBytes)
      .composite([{ input: actualBytes, blend: "over", opacity: 0.5 }])
      .png()
      .toBuffer();
    const differenceBytes = await sharp(referenceBytes)
      .composite([{ input: actualBytes, blend: "difference" }])
      .png()
      .toBuffer();
    const diagnosticMae = pixelDifference(actualRaw, referenceRaw);
    const visualContract = concept.id === "desktop-ai-mission-control"
      ? await evaluateKordynV2VisualContract(actualBytes, width, height)
      : null;

    const artifactNames = {
      reference: `${identity}--reference.png`,
      overlay: `${identity}--overlay.png`,
      difference: `${identity}--difference.png`,
      geometry: `${identity}--geometry.json`
    };
    artifactBuffers.set(artifactNames.reference, referenceBytes);
    artifactBuffers.set(artifactNames.overlay, overlayBytes);
    artifactBuffers.set(artifactNames.difference, differenceBytes);
    const geometry = {
      schemaVersion: 1,
      identity,
      concept: {
        id: concept.id,
        file: concept.file,
        sha256: source.sha256,
        storedPixels: concept.source,
        normalizedViewport: capture.viewport
      },
      actual: {
        file: capture.file,
        sha256: actualHash,
        runner: evidence.runner,
        fixture: evidence.fixture,
        ...(scopeConfig.productionCommit ? { productionSourceCommit: evidence.productionSourceCommit } : {}),
        ...(scopeConfig.productSourceCommit ? { productSourceCommit: evidence.productSourceCommit } : {}),
        ...(scopeConfig.captureTestCommit ? { captureTestSourceCommit: evidence.captureTestSourceCommit } : {}),
        device: captured.device,
        domainId: captured.domainId,
        workspaceId: captured.workspaceId
      },
      viewport: { name: capture.viewport, width, height },
      document: captured.document,
      documentOverflow: scrollWidth - clientWidth,
      shellGeometry: captured.shell,
      diagnostics: {
        screenshotStructure: structure,
        pixelDifference: { metric: diagnosticMae, role: "diagnostic only" },
        contentAwareComparator: visualContract
          ? { ...visualContract, fixedShellThreshold: true }
          : { applied: false, reason: "no fixed mobile shell threshold in Foundation Plan 01" }
      },
      artifacts: {
        normalizedReference: { file: artifactNames.reference, sha256: sha256(referenceBytes) },
        overlay50: { file: artifactNames.overlay, sha256: sha256(overlayBytes) },
        absoluteDifference: { file: artifactNames.difference, sha256: sha256(differenceBytes) }
      },
      releaseVerdict: "human region review required"
    };
    const geometryBytes = jsonBuffer(geometry);
    artifactBuffers.set(artifactNames.geometry, geometryBytes);
    comparisons.push({
      identity,
      conceptId: concept.id,
      viewport: capture.viewport,
      actual: capture.file,
      artifacts: {
        ...geometry.artifacts,
        geometry: { file: artifactNames.geometry, sha256: sha256(geometryBytes) }
      },
      pixelDifference: diagnosticMae,
      releaseVerdict: geometry.releaseVerdict
    });
  }

  const scopeLedger = comparisonScopeLedger(scope);
  const counts = {
    ...scopeLedger.counts,
    comparisons: comparisons.length,
    artifacts: artifactBuffers.size + 1
  };
  const index = {
    schemaVersion: 1,
    scope,
    sourceManifest: "docs/kordyn-v2-approved-concept-manifest.md",
    captureEvidence: `${path.relative(rootDir, screenshotsDir).split(path.sep).join("/")}/${captureEvidenceFile}`,
    ...(scopeConfig.productionCommit ? { productionSourceCommit: evidence.productionSourceCommit } : {}),
    ...(scopeConfig.productSourceCommit ? { productSourceCommit: evidence.productSourceCommit } : {}),
    ...(scopeConfig.captureTestCommit ? { captureTestSourceCommit: evidence.captureTestSourceCommit } : {}),
    outputRoot: path.relative(rootDir, outputDir).split(path.sep).join("/"),
    counts,
    scopeCounts: scopeLedger.scopeCounts,
    completed: scopeLedger.completed,
    pending: scopeLedger.scopedPending,
    scopedPending: scopeLedger.scopedPending,
    outOfScope: scopeLedger.outOfScope,
    comparisons,
    releaseVerdict: "human region review required"
  };
  artifactBuffers.set("comparison-index.json", jsonBuffer(index));

  await removeValidatedOutput(outputDir);
  await mkdir(outputDir, { recursive: false });
  for (const [name, bytes] of [...artifactBuffers.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await writeFile(path.join(outputDir, name), bytes, { flag: "wx" });
  }
  return { counts, releaseVerdict: index.releaseVerdict };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await compareKordynV2Concepts({
    screenshotsDir: argument("--screenshots"),
    outputDir: argument("--output"),
    scope: argument("--scope")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
