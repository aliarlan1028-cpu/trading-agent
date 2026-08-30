import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputDir = path.resolve(process.env.KORDYN_V2_TASK4_SCREENSHOT_DIR || "/private/tmp/kordyn-v2-task4");
const pngOnly = process.env.KORDYN_V2_FINAL_FIX_PNG_ONLY === "1";
const pagePath = "/tests/kordyn-v2-ai-actions-browser.html";
const viewports = [
  { width: 1440, height: 900, device: "desktop", outcome: "success", translationFails: false },
  { width: 1180, height: 820, device: "desktop", outcome: "failure", translationFails: true },
  { width: 390, height: 844, device: "mobile", outcome: "partial", translationFails: false },
  { width: 430, height: 932, device: "mobile", outcome: "success", translationFails: true }
];

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

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
  let requestId = 0;
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
      const id = ++requestId;
      return await new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => { const target=document.querySelector(${JSON.stringify(selector)}); if(!target)return null; target.scrollIntoView({block:'center',inline:'nearest'}); const r=target.getBoundingClientRect(); const x=r.left+r.width/2; const y=r.top+r.height/2; const hit=document.elementFromPoint(x,y); return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&(hit===target||target.contains(hit))?{x,y}:null; })()`);
  assert.ok(point, `visible click target: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function press(cdp, key, modifiers = 0) {
  const code = key === "Tab" ? "Tab" : key === "Escape" ? "Escape" : key;
  const keyCode = key === "Tab" ? 9 : key === "Escape" ? 27 : key.charCodeAt(0);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
}

async function typeInto(cdp, selector, value) {
  await click(cdp, selector);
  await cdp.send("Input.insertText", { text: value });
}

async function capture(cdp, filename, width, height) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height]);
  const target = path.join(outputDir, filename);
  await writeFile(target, bytes);
  return target;
}

