import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MOBILE_FAMILY_NAV,
  MOBILE_MORE_FAMILIES,
  MOBILE_PRIMARY_NAV,
  mobileFamilyDestinations,
  mobileRootForFamily
} from "../src/mobileNavigation.js";
import { ZERO_BASE_FAMILIES } from "../src/zeroBaseArchitecture.js";

const mobileSource = readFileSync(new URL("../src/mobile.jsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/zeroBaseMobile.jsx", import.meta.url), "utf8");

test("APP exposes exactly the approved five roots", () => {
  assert.deepEqual(MOBILE_PRIMARY_NAV.map((item) => item.id), ["today", "ai", "assets", "intelligent", "more"]);
  assert.equal(new Set(MOBILE_PRIMARY_NAV.map((item) => item.id)).size, 5);
});

test("Intelligent and More own complete, non-duplicated family sets", () => {
  assert.deepEqual(MOBILE_FAMILY_NAV.intelligent, ["strategy", "knowledge", "capability", "reviews"]);
  assert.deepEqual(MOBILE_MORE_FAMILIES, ["guard", "operations", "configuration"]);
  const rootFamilies = Object.values(MOBILE_FAMILY_NAV).flat();
  assert.equal(new Set(rootFamilies).size, rootFamilies.length);
  assert.equal([...MOBILE_FAMILY_NAV.intelligent, ...MOBILE_FAMILY_NAV.more].some((family) => MOBILE_PRIMARY_NAV.some((root) => root.id === family)), false);
});

test("every production family view remains reachable from the APP architecture", () => {
  for (const family of ZERO_BASE_FAMILIES) {
    const expectedRoot = family.id === "portfolio" ? "assets"
      : ["strategy", "knowledge", "capability", "reviews"].includes(family.id) ? "intelligent"
        : ["guard", "operations", "configuration"].includes(family.id) ? "more"
          : family.id;
    assert.equal(mobileRootForFamily(family.id), expectedRoot);
    assert.deepEqual(mobileFamilyDestinations(family.id).map((item) => item.id), family.views.map((item) => item.id));
  }
});

test("production MobileApp mounts the zero-base touch shell and keeps canonical Context and Trace", () => {
  assert.match(mobileSource, /ZeroBaseMobileShell/);
  assert.match(mobileSource, /MobileShellTools/);
  assert.match(shellSource, /data-zero-base-shell="mobile"/);
  assert.match(shellSource, /data-zero-base-mobile-root=\{rootId\}/);
  assert.match(shellSource, /data-zero-base-mobile-family=\{familyId/);
  assert.match(shellSource, /data-zero-base-mobile-view=\{viewId/);
});

test("removed products are absent from the new APP navigation", () => {
  assert.doesNotMatch(JSON.stringify({ MOBILE_PRIMARY_NAV, MOBILE_FAMILY_NAV, MOBILE_MORE_FAMILIES }), /智能表单|DAO\s*治理/);
});
