import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("legacy cutover loads the August 17 classic visual bundle without later shell CSS", () => {
  const main = read("../src/main.jsx");
  const styles = read("../src/classicStyles.js");

  assert.match(main, /import\("\.\/classicStyles\.js"\)/);
  assert.match(styles, /import "\.\/styles\.css"/);
  assert.match(styles, /import "\.\/product-foundation\.css"/);
  assert.match(styles, /import "\.\/workspace\.css"/);
  assert.match(styles, /import "\.\/workspace-additions\.css"/);
  assert.match(styles, /import "\.\/conceptPages\.css"/);
  assert.match(styles, /import "\.\/conceptSettings\.css"/);
  assert.doesNotMatch(styles, /product-system|zero-base|kordynV2/);
});

test("desktop legacy presentation restores the classic five-domain shell", () => {
  const main = read("../src/main.jsx");

  assert.match(main, /data-classic-shell="desktop"/);
  assert.match(main, /function ClassicSidebar/);
  for (const id of ["chat", "cockpit", "researchCenter", "riskCenter", "operationsCenter", "systemSettings"]) {
    assert.match(main, new RegExp(`(?:id:|active ===) ["']${id}["']`));
  }
  assert.match(main, /<ClassicSidebar active=\{active\} setActive=\{navigate\}/);
  assert.match(main, /<CommandRail data=\{data\} onNavigate=\{setActive\} onSelect=\{onObjectSelect\}/);
  assert.match(main, /onObjectSelect=\{setSelectedShellObject\}/);
  assert.doesNotMatch(main.match(/data-classic-shell="desktop"[\s\S]*?data-classic-shell-end/)?.[0] || "", /ZeroBaseDesktopShell/);
});

test("classic shell keeps all post-OpenRouter workspaces instead of reverting product capability", () => {
  const main = read("../src/main.jsx");
  const workspaces = read("../src/workspacePages.jsx");

  assert.match(main, /<AiTraderCenter[^>]+classic/);
  assert.match(main, /<TradingCenter[^>]+classic/);
  assert.match(main, /<ResearchCenter[^>]+classic/);
  assert.match(main, /<RiskCenter[^>]+classic/);
  assert.match(main, /<OperationsCenter[^>]+classic/);
  assert.match(workspaces, /if \(product && !classic\)/);
  for (const capability of ["patrol", "poster", "events", "account", "protection", "reviews", "owner", "recovery"]) {
    assert.match(workspaces, new RegExp(`["']${capability}["']`));
  }
});

test("mobile legacy presentation uses the current capability component inside the classic visual host", () => {
  const main = read("../src/main.jsx");
  const mobile = read("../src/mobile.jsx");

  assert.match(main, /data-classic-shell="mobile"/);
  assert.match(main, /<MobileApp key=\{lang\} classic/);
  assert.match(main, /className="classicMobileHost"/);
  assert.match(mobile, /data-classic-mobile-shell="true"/);
  assert.match(mobile, /ClassicMobileHeader/);
  assert.match(mobile, /ClassicMobileTabbar/);
  assert.match(mobile, /ClassicNavDrawer/);
});
