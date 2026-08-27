import assert from "node:assert/strict";
import { load } from "cheerio";

export function assertStateContract(markup, expectedState) {
  assert.equal(typeof markup, "string");
  assert.doesNotMatch(markup, /undefined|NaN/);

  const $ = load(markup);
  const root = $(`[data-kordyn-v2-state="${expectedState}"]`);
  assert.equal(root.length, 1, `expected one exact ${expectedState} state marker`);
  const heading = root.find("h1, h2, h3, h4, h5, h6, [data-kordyn-v2-state-heading]").addBack("h1, h2, h3, h4, h5, h6, [data-kordyn-v2-state-heading]").first();
  const message = root.find("p, [data-kordyn-v2-state-message]").addBack("p, [data-kordyn-v2-state-message]").first();
  assert.ok(heading.text().trim(), "state heading must not be empty");
  assert.ok(message.text().trim(), "state message must not be empty");

  if (["stale", "degraded"].includes(expectedState)) {
    const source = root.find("[data-kordyn-v2-last-valid-source]").addBack("[data-kordyn-v2-last-valid-source]").first();
    const time = root.find("[data-kordyn-v2-last-valid-at]").addBack("[data-kordyn-v2-last-valid-at]").first();
    assert.ok(source.attr("data-kordyn-v2-last-valid-source")?.trim(), "last-valid source must not be empty");
    assert.ok(time.attr("data-kordyn-v2-last-valid-at")?.trim(), "last-valid time must not be empty");
  }
}
