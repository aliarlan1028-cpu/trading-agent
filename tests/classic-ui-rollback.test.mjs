import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("legacy cutover loads the August 15 classic visual bundle without later shell CSS", () => {
  const main = read("../src/main.jsx");
  const app = read("../src/aug15/App.jsx");
  const workspaces = read("../src/aug15/workspacePages.jsx");
  const concepts = read("../src/aug15/conceptPages.jsx");

  assert.match(main, /import\("\.\/aug15\/App\.jsx"\)/);
  assert.match(main, /<August15AuthenticatedShell/);
  assert.match(app, /import "\.\/styles\.css"/);
  assert.match(workspaces, /import "\.\/workspace\.css"/);
  assert.match(workspaces, /import "\.\/workspace-additions\.css"/);
  assert.match(concepts, /import "\.\/conceptPages\.css"/);
  assert.match(concepts, /import "\.\/conceptSettings\.css"/);
  assert.match(app, /AUGUST15_VISUAL_SOURCE = "7c8978427865a9d500a072780af0ec68cf6a9537"/);
  assert.doesNotMatch(app, /product-system|zero-base|kordynV2/);
});

test("desktop legacy presentation restores the classic five-domain shell", () => {
  const main = read("../src/main.jsx");
  const shell = read("../src/productShell.jsx");

  assert.match(main, /data-classic-shell="desktop"/);
  assert.match(main, /function ClassicSidebar/);
  assert.match(main, /function August15AppTopbar/);
  assert.match(main, /data-august15-topbar="true"/);
  for (const id of ["chat", "cockpit", "researchCenter", "riskCenter", "operationsCenter", "systemSettings"]) {
    assert.match(main, new RegExp(`(?:id:|active ===) ["']${id}["']`));
  }
  assert.match(main, /<ClassicSidebar active=\{active\} setActive=\{navigate\}/);
  assert.match(main, /<CommandRail[^>]+variant="august15"/);
  assert.match(shell, /variant === "august15"[\s\S]*?搜索市场、交易对、知识或功能/);
  assert.match(main, /onObjectSelect=\{setSelectedShellObject\}/);
  const august15Topbar = main.match(/function August15AppTopbar[\s\S]*?\n\}/)?.[0] || "";
  assert.match(august15Topbar, /autonomyPill/);
  assert.match(august15Topbar, /killButton/);
  assert.doesNotMatch(august15Topbar, /topEmergencyActions|runtimeStatePill/);
  assert.doesNotMatch(main.match(/data-classic-shell="desktop"[\s\S]*?data-classic-shell-end/)?.[0] || "", /ZeroBaseDesktopShell/);
});

test("classic shell keeps all post-OpenRouter workspaces instead of reverting product capability", () => {
  const main = read("../src/main.jsx");
  const workspaces = read("../src/workspacePages.jsx");
  const concepts = read("../src/conceptPages.jsx");
  const chat = read("../src/chat.jsx");
  const architecture = read("../src/productArchitecture.js");
  const zeroBase = read("../src/zeroBaseArchitecture.js");

  assert.match(main, /<AiTraderCenter[^>]+classic/);
  assert.match(main, /<TradingCenter[^>]+classic/);
  assert.match(main, /<ResearchCenter[^>]+classic/);
  assert.match(main, /<RiskCenter[^>]+classic/);
  assert.match(main, /<OperationsCenter[^>]+classic/);
  assert.match(workspaces, /if \(product && !classic\)/);
  for (const capability of ["patrol", "poster", "events", "account", "protection", "reviews", "owner", "recovery"]) {
    assert.match(workspaces, new RegExp(`["']${capability}["']`));
  }
  assert.match(workspaces, /AUGUST15_AI_PRIMARY_TABS/);
  for (const primary of ["dialog", "intel", "watch"]) assert.match(workspaces, new RegExp(`AUGUST15_AI_PRIMARY_TABS[\\s\\S]*?["']${primary}["']`));
  assert.match(workspaces, /classic[^\n]+AUGUST15_AI_PRIMARY_TABS/);
  assert.match(workspaces, /<AiDialogConcept[^>]+classic=\{classic\}/);
  assert.match(concepts, /<ChatPage[^>]+classic=\{classic\}/);
  assert.match(chat, /classic && !mobile && !archiveSurface[\s\S]*?agRunBadge/);
  assert.match(chat, /classic && !mobile && !archiveSurface[\s\S]*?agLaunchBtn/);
  assert.match(architecture, /aliases: \["chat:patrol", "patrol"\][\s\S]*?tab: "patrol"/);
  assert.match(architecture, /aliases: \["chat:poster", "poster"\][\s\S]*?tab: "poster"/);
  assert.match(zeroBase, /view\("patrol", "自主巡检", "Autonomous patrol", "chat:patrol"\)/);
  assert.match(zeroBase, /view\("poster", "分析海报", "Analysis poster", "chat:poster"\)/);
});

test("mobile legacy presentation restores the August 15 chrome and moves later tools into More", () => {
  const main = read("../src/main.jsx");
  const mobile = read("../src/mobile.jsx");

  assert.match(main, /data-classic-shell="mobile"/);
  assert.match(main, /<MobileApp key=\{lang\} classic/);
  assert.match(main, /className="classicMobileHost"/);
  assert.match(mobile, /data-classic-mobile-shell="true"/);
  assert.match(mobile, /ClassicMobileHeader/);
  assert.match(mobile, /ClassicMobileTabbar/);
  assert.match(mobile, /ClassicNavDrawer/);
  assert.match(mobile, /classicDrawerShellTools/);
  assert.match(mobile, /"ai:dialog": \[t\("AI 交易员", "AI Trader"\), "ALPHA-01"\]/);
  assert.match(mobile, /className=\{`mRunBadge/);
  const classicReturn = mobile.match(/if \(classic\) return[\s\S]*?\n  return <ZeroBaseMobileShell/)?.[0] || "";
  assert.doesNotMatch(classicReturn, /<MobileShellTools[^>]+\/>\s*\n\s*<ClassicMobileTabbar/);
  assert.match(classicReturn, /shellTools=\{<MobileShellTools/);
});
