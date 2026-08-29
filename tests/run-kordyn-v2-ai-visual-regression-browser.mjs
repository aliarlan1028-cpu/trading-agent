import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputDir = path.resolve(process.env.KORDYN_V2_VISUAL_FIX_SCREENSHOT_DIR || "/private/tmp/kordyn-v2-ai-visual-fix");

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
});

async function waitFor(url, predicate = () => true) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = url.endsWith("/json") ? await response.json() : await response.text();
        if (predicate(value)) return value;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const requestId = ++id;
      return await new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => { const target=document.querySelector(${JSON.stringify(selector)}); if(!target)return null; target.scrollIntoView({block:'center',inline:'nearest'}); const r=target.getBoundingClientRect(); const x=r.left+r.width/2; const y=r.top+r.height/2; const hit=document.elementFromPoint(x,y); return r.width>0&&r.height>0&&(hit===target||target.contains(hit))?{x,y}:null; })()`);
  assert.ok(point, `visible click target: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function capture(cdp, name, width, height) {
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(screenshot.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height]);
  await writeFile(path.join(outputDir, name), bytes);
}

async function navigate(cdp, baseUrl, page, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${baseUrl}${page}` });
}

async function verifyMobileMission(cdp, baseUrl, width, height) {
  await navigate(cdp, baseUrl, "/tests/kordyn-v2-shell-browser.html", width, height);
  await waitForExpression(cdp, "window.__kordynV2ShellReady && document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${width}: mobile Mission`);
  const geometry = await evaluate(cdp, `(() => {
    const rect=(selector)=>document.querySelector(selector)?.getBoundingClientRect();
    const nav=rect('[data-kordyn-v2-mobile-navigation]');
    const hero=rect('[data-kordyn-v2-mobile-mission-hero]');
    const attention=rect('[data-kordyn-v2-mobile-mission-attention]');
    const account=rect('[data-kordyn-v2-mobile-account-impact]');
    const recent=rect('[data-kordyn-v2-mobile-recent-completed]');
    const recentContent=document.querySelector('[data-kordyn-v2-mobile-recent-completed] > button, [data-kordyn-v2-mobile-recent-completed] > p')?.getBoundingClientRect();
    const prompt=rect('[data-kordyn-v2-dialog-trigger]');
    const support=rect('[data-kordyn-v2-ai-support-trigger]');
    const scroll=document.querySelector('.kordynV2MobileBackground > .kordynV2StateBoundary');
    const overlap=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)):0;
    return {
      heroHeight:hero?.height,
      heroTop:hero?.top,
      heroBottom:hero?.bottom,
      attentionTop:attention?.top,
      attentionBottom:attention?.bottom,
      accountTop:account?.top,
      accountBottom:account?.bottom,
      recentTop:recent?.top,
      recentBottom:recent?.bottom,
      recentContentTop:recentContent?.top,
      recentContentBottom:recentContent?.bottom,
      promptTop:prompt?.top,
      promptBottom:prompt?.bottom,
      navTop:nav?.top,
      overflow:document.documentElement.scrollWidth-innerWidth,
      promptSupport:overlap(prompt,support),
      promptNav:overlap(prompt,nav),
      promptRecentContent:overlap(prompt,recentContent),
      recentNav:overlap(recent,nav),
      recentContentNav:overlap(recentContent,nav),
      scrollTop:scroll?.scrollTop,
      scrollClientHeight:scroll?.clientHeight,
      scrollHeight:scroll?.scrollHeight,
      scrollRange:scroll ? scroll.scrollHeight-scroll.clientHeight : -1
    };
  })()`);
  assert.ok(geometry.heroHeight <= 235, `${width}: active Mission hero ${geometry.heroHeight}px`);
  assert.ok(geometry.accountTop < geometry.navTop, `${width}: Account impact enters first screen`);
  assert.ok(geometry.recentTop < geometry.navTop, `${width}: Recent completed enters first screen`);
  assert.deepEqual({ overflow: geometry.overflow, promptSupport: geometry.promptSupport, promptNav: geometry.promptNav }, { overflow: 0, promptSupport: 0, promptNav: 0 });
  assert.equal(geometry.promptRecentContent, 0, `${width}: fixed Prompt must not obscure Recent row/content ${JSON.stringify(geometry)}`);
  assert.deepEqual({ recentNav: geometry.recentNav, recentContentNav: geometry.recentContentNav }, { recentNav: 0, recentContentNav: 0 }, `${width}: Recent must clear bottom navigation ${JSON.stringify(geometry)}`);
  assert.equal(geometry.scrollTop, 0, `${width}: Mission opens at the start of the real scroll owner`);
  assert.ok(geometry.scrollRange > 0, `${width}: real Mission scroll owner exposes a vertical safety range ${JSON.stringify(geometry)}`);
  const missionBottomReachability = await evaluate(cdp, `(async()=>{
    const scroll=document.querySelector('.kordynV2MobileBackground > .kordynV2StateBoundary');
    scroll.scrollTop=scroll.scrollHeight;
    await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=(selector)=>document.querySelector(selector)?.getBoundingClientRect();
    const prompt=rect('[data-kordyn-v2-dialog-trigger]');
    const nav=rect('[data-kordyn-v2-mobile-navigation]');
    const viewport=scroll.getBoundingClientRect();
    const last=document.querySelector('[data-kordyn-v2-mobile-mission-registry] > button:last-of-type, [data-kordyn-v2-mobile-recent-completed] > button, [data-kordyn-v2-mobile-recent-completed] > p')?.getBoundingClientRect();
    const safeBottom=Math.min(prompt?.top ?? viewport.bottom,nav?.top ?? viewport.bottom,viewport.bottom);
    return { scrollTop:scroll.scrollTop, maxScroll:scroll.scrollHeight-scroll.clientHeight, lastTop:last?.top, lastBottom:last?.bottom, viewportTop:viewport.top, safeBottom };
  })()`);
  assert.ok(missionBottomReachability.scrollTop > 0 && Math.abs(missionBottomReachability.scrollTop-missionBottomReachability.maxScroll) <= 1, `${width}: real Mission scroll owner reaches its end ${JSON.stringify(missionBottomReachability)}`);
  assert.ok(missionBottomReachability.lastTop >= missionBottomReachability.viewportTop && missionBottomReachability.lastBottom <= missionBottomReachability.safeBottom, `${width}: final Mission content is vertically reachable above Prompt and navigation ${JSON.stringify(missionBottomReachability)}`);
  const missionResetState = await evaluate(cdp, `(async() => {
    const scroll=document.querySelector('.kordynV2MobileBackground > .kordynV2StateBoundary');
    scroll.scrollTop=0;
    let settledFrames=0;
    await new Promise((resolve)=>requestAnimationFrame(()=>{
      settledFrames+=1;
      requestAnimationFrame(()=>{
        settledFrames+=1;
        resolve();
      });
    }));
    const hero=document.querySelector('[data-kordyn-v2-mobile-mission-hero]').getBoundingClientRect();
    const recent=document.querySelector('[data-kordyn-v2-mobile-recent-completed]').getBoundingClientRect();
    return { settledFrames, scrollTop:scroll.scrollTop, heroTop:hero.top, heroBottom:hero.bottom, recentTop:recent.top, recentBottom:recent.bottom };
  })()`);
  assert.equal(missionResetState.settledFrames, 2, `${width}: Mission reset settles through two animation frames ${JSON.stringify(missionResetState)}`);
  assert.equal(missionResetState.scrollTop, 0, `${width}: Mission reset returns the real scroll owner to its start`);
  assert.ok(Math.abs(missionResetState.heroTop-geometry.heroTop) <= 1 && Math.abs(missionResetState.heroBottom-geometry.heroBottom) <= 1, `${width}: Mission hero returns to its initial geometry ${JSON.stringify(missionResetState)}`);
  assert.ok(Math.abs(missionResetState.recentTop-geometry.recentTop) <= 1 && Math.abs(missionResetState.recentBottom-geometry.recentBottom) <= 1, `${width}: Recent returns to its initial visible geometry ${JSON.stringify(missionResetState)}`);
  await capture(cdp, `mobile-mission-${width}x${height}.png`, width, height);

  await navigate(cdp, baseUrl, "/tests/kordyn-v2-ai-actions-browser.html", width, height);
  await waitForExpression(cdp, "window.__task4Ready && document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${width}: approval source Mission`);
  await click(cdp, '[data-kordyn-v2-open-approval="run-sol-approval"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${width}: approval task workspace`);
  const approval = await evaluate(cdp, `(() => {
    const rect=(selector)=>document.querySelector(selector)?.getBoundingClientRect();
    const sheet=rect('[data-kordyn-v2-ai-approval-sheet]');
    const nav=rect('[data-kordyn-v2-mobile-navigation]');
    const actions=rect('[data-kordyn-v2-approval-actions]');
    const scroll=document.querySelector('.kordynV2AiApprovalScroll');
    const progress=document.querySelector('[data-kordyn-v2-approval-mission-progress]');
    const progressRect=progress?.getBoundingClientRect();
    const planGrid=document.querySelector('.kordynV2AiApprovalPlanFacts');
    const impactGrid=document.querySelector('.kordynV2AiApprovalImpact dl');
    const usage=document.querySelector('[data-kordyn-v2-approval-usage]');
    const usageTitle=usage?.querySelector('h2')?.getBoundingClientRect();
    const usageRows=[...(usage?.querySelectorAll('dl > div') || [])].map((row)=>row.getBoundingClientRect());
    const acknowledgement=rect('[data-kordyn-v2-approval-acknowledgement]');
    const selectors=['[data-kordyn-v2-approval-lifecycle]','[data-kordyn-v2-approval-plan]','[data-kordyn-v2-approval-account-impact]','[data-kordyn-v2-approval-risk-checklist]','[data-kordyn-v2-approval-usage]','[data-kordyn-v2-approval-acknowledgement]'];
    const offsets=selectors.map((selector)=>[...scroll.querySelectorAll('*')].indexOf(scroll.querySelector(selector)));
    return { left:sheet?.left, top:sheet?.top, width:sheet?.width, bottom:sheet?.bottom, navTop:nav?.top, actionsTop:actions?.top, actionsBottom:actions?.bottom, radius:getComputedStyle(document.querySelector('[data-kordyn-v2-ai-approval-sheet]')).borderRadius, overflow:sheet?.width-document.querySelector('[data-kordyn-v2-ai-approval-sheet]').scrollWidth, offsets, minTarget:Math.min(...[...document.querySelectorAll('[data-kordyn-v2-ai-approval-sheet] button')].map((button)=>Math.min(button.getBoundingClientRect().width,button.getBoundingClientRect().height))), progressCount:progress?.querySelectorAll('li').length, progressCurrent:progress?.querySelector('[aria-current="step"]')?.dataset.stageId, progressVisible:Boolean(progressRect&&progressRect.top>=scroll.getBoundingClientRect().top&&progressRect.bottom<=actions.top), planColumns:getComputedStyle(planGrid).gridTemplateColumns.split(' ').length, impactColumns:getComputedStyle(impactGrid).gridTemplateColumns.split(' ').length, usageTitleBottom:usageTitle?.bottom, usageRowBottoms:usageRows.map((row)=>row.bottom), acknowledgementTop:acknowledgement?.top };
  })()`);
  assert.ok(approval.left <= 1 && approval.top <= 1 && Math.abs(approval.width - width) <= 1, `${width}: approval owns the APP task workspace`);
  assert.ok(approval.actionsBottom <= approval.navTop + 1, `${width}: sticky decisions clear navigation`);
  assert.equal(approval.radius, "0px");
  assert.deepEqual(approval.offsets, [...approval.offsets].sort((a, b) => a - b));
  assert.ok(approval.offsets.every((offset) => offset >= 0));
  assert.ok(approval.minTarget >= 44, `${width}: approval touch targets`);
  assert.deepEqual([approval.progressCount, approval.progressCurrent, approval.progressVisible], [5, "approval", true], `${width}: real Mission lifecycle hero`);
  assert.equal(approval.planColumns, 3, `${width}: plan is three columns by two rows`);
  assert.equal(approval.impactColumns, 4, `${width}: Account impact is one four-column row`);
  if (width === 430) {
    assert.ok(approval.usageRowBottoms.length === 4 && approval.usageRowBottoms.every((bottom) => bottom <= approval.actionsTop), `${width}: full evidence registry is visible`);
    assert.ok(approval.acknowledgementTop < approval.actionsTop, `${width}: acknowledgement starts in the viewport`);
  } else {
    assert.ok(approval.usageTitleBottom <= approval.actionsTop && approval.usageRowBottoms[0] <= approval.actionsTop, `${width}: evidence title and first row enter viewport`);
  }
  const bottomReachability = await evaluate(cdp, `(() => { const scroll=document.querySelector('.kordynV2AiApprovalScroll'); const actions=document.querySelector('[data-kordyn-v2-approval-actions]').getBoundingClientRect(); scroll.scrollTop=scroll.scrollHeight; const last=document.querySelector('[data-kordyn-v2-approval-acknowledgement]').getBoundingClientRect(); return {atBottom:Math.abs(scroll.scrollTop-(scroll.scrollHeight-scroll.clientHeight))<=1,lastTop:last.top,lastBottom:last.bottom,actionsTop:actions.top}; })()`);
  assert.ok(bottomReachability.atBottom && bottomReachability.lastTop >= 0 && bottomReachability.lastBottom <= bottomReachability.actionsTop, `${width}: all content is reachable above sticky actions`);
  const resetState = await evaluate(cdp, `(async()=>{ const scroll=document.querySelector('.kordynV2AiApprovalScroll'); scroll.scrollTop=0; await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const lifecycle=document.querySelector('[data-kordyn-v2-approval-lifecycle]').getBoundingClientRect(); const viewport=scroll.getBoundingClientRect(); return {scrollTop:scroll.scrollTop,lifecycleTop:lifecycle.top,viewportTop:viewport.top}; })()`);
  assert.equal(resetState.scrollTop, 0, `${width}: approval evidence resets to initial reading position`);
  assert.ok(resetState.lifecycleTop >= resetState.viewportTop - 1, `${width}: lifecycle hero is visible after reset`);
  await capture(cdp, `mobile-approval-${width}x${height}.png`, width, height);
  return { width, height, geometry, bottom: missionBottomReachability, reset: missionResetState };
}

async function verifyDesktopSignals(cdp, baseUrl, width, height) {
  await navigate(cdp, baseUrl, "/tests/kordyn-v2-shell-browser.html", width, height);
  await waitForExpression(cdp, "window.__kordynV2ShellReady && document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${width}: desktop Mission`);
  await click(cdp, '[data-kordyn-v2-workspace-target="intelligence"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/intelligence\"] [data-kordyn-v2-signal-summary]')", `${width}: Signals summary`);
  const material = await evaluate(cdp, `(() => ({
    filterGroups:[...document.querySelectorAll('[data-kordyn-v2-signal-filter-group]')].map((node)=>node.dataset.kordynV2SignalFilterGroup),
    operationGroups:[...document.querySelectorAll('[data-kordyn-v2-signal-operation]')].map((node)=>node.dataset.kordynV2SignalOperation),
    denseRows:document.querySelectorAll('[data-kordyn-v2-signal-row-meta]').length
  }))()`);
  assert.deepEqual(material.filterGroups, ["category", "time", "availability"], `${width}: Signals exposes three real local filter groups`);
  assert.deepEqual(material.operationGroups, ["watch", "event", "intelligence"], `${width}: Signals exposes three interactive operating registries`);
  assert.ok(material.denseRows > 0, `${width}: Signals registry carries real source/time/type/selectability metadata`);
  for (const [operation, type, id] of [["watch", "Watch", "watch-eth-retest"], ["event", "Event", "event-fomc-date"]]) {
    await click(cdp, `[data-kordyn-v2-signal-operation="${operation}"] button[data-kordyn-v2-object-id="${id}"][data-kordyn-v2-object-type="${type}"]`);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2SelectedId === ${JSON.stringify(id)}`, `${width}: ${operation} lower registry selects canonical ${type}`);
    for (const panel of ["context", "proof"]) {
      await click(cdp, `[data-kordyn-v2-${panel}-trigger]`);
      await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-overlay="${panel}"]')`, `${width}: ${operation} ${panel} opens`);
      const identity = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-overlay="${panel}"] .kordynV2OverlayIdentity')?.textContent?.trim()`);
      assert.match(identity, new RegExp(`${type} / ${id}`), `${width}: ${operation} ${panel} uses Root canonical identity`);
      await click(cdp, `[data-kordyn-v2-overlay="${panel}"] [data-kordyn-v2-overlay-close]`);
      await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-overlay="${panel}"]')`, `${width}: ${operation} ${panel} closes`);
    }
  }
  const selectedBeforeReadonlyOverview = await evaluate(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="desktop"]'); return { id:root?.dataset.kordynV2SelectedId, type:root?.dataset.kordynV2SelectedType }; })()`);
  const readonlyOverview = '[data-kordyn-v2-signal-operation="intelligence"] button[data-kordyn-v2-readonly-fact="true"]';
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(readonlyOverview)})?.getAttribute('aria-disabled')`), null, `${width}: inspectable readonly intelligence is not announced as disabled`);
  await click(cdp, readonlyOverview);
  await waitForExpression(cdp, `document.querySelector('.kordynV2AiContextInspector h2')?.textContent?.includes('未识别来源事实')`, `${width}: readonly intelligence overview remains locally inspectable`);
  assert.deepEqual(await evaluate(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="desktop"]'); return { id:root?.dataset.kordynV2SelectedId, type:root?.dataset.kordynV2SelectedType }; })()`), selectedBeforeReadonlyOverview, `${width}: readonly intelligence overview fails canonical selection closed`);
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(readonlyOverview)})?.dataset.kordynV2ObjectId)`), false, `${width}: readonly intelligence overview exposes no partial canonical identity`);
  const selectableSignal = '[data-kordyn-v2-signal-operation="intelligence"] button[data-kordyn-v2-object-id="signal-cpi-flow"][data-kordyn-v2-object-type="Signal"]';
  const clickedType = await evaluate(cdp, `document.querySelector(${JSON.stringify(selectableSignal)})?.dataset.kordynV2ObjectType`);
  await click(cdp, selectableSignal);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-selected-context="signal-cpi-flow"]')`, `${width}: selectable lower Intelligence synchronizes the Inspector after readonly inspection`);
  const selectedSignalIdentity = await evaluate(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="desktop"]'); const inspector=document.querySelector('[data-kordyn-v2-selected-context="signal-cpi-flow"]'); return { clickedType:${JSON.stringify(clickedType)}, inspectorId:inspector?.dataset.kordynV2SelectedContext, rootId:root?.dataset.kordynV2SelectedId, rootType:root?.dataset.kordynV2SelectedType }; })()`);
  assert.deepEqual(selectedSignalIdentity, { clickedType:"Signal", inspectorId:"signal-cpi-flow", rootId:"signal-cpi-flow", rootType:"Signal" }, `${width}: clicked row, Inspector, and Root share one Signal identity`);
  for (const panel of ["context", "proof"]) {
    await click(cdp, `[data-kordyn-v2-${panel}-trigger]`);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-overlay="${panel}"]')`, `${width}: lower Intelligence ${panel} opens`);
    const identity = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-overlay="${panel}"] .kordynV2OverlayIdentity')?.textContent?.trim()`);
    assert.match(identity, /Signal \/ signal-cpi-flow/, `${width}: lower Intelligence ${panel} matches Inspector and Root identity`);
    await click(cdp, `[data-kordyn-v2-overlay="${panel}"] [data-kordyn-v2-overlay-close]`);
    await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-overlay="${panel}"]')`, `${width}: lower Intelligence ${panel} closes`);
  }
  const before = await evaluate(cdp, "document.querySelectorAll('.kordynV2AiContextRegistry [data-kordyn-v2-object-id]').length");
  await click(cdp, '[data-kordyn-v2-signal-filter="event"]');
  const after = await evaluate(cdp, "document.querySelectorAll('.kordynV2AiContextRegistry [data-kordyn-v2-object-id]').length");
  assert.ok(after > 0 && after < before, `${width}: real category filter changes loaded registry ${before}→${after}`);
  const geometry = await evaluate(cdp, `(() => {
    const rect=(selector)=>document.querySelector(selector)?.getBoundingClientRect();
    const summary=rect('[data-kordyn-v2-signal-summary]');
    const workbench=rect('.kordynV2AiSignalWorkbench');
    const relation=rect('[data-kordyn-v2-relationship-lens="signal-decision-flow"]');
    const lower=rect('[data-kordyn-v2-signal-operational-context]');
    const prompt=rect('.kordynV2AiContextPrompt');
    const filter=document.querySelector('.kordynV2AiContextFilter');
    const filterLast=filter?.querySelector('[data-kordyn-v2-signal-availability="readonly"]')?.getBoundingClientRect();
    const inspector=document.querySelector('.kordynV2AiContextInspector');
    const description=inspector?.querySelector(':scope > section')?.getBoundingClientRect();
    const inspectorFooter=inspector?.querySelector(':scope > footer')?.getBoundingClientRect();
    const columns=[...document.querySelector('.kordynV2AiSignalWorkbench').children].map((node)=>node.getBoundingClientRect().width);
    return { summaryBottom:summary?.bottom, workbenchTop:workbench?.top, workbenchBottom:workbench?.bottom, relationTop:relation?.top, relationBottom:relation?.bottom, lowerTop:lower?.top, lowerBottom:lower?.bottom, promptTop:prompt?.top, columns, overflow:document.documentElement.scrollWidth-innerWidth, filterLastBottom:filterLast?.bottom, filterViewportBottom:filter?.getBoundingClientRect().bottom, inspectorDescriptionBottom:description?.bottom, inspectorFooterTop:inspectorFooter?.top };
  })()`);
  assert.ok(geometry.summaryBottom <= geometry.workbenchTop + 1);
  assert.ok(geometry.workbenchBottom <= geometry.relationTop + 1);
  assert.ok(geometry.relationBottom <= geometry.lowerTop + 1);
  assert.ok(geometry.lowerBottom <= geometry.promptTop + 1);
  assert.ok(geometry.columns.length === 3 && geometry.columns.every((value) => value >= 120));
  assert.equal(geometry.overflow, 0);
  assert.ok(geometry.filterLastBottom <= geometry.filterViewportBottom + 1, `${width}: all three local filter groups are initially visible ${JSON.stringify(geometry)}`);
  assert.ok(geometry.inspectorDescriptionBottom <= geometry.inspectorFooterTop + 1, `${width}: evidence description clears Inspector actions ${JSON.stringify(geometry)}`);
  await capture(cdp, `desktop-signals-${width}x${height}.png`, width, height);
  return geometry;
}

