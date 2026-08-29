import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "cheerio";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-state-boundary");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ }
});
require("esbuild").buildSync({
  stdin: {
    contents: `export { StateBoundary } from "./src/kordynV2/shell/StateBoundary.jsx";`,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { StateBoundary } = require(outFile);

const BLOCKING_STATES = Object.freeze([
  ["loading", "正在读取权威事实"],
  ["empty", "当前范围没有事实"],
  ["failed", "事实读取失败"],
  ["forbidden", "当前身份无权访问"],
  ["disabled", "当前状态已禁用"],
  ["approval", "正在等待审批"],
  ["no-result", "尚无服务器结果"]
]);

test("production StateBoundary gives every blocking state a navigable semantic heading", () => {
  for (const [kind, expectedTitle] of BLOCKING_STATES) {
    const markup = renderToStaticMarkup(React.createElement(StateBoundary, {
      state: { kind, message: `${kind} authoritative detail` }
    }));

    assertStateContract(markup, kind);
    const $ = load(markup);
    const state = $(`[data-kordyn-v2-state="${kind}"]`);
    const headings = state.find("h2");
    assert.equal(headings.length, 1, `${kind}: expected one level-two state heading`);
    assert.equal(headings.first().text().trim(), expectedTitle, `${kind}: state heading copy`);
  }
});
