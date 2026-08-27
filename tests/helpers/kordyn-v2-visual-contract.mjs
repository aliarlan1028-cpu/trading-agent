import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const KORDYN_V2_APPROVED_REFERENCE_PATH = path.join(
  rootDir,
  ".impeccable/mocks/kordyn-v2-approved/desktop-ai-mission-control.png"
);

export const KORDYN_V2_APPROVED_REFERENCE_SHA = "55f988f9c87d1dce83d528bd2ad224b0951542cbab32eca018bf6c78818dbc20";

export const KORDYN_V2_FIDELITY_REGIONS = Object.freeze([
  { name: "whole-frame", left: 0, top: 0, width: 1, height: 1, weight: 0.20 },
  { name: "identity-rail", left: 0.76, top: 0, width: 0.24, height: 0.09, weight: 0.20 },
  { name: "workbench-footer", left: 0.31, top: 0.72, width: 0.47, height: 0.15, weight: 0.25 },
  { name: "command-support", left: 0.14, top: 0.86, width: 0.85, height: 0.13, weight: 0.35 }
]);

export const KORDYN_V2_STRUCTURE_REGIONS = Object.freeze([
  { name: "whole-frame", left: 0, top: 0, width: 1, height: 1 },
  { name: "identity-rail", left: 0.76, top: 0, width: 0.24, height: 0.09 },
  { name: "workbench-footer", left: 0.31, top: 0.72, width: 0.47, height: 0.15 },
  { name: "command-bar", left: 0.14, top: 0.86, width: 0.66, height: 0.13 },
  { name: "support", left: 0.80, top: 0.86, width: 0.19, height: 0.13 }
]);

// Fixed before new GREEN captures. The committed real evidence minima were
// luminance ratio .437, color ratio .448, edge cosine .185 and edge-density
// ratio .537; both RED sentinels measured zero in every required landmark.
export const KORDYN_V2_STRUCTURE_BOUNDS = Object.freeze({
  luminanceVarianceRatio: Object.freeze({ minimum: 0.35, maximum: 2.50 }),
  colorVarianceRatio: Object.freeze({ minimum: 0.35, maximum: 2.50 }),
  edgeCosine: Object.freeze({ minimum: 0.15 }),
  edgeDensityRatio: Object.freeze({ minimum: 0.45, maximum: 1.80 })
});

const luminance = (buffer, pixel) => (
  0.2126 * buffer[pixel] + 0.7152 * buffer[pixel + 1] + 0.0722 * buffer[pixel + 2]
) / 255;

function inside(value, bounds) {
  return value >= bounds.minimum && value <= (bounds.maximum ?? Number.POSITIVE_INFINITY);
}