async function verifyDesktopMissionCommand(cdp, baseUrl, width, height) {
  await navigate(cdp, baseUrl, "/tests/kordyn-v2-ai-actions-browser.html", width, height);
  await waitForExpression(cdp, "window.__task4Ready && document.querySelector('[data-kordyn-v2-mission-command-bar]')", `${width}: Mission command bar`);
  const material = await evaluate(cdp, `(() => ({
    groups:[...document.querySelectorAll('[data-mission-group]')].map((node)=>node.dataset.missionGroup),
    lifecycle:Boolean(document.querySelector('[data-kordyn-v2-mission-lifecycle]')),
    decision:Boolean(document.querySelector('[data-kordyn-v2-mission-decision-summary]')),
    related:Boolean(document.querySelector('[data-kordyn-v2-mission-related-context]')),
    receipt:Boolean(document.querySelector('[data-kordyn-v2-mission-receipt]'))
  }))()`);
  assert.deepEqual(material.groups.slice(0, 5), ["analysis", "monitoring", "approval", "executing", "completed"], `${width}: Mission queue is organized by the five product stages`);
  assert.deepEqual({ lifecycle:material.lifecycle, decision:material.decision, related:material.related, receipt:material.receipt }, { lifecycle:true, decision:true, related:true, receipt:true }, `${width}: Mission inspector carries lifecycle, decision, Context/Proof and runtime receipt`);
  const geometry = await evaluate(cdp, `(() => { const work=document.querySelector('.kordynV2AiMissionWorkbench').getBoundingClientRect(); const command=document.querySelector('[data-kordyn-v2-mission-command-bar]').getBoundingClientRect(); const support=document.querySelector('[data-kordyn-v2-ai-support-trigger]').getBoundingClientRect(); const overlap=Math.max(0,Math.min(command.right,support.right)-Math.max(command.left,support.left))*Math.max(0,Math.min(command.bottom,support.bottom)-Math.max(command.top,support.top)); return {workBottom:work.bottom,workWidth:work.width,commandTop:command.top,commandBottom:command.bottom,commandHeight:command.height,commandLeftInset:command.left-work.left,commandRight:command.right,supportLeft:support.left,width:command.width,supportOverlap:overlap,overflow:document.documentElement.scrollWidth-innerWidth}; })()`);
  assert.ok(geometry.workBottom <= geometry.commandTop + 1);
  const expectedInset = width === 1180 ? 46 : 70;
  const expectedWidth = geometry.workWidth - (width === 1180 ? 310 : 356);
  const expectedWorkBottom = width === 1180 ? 690 : 776;
  assert.ok(Math.abs(geometry.workBottom - expectedWorkBottom) <= 1, `${width}: Mission workbench preserves the approved footer breathing space ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.commandLeftInset - expectedInset) <= 1, `${width}: Mission command follows the approved left content axis ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.width - expectedWidth) <= 1, `${width}: Mission command preserves the approved long operating span ${JSON.stringify(geometry)}`);
  if (width === 1440) {
    assert.ok(geometry.commandTop >= 796 && geometry.commandTop <= 802 && geometry.commandHeight >= 70, `1440: Mission command aligns with the approved workbench footer ${JSON.stringify(geometry)}`);
  }
  assert.equal(geometry.supportOverlap, 0, `${width}: centered Mission command bar clears AI support ${JSON.stringify(geometry)}`);
  assert.equal(geometry.overflow, 0);
  const missionId = await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mission-inspector]')?.dataset.kordynV2SelectedMission");
  for (const [panel, selector] of [["context", `[data-kordyn-v2-mission-context="${missionId}"]`], ["proof", `[data-kordyn-v2-mission-proof="${missionId}"]`]]) {
    await click(cdp, selector);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-overlay="${panel}"]')`, `${width}: Mission ${panel} opens from its real action`);
    const identity = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-overlay="${panel}"] .kordynV2OverlayIdentity')?.textContent?.trim()`);
    assert.match(identity, new RegExp(`Agent run / ${missionId}`), `${width}: Mission ${panel} keeps the selected identity`);
    await click(cdp, `[data-kordyn-v2-overlay="${panel}"] [data-kordyn-v2-overlay-close]`);
    await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-overlay="${panel}"]')`, `${width}: Mission ${panel} closes`);
  }
  let materialGeometry = null;
  if (width === 1180) {
    materialGeometry = await evaluate(cdp, `(() => {
      const visible=(node, viewport)=>{ const rect=node?.getBoundingClientRect(); return Boolean(rect && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1); };
      const decision=document.querySelector('[data-kordyn-v2-mission-decision-summary]');
      const decisionViewport=decision?.getBoundingClientRect();
      const decisionFacts=[...decision.querySelectorAll('dt')].map((node)=>({ label:node.textContent.trim(), visible:visible(node.parentElement, decisionViewport), bottom:node.parentElement.getBoundingClientRect().bottom }));
      const context=document.querySelector('section[data-kordyn-v2-mission-related-context]');
      const contextViewport=context?.getBoundingClientRect();
      const contextFacts=[...context.querySelectorAll('dt')].map((node)=>({ label:node.textContent.trim(), visible:visible(node.parentElement, contextViewport), bottom:node.parentElement.getBoundingClientRect().bottom }));
      const receipt=document.querySelector('[data-kordyn-v2-mission-receipt]');
      const receiptViewport=receipt?.getBoundingClientRect();
      const receiptFacts=[...receipt.querySelectorAll('dt')].map((node)=>({ label:node.textContent.trim(), visible:visible(node.parentElement, receiptViewport), bottom:node.parentElement.getBoundingClientRect().bottom }));
      const footer=document.querySelector('.kordynV2AiMissionInspectorFooter');
      const footerButtons=[...footer.querySelectorAll('button[data-kordyn-v2-mission-context],button[data-kordyn-v2-mission-proof]')].map((node)=>({ kind:node.dataset.kordynV2MissionContext ? 'context' : 'proof', left:node.getBoundingClientRect().left, right:node.getBoundingClientRect().right }));
      return { decisionBottom:decisionViewport.bottom, decisionFacts, contextBottom:contextViewport.bottom, contextFacts, receiptBottom:receiptViewport.bottom, receiptFacts, footerButtons, duplicateEvidenceReceipt:Boolean(footer.querySelector('[data-kordyn-v2-mission-evidence-receipt]')) };
    })()`);
    const visibleLabels=(rows)=>rows.filter((row)=>row.visible).map((row)=>row.label);
    assert.deepEqual(visibleLabels(materialGeometry.decisionFacts), ['Strategy', 'Knowledge', 'Capability', 'Event', 'Position'], `1180: five core decision facts remain visible ${JSON.stringify(materialGeometry)}`);
    assert.deepEqual(materialGeometry.footerButtons.map((row)=>row.kind), ['context', 'proof'], `1180: footer keeps only the two real evidence actions ${JSON.stringify(materialGeometry)}`);
    assert.equal(materialGeometry.duplicateEvidenceReceipt, false, `1180: footer does not repeat Context evidence or the hero next step ${JSON.stringify(materialGeometry)}`);
    assert.deepEqual(visibleLabels(materialGeometry.contextFacts), ['Strategy', 'Knowledge', 'Capability', 'Event', 'Position', 'Evidence'], `1180: complete related Context remains visible ${JSON.stringify(materialGeometry)}`);
    assert.deepEqual(visibleLabels(materialGeometry.receiptFacts), ['创建', '更新', '完成', '状态', 'Proof'], `1180: runtime receipt facts remain visible ${JSON.stringify(materialGeometry)}`);
  }
  return { geometry, materialGeometry };
}

