import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderModelOptions } from "../src/modelOptions.js";

test("Gemini selector merges every live model and keeps the recommended Pro model first", () => {
  const options = buildProviderModelOptions("gemini", [
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview from OpenRouter" },
    { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" }
  ], "google/gemini-2.5-flash");

  assert.equal(options[0].id, "google/gemini-3.1-pro-preview");
  assert.equal(options[0].recommended, true);
  assert.deepEqual(new Set(options.map((model) => model.id)), new Set([
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.7-flash",
    "google/gemini-3.6-flash",
    "google/gemini-2.5-flash",
    "google/gemini-3.5-flash"
  ]));
  assert.equal(options.filter((model) => model.id === "google/gemini-3.1-pro-preview").length, 1);
});

test("model selector preserves an already configured model when the live catalog omits it", () => {
  const options = buildProviderModelOptions("gemini", [], "google/gemini-2.5-pro");
  assert.equal(options.some((model) => model.id === "google/gemini-2.5-pro"), true);
});