async function verifyViewport(cdp, baseUrl, viewport) {
  const { width, height, device, outcome, translationFails } = viewport;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?viewport=${width}` });
  await waitForExpression(cdp, "window.__task4Ready && document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${width}: Mission ready`);

  const baseGeometry = await evaluate(cdp, `(() => { const rect=s=>document.querySelector(s)?.getBoundingClientRect(); const overlap=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)):0; const prompt=rect('[data-kordyn-v2-dialog-trigger]'); const support=rect('[data-kordyn-v2-ai-support-trigger]'); const nav=rect('[data-kordyn-v2-mobile-navigation]'); return {overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),promptSupport:overlap(prompt,support),promptNav:overlap(prompt,nav)}; })()`);
  assert.deepEqual(baseGeometry, { overflow: 0, promptSupport: 0, promptNav: 0 }, `${width}: base support/nav clearance`);

  const approvalTrigger = "[data-kordyn-v2-open-approval=\"run-sol-approval\"]";
  await click(cdp, approvalTrigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${width}: approval opens`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')?.contains(document.activeElement)", `${width}: approval owns focus`);
  const approval = await evaluate(cdp, `(() => { const sheet=document.querySelector('[data-kordyn-v2-ai-approval-sheet]'); const primary=sheet.querySelector('[data-kordyn-v2-approval-primary]'); const nav=document.querySelector('[data-kordyn-v2-mobile-navigation]'); const action=sheet.querySelector('.kordynV2AiApprovalActions'); const ar=action.getBoundingClientRect(); const nr=nav?.getBoundingClientRect(); return {valid:!primary.disabled,text:sheet.textContent,focused:sheet.contains(document.activeElement),overflow:Math.max(0,sheet.scrollWidth-sheet.clientWidth),clearance:nr?nr.top-ar.bottom:null,minTarget:Math.min(...[...sheet.querySelectorAll('button')].map(x=>Math.min(x.getBoundingClientRect().width,x.getBoundingClientRect().height)))}; })()`);
  assert.equal(approval.valid, true, `${width}: valid production approval enables primary`);
  assert.match(approval.text, /12\/12 通过/);
  assert.match(approval.text, /28,?640\.72|28640\.72/);
  assert.equal(approval.focused, true);
  assert.equal(approval.overflow, 0);
  assert.ok(approval.minTarget >= 44, `${width}: approval controls are touch sized`);
  if (device === "mobile") assert.ok(approval.clearance >= -0.5, `${width}: protected action clears bottom nav by ${approval.clearance}`);
  await capture(cdp, `${width}x${height}-approval-ready.png`, width, height);

  await evaluate(cdp, `window.__task4ApprovalMode=${JSON.stringify(outcome)}`);
  await click(cdp, "[data-kordyn-v2-approval-primary]");
  await waitForExpression(cdp, "document.querySelector('.cfmCard')", `${width}: protected confirmation`);
  await click(cdp, ".cfmOk");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-approval-outcome=\"processing\"]')", `${width}: approval processing`);
  if (width === 1440) await capture(cdp, `${width}x${height}-approval-pending.png`, width, height);
  const expectedState = outcome === "success" ? "succeeded" : outcome === "partial" ? "partial" : "failed";
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-approval-outcome=${JSON.stringify(expectedState)}]')`, `${width}: ${expectedState} outcome`);
  const outcomeText = await evaluate(cdp, "document.querySelector('[data-kordyn-v2-approval-outcome]').textContent");
  if (expectedState === "succeeded") assert.match(outcomeText, /入场单已提交/);
  if (expectedState === "partial") assert.match(outcomeText, /订单未提交/);
  if (expectedState === "failed") {
    assert.match(outcomeText, /风控复核未通过/);
    assert.match(outcomeText, /检查风险边界后重新生成计划/);
    assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-approval-code]')?.textContent"), "risk_blocked");
  }
  const outcomeGeometry = await evaluate(cdp, `(() => { const outcome=document.querySelector('[data-kordyn-v2-approval-outcome]')?.getBoundingClientRect(); return {top:outcome?.top,bottom:outcome?.bottom,visible:Boolean(outcome&&outcome.top>=0&&outcome.bottom<=innerHeight)}; })()`);
  assert.equal(outcomeGeometry.visible, true, `${width}: authoritative ${expectedState} outcome is visible without scrolling`);
  await capture(cdp, `${width}x${height}-approval-${expectedState}.png`, width, height);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${width}: approval closes`);
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(approvalTrigger)})`), true, `${width}: approval returns focus`);
  if (["succeeded", "partial"].includes(expectedState)) {
    const approvalWrites = await evaluate(cdp, "window.__task4Calls.actionRequests.filter((row)=>row.endpoint.includes('/trade-plans/')&&row.method==='POST').length");
    await click(cdp, approvalTrigger);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-approval-outcome=${JSON.stringify(expectedState)}]')`, `${width}: terminal approval reopens`);
    const terminalDisabled = await evaluate(cdp, "[...document.querySelectorAll('.kordynV2AiApprovalActions > button')].every((button)=>button.disabled)");
    assert.equal(terminalDisabled, true, `${width}: terminal approval is one-shot`);
    await evaluate(cdp, "document.querySelector('[data-kordyn-v2-approval-primary]').click(); document.querySelector('.kordynV2AiApprovalActions > button').click()");
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await evaluate(cdp, "window.__task4Calls.actionRequests.filter((row)=>row.endpoint.includes('/trade-plans/')&&row.method==='POST').length"), approvalWrites, `${width}: terminal reopen cannot duplicate request`);
    await press(cdp, "Escape");
    await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${width}: terminal approval closes`);
  }

  const outputTrigger = "[data-kordyn-v2-open-output=\"run-sol-approval\"]";
  await click(cdp, outputTrigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-output-sheet]')", `${width}: output opens`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-output-sheet]')?.contains(document.activeElement)", `${width}: output owns focus`);
  assert.doesNotMatch(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-poster-canvas]').textContent"), /###/);
  await evaluate(cdp, `window.__task4TranslationFails=${translationFails}`);
  await click(cdp, ".kordynV2AiOutputToolbar button:nth-child(2)");
  if (translationFails) {
    await waitForExpression(cdp, "document.querySelector('.kordynV2AiOutputState[data-output-state=\"failed\"]')", `${width}: translation failure`);
    assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-poster-canvas]').dataset.language"), "zh");
    const translationFailureText = await evaluate(cdp, "document.querySelector('.kordynV2AiOutputState').textContent");
    assert.match(translationFailureText, /英文翻译暂时不可用.*保留中文原稿/);
    assert.doesNotMatch(translationFailureText, /translation_unavailable/);
  } else {
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-poster-canvas][data-language=\"en\"]')", `${width}: English output`);
    const beforeDownloads = await evaluate(cdp, "window.__task4Calls.downloads.length");
    await click(cdp, "[data-kordyn-v2-output-png]");
    await waitForExpression(cdp, `window.__task4Calls.downloads.length>${beforeDownloads}`, `${width}: PNG downloaded`, 30_000);
    const download = await evaluate(cdp, "window.__task4Calls.downloads.at(-1)");
    assert.match(download.prefix, /^data:image\/png/);
    assert.match(download.filename, /\.png$/);
  }
  const outputGeometry = await evaluate(cdp, `(() => { const sheet=document.querySelector('[data-kordyn-v2-ai-output-sheet]'); return {overflow:Math.max(0,sheet.scrollWidth-sheet.clientWidth),focused:sheet.contains(document.activeElement),minTarget:Math.min(...[...sheet.querySelectorAll('button')].map(x=>Math.min(x.getBoundingClientRect().width,x.getBoundingClientRect().height)))}; })()`);
  assert.equal(outputGeometry.overflow, 0);
  assert.equal(outputGeometry.focused, true);
  assert.ok(outputGeometry.minTarget >= 44, `${width}: output controls are touch sized`);
  await capture(cdp, `${width}x${height}-output-${translationFails ? "failed" : "english"}.png`, width, height);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-output-sheet]')", `${width}: output closes`);
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(outputTrigger)})`), true, `${width}: output returns focus`);

  const dialogTrigger = "[data-kordyn-v2-dialog-trigger]";
  await click(cdp, dialogTrigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]') && window.__task4Calls.chatReadResults>0 && document.querySelector('[data-dialog-state=\"ready\"]')", `${width}: real dialog read`);
  const initialMessages = await evaluate(cdp, "document.querySelectorAll('[data-kordyn-v2-message-id]').length");
  await typeInto(cdp, "#kordyn-v2-ai-dialog-input", "复核 SOL 风险边界");
  await waitForExpression(cdp, "document.querySelector('#kordyn-v2-ai-dialog-input').value.includes('复核 SOL 风险边界')", `${width}: dialog input accepted`);
  assert.equal(await evaluate(cdp, "document.querySelector('.kordynV2AiDialogComposer > button').disabled"), false, `${width}: dialog send enabled`);
  await click(cdp, ".kordynV2AiDialogComposer > button");
  await waitForExpression(cdp, "document.querySelector('[data-dialog-state=\"processing\"]')", `${width}: dialog processing`);
  assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-kordyn-v2-message-id]').length"), initialMessages, `${width}: no optimistic message`);
  await waitForExpression(cdp, "window.__task4Calls.chatWrites>0", `${width}: dialog POST issued`);
  await waitForExpression(cdp, "window.__task4Calls.chatReads>1", `${width}: authoritative dialog GET reread`);
  await waitForExpression(cdp, `document.querySelectorAll('[data-kordyn-v2-message-id]').length>${initialMessages} && document.querySelector('.kordynV2AiDialogMessages')?.textContent.includes('继续等待风险边界')`, `${width}: authoritative dialog reply rendered`);
  await capture(cdp, `${width}x${height}-dialog.png`, width, height);
  const dialogState = await evaluate(cdp, `(() => { const dialog=document.querySelector('[data-kordyn-v2-dialog-surface]'); const rect=s=>document.querySelector(s)?.getBoundingClientRect(); const overlap=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)):0; const send=rect('.kordynV2AiDialogComposer > button'); const support=rect('[data-kordyn-v2-ai-support-trigger]'); const nav=rect('[data-kordyn-v2-mobile-navigation]'); return {layout:dialog.dataset.kordynV2Layout,focused:dialog.contains(document.activeElement),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),minTarget:Math.min(...[...dialog.querySelectorAll('button')].map(x=>Math.min(x.getBoundingClientRect().width,x.getBoundingClientRect().height))),sendSupport:overlap(send,support),sendNav:overlap(send,nav)}; })()`);
  assert.equal(dialogState.layout, device === "mobile" ? "dialog-full-screen" : "dialog-workspace");
  assert.equal(dialogState.focused, true);
  assert.equal(dialogState.overflow, 0);
  assert.equal(dialogState.sendSupport, 0, `${width}: dialog send clears AI support trigger`);
  assert.equal(dialogState.sendNav, 0, `${width}: dialog send clears mobile navigation`);
  if (device === "mobile") assert.ok(dialogState.minTarget >= 44, `${width}: dialog controls are touch sized`);
  await press(cdp, "Tab", 8);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]').contains(document.activeElement)"), true, `${width}: dialog focus trap`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${width}: dialog Escape return`);
  await waitForExpression(cdp, `document.activeElement?.matches(${JSON.stringify(dialogTrigger)})`, `${width}: dialog return focus`);
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(dialogTrigger)})`), true, `${width}: dialog returns focus`);

  return { width, height, device, outcome: expectedState, translation: translationFails ? "failed" : "english", screenshots: 4 + (width === 1440 ? 1 : 0) };
}

async function verifyActionsDisabledStates(cdp, baseUrl) {
  const states = ["stale", "degraded", "failed", "forbidden", "disabled"];
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
  for (const state of states) {
    await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?state=${state}` });
    await waitForExpression(cdp, `window.__task4Ready && document.querySelector('[data-kordyn-v2-state=${JSON.stringify(state)}]')`, `${state}: real Root state`);
    const beforePosts = await evaluate(cdp, "window.__task4Calls.actionRequests.filter((row)=>row.method==='POST').length");
    if (["stale", "degraded"].includes(state)) {
      assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-open-approval]').disabled"), true, `${state}: Mission approval disabled`);
      assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-open-output]').disabled"), true, `${state}: Mission output disabled`);
      await evaluate(cdp, "document.querySelector('[data-kordyn-v2-open-approval]').click(); document.querySelector('[data-kordyn-v2-open-output]').click()");
      await click(cdp, "[data-kordyn-v2-dialog-trigger]");
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]') && window.__task4Calls.chatReadResults>0", `${state}: read-only dialog`);
      assert.equal(await evaluate(cdp, "document.querySelector('#kordyn-v2-ai-dialog-input').disabled"), true, `${state}: chat input disabled`);
      assert.equal(await evaluate(cdp, "document.querySelector('.kordynV2AiDialogComposer > button').disabled"), true, `${state}: chat POST disabled`);
      await evaluate(cdp, "document.querySelector('.kordynV2AiDialogComposer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); document.querySelector('.kordynV2AiDialogComposer > button').click()");
    } else {
      assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-dialog-trigger], [data-kordyn-v2-open-approval], [data-kordyn-v2-open-output]')"), null, `${state}: unavailable Root hides action controls`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await evaluate(cdp, "window.__task4Calls.actionRequests.filter((row)=>row.method==='POST').length"), beforePosts, `${state}: forced activation issues no POST`);
  }
  return states;
}

