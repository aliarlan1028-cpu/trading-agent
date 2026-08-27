import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  KORDYN_V2_FIDELITY_REGIONS,
  evaluateKordynV2VisualContract
} from "./helpers/kordyn-v2-visual-contract.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = { r: 7, g: 15, b: 27 };
const cases = [
  {
    width: 1440,
    height: 900,
    screenshot: path.join(rootDir, ".impeccable/review/kordyn-v2/foundation/desktop-1440x900.png")
  },
  {
    width: 1180,
    height: 800,
    screenshot: path.join(rootDir, ".impeccable/review/kordyn-v2/foundation/desktop-1180x800.png")
  }
];

async function flatFrame(width, height) {
  return await sharp({
    create: { width, height, channels: 3, background }
  }).png().toBuffer();
}

async function hiddenLandmarkFrame(source, width, height) {
  const composites = [];
  for (const region of KORDYN_V2_FIDELITY_REGIONS.filter((entry) => entry.name !== "whole-frame")) {
    const left = Math.floor(region.left * width);
    const top = Math.floor(region.top * height);
    const regionWidth = Math.floor((region.left + region.width) * width) - left;
    const regionHeight = Math.floor((region.top + region.height) * height) - top;
    composites.push({
      input: await flatFrame(regionWidth, regionHeight),
      left,
      top
    });
  }
  return await sharp(source).composite(composites).png().toBuffer();
}

test("legacy weighted RGB MAE alone accepts the exact flat midnight sentinel", async () => {
  const outcomes = [];
  for (const fixture of cases) {
    const result = await evaluateKordynV2VisualContract(
      await flatFrame(fixture.width, fixture.height),
      fixture.width,
      fixture.height
    );
    outcomes.push({ width: fixture.width, metric: result.metric, threshold: result.threshold });
    assert.equal(result.maeAccepted, true, `${fixture.width}: pre-structural MAE blind spot must be reproduced`);
  }
  assert.equal(outcomes.length, 2);
});

test("final visual acceptance rejects the exact flat midnight sentinel", async () => {
  for (const fixture of cases) {
    const result = await evaluateKordynV2VisualContract(
      await flatFrame(fixture.width, fixture.height),
      fixture.width,
      fixture.height
    );
    assert.equal(result.accepted, false, `${fixture.width}: a flat frame cannot satisfy the visual contract`);
  }
});

test("shared comparator exposes structural evidence and rejects hidden landmark regions", async () => {
  for (const fixture of cases) {
    const source = await readFile(fixture.screenshot);
    const result = await evaluateKordynV2VisualContract(
      await hiddenLandmarkFrame(source, fixture.width, fixture.height),
      fixture.width,
      fixture.height
    );
    assert.equal(result.maeAccepted, true, `${fixture.width}: hidden-landmark sentinel reproduces the MAE blind spot`);
    assert.equal(typeof result.structure, "object", `${fixture.width}: comparator must publish per-region structural evidence`);
    assert.equal(result.structure.accepted, false, `${fixture.width}: hidden landmarks cannot satisfy structural acceptance`);
    assert.equal(result.accepted, false, `${fixture.width}: combined acceptance must reject hidden landmarks`);
  }
});

test("committed real shell screenshots remain positive visual fixtures", async () => {
  for (const fixture of cases) {
    const result = await evaluateKordynV2VisualContract(
      await readFile(fixture.screenshot),
      fixture.width,
      fixture.height
    );
    assert.equal(result.maeAccepted, true, `${fixture.width}: real shell stays within the pinned MAE threshold`);
    assert.equal(result.accepted, true, `${fixture.width}: real shell satisfies combined visual acceptance`);
  }
});
