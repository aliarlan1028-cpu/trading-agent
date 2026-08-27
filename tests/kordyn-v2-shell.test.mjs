import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-shell");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `export { DesktopShell } from "./src/kordynV2/shell/DesktopShell.jsx";`,
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
const { DesktopShell } = require(outFile);

test("Desktop shell follows the approved four-domain composition", () => {
  const truth = {
    mode: "full",
    equity: 28640.72,
    available: 13870.1,
    exposure: 6102.4,
    freshness: "2026-08-27T14:32:00+08:00",
    runtime: "full_auto_small",
    risk: "normal"
  };
  const selection = {
    object: { id: "mission-eth-retest", type: "Mission", label: "ETH 突破回踩机会" },
    context: { objectId: "mission-eth-retest", title: "ETH 突破回踩机会" },
    trace: { objectId: "mission-eth-retest", stages: [] }
  };
  const html = renderToStaticMarkup(
    React.createElement(
      DesktopShell,
      {
        location: { domainId: "ai", workspaceId: "missions" },
        truth,
        state: { kind: "ready" },
        selection,
        onNavigate: () => {},
        onSelect: () => {}
      },
      React.createElement("main")
    )
  );
  assert.match(html, /data-kordyn-v2-shell="desktop"/);
  assert.equal((html.match(/data-kordyn-v2-domain-target=/g) || []).length, 4);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
  for (const label of ["AI 交易员", "账户交易", "智能资产", "系统治理", "任务", "情报", "观察哨", "事件日历", "对话"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /今日|更多/);
});
