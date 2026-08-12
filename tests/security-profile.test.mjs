import assert from "node:assert/strict";
import test from "node:test";
import { productionSecurityProfile, requiresExternalSecurityInfrastructure, SECURITY_PROFILES } from "../server/securityProfile.mjs";

test("security profile defaults fail-closed to external hardened", () => {
  assert.equal(productionSecurityProfile({}), SECURITY_PROFILES.hardened);
  assert.equal(requiresExternalSecurityInfrastructure({}), true);
});

test("BitLaunch single-server profile is explicit and does not claim external infrastructure", () => {
  const env = { PRODUCTION_SECURITY_PROFILE: "bitlaunch_single_server" };
  assert.equal(productionSecurityProfile(env), SECURITY_PROFILES.bitlaunchSingleServer);
  assert.equal(requiresExternalSecurityInfrastructure(env), false);
});