function regionStructure(actual, reference, imageWidth, imageHeight, region) {
  const left = Math.floor(region.left * imageWidth);
  const top = Math.floor(region.top * imageHeight);
  const right = Math.floor((region.left + region.width) * imageWidth);
  const bottom = Math.floor((region.top + region.height) * imageHeight);
  let samples = 0;
  let actualLuminance = 0;
  let referenceLuminance = 0;
  let actualLuminanceSquared = 0;
  let referenceLuminanceSquared = 0;
  const actualChannels = [0, 0, 0];
  const referenceChannels = [0, 0, 0];
  const actualChannelsSquared = [0, 0, 0];
  const referenceChannelsSquared = [0, 0, 0];

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = (y * imageWidth + x) * 3;
      const actualLuma = luminance(actual, pixel);
      const referenceLuma = luminance(reference, pixel);
      samples += 1;
      actualLuminance += actualLuma;
      referenceLuminance += referenceLuma;
      actualLuminanceSquared += actualLuma * actualLuma;
      referenceLuminanceSquared += referenceLuma * referenceLuma;
      for (let channel = 0; channel < 3; channel += 1) {
        const actualValue = actual[pixel + channel] / 255;
        const referenceValue = reference[pixel + channel] / 255;
        actualChannels[channel] += actualValue;
        referenceChannels[channel] += referenceValue;
        actualChannelsSquared[channel] += actualValue * actualValue;
        referenceChannelsSquared[channel] += referenceValue * referenceValue;
      }
    }
  }

  const variance = (sum, squared) => Math.max(0, squared / samples - (sum / samples) ** 2);
  const actualLuminanceVariance = variance(actualLuminance, actualLuminanceSquared);
  const referenceLuminanceVariance = variance(referenceLuminance, referenceLuminanceSquared);
  const actualColorVariance = actualChannels.reduce(
    (total, sum, channel) => total + variance(sum, actualChannelsSquared[channel]),
    0
  ) / 3;
  const referenceColorVariance = referenceChannels.reduce(
    (total, sum, channel) => total + variance(sum, referenceChannelsSquared[channel]),
    0
  ) / 3;

  let edgeDotProduct = 0;
  let actualEdgeSquared = 0;
  let referenceEdgeSquared = 0;
  let actualEdgeTotal = 0;
  let referenceEdgeTotal = 0;
  let edgeSamples = 0;
  for (let y = top; y < bottom - 1; y += 2) {
    for (let x = left; x < right - 1; x += 2) {
      const pixel = (y * imageWidth + x) * 3;
      const actualEdge = Math.hypot(
        luminance(actual, pixel + 3) - luminance(actual, pixel),
        luminance(actual, pixel + imageWidth * 3) - luminance(actual, pixel)
      );
      const referenceEdge = Math.hypot(
        luminance(reference, pixel + 3) - luminance(reference, pixel),
        luminance(reference, pixel + imageWidth * 3) - luminance(reference, pixel)
      );
      edgeDotProduct += actualEdge * referenceEdge;
      actualEdgeSquared += actualEdge * actualEdge;
      referenceEdgeSquared += referenceEdge * referenceEdge;
      actualEdgeTotal += actualEdge;
      referenceEdgeTotal += referenceEdge;
      edgeSamples += 1;
    }
  }

  const luminanceVarianceRatio = referenceLuminanceVariance > 0
    ? actualLuminanceVariance / referenceLuminanceVariance
    : 0;
  const colorVarianceRatio = referenceColorVariance > 0
    ? actualColorVariance / referenceColorVariance
    : 0;
  const edgeCosine = actualEdgeSquared > 0 && referenceEdgeSquared > 0
    ? edgeDotProduct / Math.sqrt(actualEdgeSquared * referenceEdgeSquared)
    : 0;
  const actualEdgeDensity = edgeSamples ? actualEdgeTotal / edgeSamples : 0;
  const referenceEdgeDensity = edgeSamples ? referenceEdgeTotal / edgeSamples : 0;
  const edgeDensityRatio = referenceEdgeDensity > 0 ? actualEdgeDensity / referenceEdgeDensity : 0;
  const accepted = inside(luminanceVarianceRatio, KORDYN_V2_STRUCTURE_BOUNDS.luminanceVarianceRatio)
    && inside(colorVarianceRatio, KORDYN_V2_STRUCTURE_BOUNDS.colorVarianceRatio)
    && inside(edgeCosine, KORDYN_V2_STRUCTURE_BOUNDS.edgeCosine)
    && inside(edgeDensityRatio, KORDYN_V2_STRUCTURE_BOUNDS.edgeDensityRatio);
  return {
    accepted,
    luminanceVariance: { actual: actualLuminanceVariance, reference: referenceLuminanceVariance },
    luminanceVarianceRatio,
    colorVariance: { actual: actualColorVariance, reference: referenceColorVariance },
    colorVarianceRatio,
    edgeCosine,
    edgeDensity: { actual: actualEdgeDensity, reference: referenceEdgeDensity },
    edgeDensityRatio
  };
}

function regionMeanAbsoluteError(actual, reference, imageWidth, imageHeight, region) {
  const left = Math.floor(region.left * imageWidth);
  const top = Math.floor(region.top * imageHeight);
  const right = Math.floor((region.left + region.width) * imageWidth);
  const bottom = Math.floor((region.top + region.height) * imageHeight);
  let difference = 0;
  let samples = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = (y * imageWidth + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        difference += Math.abs(actual[pixel + channel] - reference[pixel + channel]);
        samples += 1;
      }
    }
  }
  return difference / samples / 255;
}

export async function evaluateKordynV2VisualContract(bytes, width, height) {
  const referenceBytes = await readFile(KORDYN_V2_APPROVED_REFERENCE_PATH);
  assert.equal(
    createHash("sha256").update(referenceBytes).digest("hex"),
    KORDYN_V2_APPROVED_REFERENCE_SHA,
    "approved desktop reference SHA"
  );
  const actual = await sharp(bytes).removeAlpha().raw().toBuffer();
  const reference = await sharp(referenceBytes)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const regions = Object.fromEntries(KORDYN_V2_FIDELITY_REGIONS.map((region) => [
    region.name,
    regionMeanAbsoluteError(actual, reference, width, height, region)
  ]));
  const metric = KORDYN_V2_FIDELITY_REGIONS.reduce(
    (total, region) => total + regions[region.name] * region.weight,
    0
  );
  const threshold = width === 1440 ? 0.0415 : 0.0475;
  const maeAccepted = metric <= threshold;
  const structureRegions = Object.fromEntries(KORDYN_V2_STRUCTURE_REGIONS.map((region) => [
    region.name,
    regionStructure(actual, reference, width, height, region)
  ]));
  const structure = {
    accepted: Object.values(structureRegions).every((region) => region.accepted),
    bounds: KORDYN_V2_STRUCTURE_BOUNDS,
    regions: structureRegions
  };
  return {
    metric,
    threshold,
    regions,
    maeAccepted,
    structure,
    accepted: maeAccepted && structure.accepted
  };
}
