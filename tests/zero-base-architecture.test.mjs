import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOYED_FEATURES } from "../src/productCoverage.js";
import {
  ZERO_BASE_FAMILIES,
  ZERO_BASE_GROUPS,
  ZERO_BASE_MOBILE_ROOTS,
  familyForFeature,
  resolveZeroBaseDestination
} from "../src/zeroBaseArchitecture.js";

const approvedFamilyIds = [
  "today", "ai", "portfolio", "strategy", "knowledge", "capability",
  "reviews", "guard", "operations", "configuration"
];

test("the zero-base product exposes only the approved page families", () => {
  assert.deepEqual(ZERO_BASE_FAMILIES.map(({ id }) => id), approvedFamilyIds);
  assert.equal(new Set(ZERO_BASE_FAMILIES.map(({ id }) => id)).size, approvedFamilyIds.length);
  assert.equal(/智能表单|DAO 治理|forms|dao/i.test(JSON.stringify(ZERO_BASE_FAMILIES)), false);
});

test("desktop groups own every family exactly once", () => {
  assert.deepEqual(ZERO_BASE_GROUPS.map(({ id }) => id), ["core", "intelligent-assets", "governance"]);
  const grouped = ZERO_BASE_GROUPS.flatMap(({ families }) => families);
  assert.deepEqual(grouped, approvedFamilyIds);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("every deployed feature resolves into one approved family", () => {
  const familyIds = new Set(approvedFamilyIds);
  for (const feature of DEPLOYED_FEATURES) {
    const familyId = familyForFeature(feature.id);
    assert.ok(familyIds.has(familyId), `${feature.id} -> ${familyId}`);
    assert.notEqual(familyId, "today", `${feature.id} must retain an authoritative workbench`);
  }
});

test("every family view resolves to recognized desktop and APP runtime routes", () => {
  for (const family of ZERO_BASE_FAMILIES) {
    for (const view of family.views) {
      for (const device of ["desktop", "mobile"]) {
        const destination = resolveZeroBaseDestination(family.id, view.id, device);
        assert.equal(destination.familyId, family.id, `${family.id}/${view.id}/${device}`);
        assert.equal(destination.viewId, view.id, `${family.id}/${view.id}/${device}`);
        assert.ok(destination.route, `${family.id}/${view.id}/${device} route`);
        assert.equal(destination.runtime.recognized, true, `${family.id}/${view.id}/${device} recognized`);
      }
    }
  }
});

test("unknown family or view fails closed to AI dialog", () => {
  assert.deepEqual(resolveZeroBaseDestination("not-real", "missing", "desktop"), resolveZeroBaseDestination("ai", "dialog", "desktop"));
  assert.deepEqual(resolveZeroBaseDestination("portfolio", "missing", "mobile"), resolveZeroBaseDestination("ai", "dialog", "mobile"));
});

test("APP has five unique roots and More does not duplicate them", () => {
  assert.deepEqual(ZERO_BASE_MOBILE_ROOTS.map(({ id }) => id), ["today", "ai", "assets", "intelligent", "more"]);
  assert.equal(new Set(ZERO_BASE_MOBILE_ROOTS.map(({ route }) => route)).size, ZERO_BASE_MOBILE_ROOTS.length);
  const rootFamilies = new Set(ZERO_BASE_MOBILE_ROOTS.flatMap(({ families }) => families));
  const more = ZERO_BASE_MOBILE_ROOTS.find(({ id }) => id === "more");
  assert.deepEqual(more.families, ["guard", "operations", "configuration"]);
  for (const familyId of more.families) assert.equal(rootFamilies.has(familyId), true);
  assert.equal(more.families.some((id) => ["today", "ai", "portfolio", "strategy", "knowledge", "capability", "reviews"].includes(id)), false);
});