const vitePort = await freePort();
const chromePort = await freePort();
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-ai-visual-fix-"));
await mkdir(outputDir, { recursive: true });
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, ["--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: "ignore" });

try {
  await waitFor(`http://127.0.0.1:${vitePort}/tests/kordyn-v2-ai-actions-browser.html`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  const target = targets.find((row) => row.type === "page");
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  const mobileMission = [];
  for (const viewport of [[390, 844], [430, 932]]) mobileMission.push(await verifyMobileMission(cdp, baseUrl, ...viewport));
  const desktopSignals = [];
  const desktopMission = [];
  for (const viewport of [[1440, 900], [1180, 800]]) {
    desktopMission.push({ width: viewport[0], ...(await verifyDesktopMissionCommand(cdp, baseUrl, ...viewport)) });
    desktopSignals.push({ width: viewport[0], geometry: await verifyDesktopSignals(cdp, baseUrl, ...viewport) });
  }
  cdp.close();
  console.log(`KORDYN V2 AI visual regression browser PASS captures=6 mobile=${JSON.stringify(mobileMission)} desktopMission=${JSON.stringify(desktopMission)} desktopSignals=${JSON.stringify(desktopSignals)} output=${outputDir}`);
} finally {
  chrome.kill("SIGTERM");
  vite.kill("SIGTERM");
  await Promise.allSettled([new Promise((resolve) => chrome.once("exit", resolve)), new Promise((resolve) => vite.once("exit", resolve))]);
  await rm(userDataDir, { recursive: true, force: true });
}
