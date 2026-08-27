import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOYED_FEATURES } from "../src/productCoverage.js";
import {
  KORDYN_V2_DOMAINS,
  KORDYN_V2_DOMAIN_IDS,
  KORDYN_V2_WORKSPACES
} from "../src/kordynV2/architecture/domains.js";
import { domainForCapability } from "../src/kordynV2/architecture/capabilityOwnership.js";
import { resolveV2Location, v2LocationForWorkspace } from "../src/kordynV2/architecture/routes.js";

test("V2 exposes exactly four domains and all 66 production capabilities", () => {
  assert.deepEqual(KORDYN_V2_DOMAIN_IDS, ["ai", "account", "assets", "governance"]);
  assert.deepEqual(KORDYN_V2_DOMAINS.map((row) => row.label), ["AI 交易员", "账户交易", "智能资产", "系统治理"]);
  assert.equal(DEPLOYED_FEATURES.length, 66);
  assert.equal(new Set(DEPLOYED_FEATURES.map((row) => row.id)).size, 66);
  for (const feature of DEPLOYED_FEATURES) {
    const owner = domainForCapability(feature.id);
    assert.ok(owner, feature.id);
    assert.ok(KORDYN_V2_DOMAIN_IDS.includes(owner.domainId), feature.id);
    assert.ok(KORDYN_V2_WORKSPACES[owner.domainId].some((row) => row.id === owner.workspaceId), feature.id);
  }
});

test("retired authenticated destinations cannot resolve", () => {
  for (const route of ["today", "more", "smartForms", "daoGovernance"]) {
    const location = resolveV2Location(route, "desktop");
    assert.equal(location.recognized, false);
    assert.equal(location.domainId, "ai");
    assert.equal(location.workspaceId, "missions");
  }
  assert.equal(JSON.stringify({ KORDYN_V2_DOMAINS, KORDYN_V2_WORKSPACES }).match(/今日|更多|智能表单|DAO\s*治理/i), null);
});

test("new routes retain existing production resource sections", () => {
  assert.deepEqual(v2LocationForWorkspace("account", "positions", "desktop"), {
    domainId: "account", workspaceId: "positions", legacyRoute: "positions",
    resourceSection: "cockpit", objectId: "", recognized: true
  });
  assert.equal(v2LocationForWorkspace("governance", "configuration", "mobile").resourceSection, "systemSettings");
});