async function verifyMalformedPng(cdp) {
  const downloads = await evaluate(cdp, "window.__task4Calls.downloads.length");
  assert.equal(await evaluate(cdp, "window.__task4MalformedPng()"), "poster_png_invalid", "browser PNG validator rejects malformed MIME data URL");
  assert.equal(await evaluate(cdp, "window.__task4Calls.downloads.length"), downloads, "malformed PNG cannot reach download adapter");
}

async function verifyPngFailureRecovery(cdp, baseUrl) {
  const diagnostic = "canvas failed: sk_live_secret_final_fix_123";
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?viewport=1440` });
  await waitForExpression(cdp, "window.__task4Ready && document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", "PNG failure Mission ready");
  await click(cdp, '[data-kordyn-v2-open-output="run-sol-approval"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-output-sheet]')?.contains(document.activeElement)", "PNG failure output owns focus");
  const beforeDownloads = await evaluate(cdp, "window.__task4Calls.downloads.length");
  await evaluate(cdp, `(() => {
    window.__task4OriginalCanvasToDataURL=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=()=>{ throw new Error(${JSON.stringify(diagnostic)}); };
  })()`);
  await click(cdp, "[data-kordyn-v2-output-png]");
  await waitForExpression(cdp, "document.querySelector('.kordynV2AiOutputState[data-output-state=\"failed\"]')", "PNG generation failure is rendered");
  const failed = await evaluate(cdp, `(() => {
    const sheet=document.querySelector('[data-kordyn-v2-ai-output-sheet]');
    const state=sheet.querySelector('.kordynV2AiOutputState');
    const retry=sheet.querySelector('[data-kordyn-v2-output-png]');
    return { state:state?.textContent?.trim(), sheet:sheet.textContent, body:document.body.textContent, retryDisabled:retry?.disabled, focused:sheet.contains(document.activeElement), downloads:window.__task4Calls.downloads.length };
  })()`);
  assert.equal(failed.state, "PNG 生成暂时失败，未开始下载。请重试。", "rejected PNG generation renders stable product-language recovery");
  assert.doesNotMatch(failed.sheet, /sk_live_secret|canvas failed/i, "raw PNG diagnostic is absent from the output sheet DOM");
  assert.doesNotMatch(failed.body, /sk_live_secret|canvas failed/i, "raw PNG diagnostic is absent from the page DOM");
  assert.equal(failed.downloads, beforeDownloads, "rejected PNG generation remains download fail-closed");
  assert.equal(failed.retryDisabled, false, "PNG retry remains usable after failure");
  assert.equal(failed.focused, true, "PNG failure keeps focus in the output dialog");

  await evaluate(cdp, "HTMLCanvasElement.prototype.toDataURL=window.__task4OriginalCanvasToDataURL");
  await click(cdp, "[data-kordyn-v2-output-png]");
  await waitForExpression(cdp, `window.__task4Calls.downloads.length>${beforeDownloads}`, "PNG retry downloads only after successful generation", 30_000);
  assert.equal(await evaluate(cdp, "document.querySelector('.kordynV2AiOutputState')?.dataset.outputState"), "succeeded", "retry reports success only after a real download");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-task4-chrome-"));
  const vitePort = await freePort();
  const cdpPort = await freePort();
  const vite = spawn(process.execPath, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: rootDir, stdio: "ignore" });
  const chrome = spawn(chromeBinary, ["--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    await waitFor(`http://127.0.0.1:${vitePort}${pagePath}`);
    const pages = await waitFor(`http://127.0.0.1:${cdpPort}/json`, (rows) => rows.some((row) => row.type === "page"));
    cdp = connectCdp(pages.find((row) => row.type === "page").webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    const results = [];
    if (!pngOnly) for (const viewport of viewports) results.push(await verifyViewport(cdp, baseUrl, viewport));
    const disabledStates = pngOnly ? [] : await verifyActionsDisabledStates(cdp, baseUrl);
    if (!pngOnly) await verifyMalformedPng(cdp);
    await verifyPngFailureRecovery(cdp, baseUrl);
    process.stdout.write(`KORDYN V2 Task 4 browser PASS ${results.map((row) => `${row.width}x${row.height}:${row.outcome}/${row.translation}`).join(" ")} disabled=${disabledStates.join("+")} screenshots=${outputDir}\n`);
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await stopProcess(vite);
    await rm(userDataDir, { force: true, recursive: true });
  }
}

await main();
