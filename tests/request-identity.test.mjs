import assert from "node:assert/strict";
import test from "node:test";
import { nextResourceRequest, resourceRequestIsCurrent } from "../src/requestIdentity.js";

test("an older history response cannot write after the selected resource changes", () => {
  let current = { resource: "fills", generation: 0 };
  const fillsRequest = nextResourceRequest(current, "fills");
  current = fillsRequest;
  const auditRequest = nextResourceRequest(current, "audit");
  current = auditRequest;

  assert.equal(resourceRequestIsCurrent(current, fillsRequest), false);
  assert.equal(resourceRequestIsCurrent(current, auditRequest), true);

  const nextAuditPage = nextResourceRequest(current, "audit");
  current = nextAuditPage;
  assert.equal(resourceRequestIsCurrent(current, auditRequest), false, "an older cursor response must not overwrite a newer page request");
  assert.equal(resourceRequestIsCurrent(current, nextAuditPage), true);
});
