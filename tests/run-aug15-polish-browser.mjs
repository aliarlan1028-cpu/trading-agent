import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const baseUrl = new URL(process.env.KORDYN_AUG15_BASE_URL || "http://127.0.0.1:56802/");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

assert.ok(["127.0.0.1", "localhost"].includes(baseUrl.hostname), "polish gate only targets localhost");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
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
    await delay(80);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let requestId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
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
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
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
    await delay(60);
  }
}

async function viewport(cdp, width, height, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile
  });
  await cdp.send("Page.navigate", { url: baseUrl.href });
  await waitForExpression(cdp, mobile ? "document.querySelector('.mShell2')" : "document.querySelector('.appShell')", `${width} production shell`);
  await delay(500);
}

async function click(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    node.click();
    return true;
  })()`);
  assert.equal(clicked, true, `click target exists: ${selector}`);
  await delay(180);
}

async function clickText(cdp, selector, text) {
  const clicked = await evaluate(cdp, `(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(text)});
    if (!node) return false;
    node.click();
    return true;
  })()`);
  assert.equal(clicked, true, `click target exists: ${selector} / ${text}`);
  await delay(180);
}

async function press(cdp, key, code = key) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  await delay(100);
}

async function qualityFacts(cdp, rootSelector, textFloor, targetFloor) {
  return await evaluate(cdp, `(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const label = (node) => (node.getAttribute("aria-label") || node.title || node.textContent || node.className || node.tagName).trim().replace(/\\s+/g, " ").slice(0, 90);
    const controls = [...root.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[role="tab"]')]
      .filter(visible)
      .map((node) => ({ label: label(node), className: String(node.className), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
    const texts = [...root.querySelectorAll("small,p,label,td,th,button,b,strong,span")]
      .filter((node) => visible(node) && node.textContent.trim() && !node.querySelector("small,p,label,td,th,button,b,strong,span"))
      .map((node) => ({ label: label(node), className: String(node.className), size: Number.parseFloat(getComputedStyle(node).fontSize) }));
    return {
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      smallControls: controls.filter((item) => item.width < ${targetFloor} || item.height < ${targetFloor}),
      smallText: texts.filter((item) => item.size < ${textFloor}),
      controlCount: controls.length,
      textCount: texts.length
    };
  })()`);
}

function collect(failures, condition, message, facts) {
  if (!condition) failures.push({ message, facts });
}

async function dialogFacts(cdp, selector) {
  return await evaluate(cdp, `(() => {
    const dialog = document.querySelector(${JSON.stringify(selector)});
    return dialog ? {
      role: dialog.getAttribute("role"),
      modal: dialog.getAttribute("aria-modal"),
      label: dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby"),
      focusInside: dialog.contains(document.activeElement),
      active: document.activeElement?.className || document.activeElement?.tagName
    } : null;
  })()`);
}

async function runDesktop(cdp, failures) {
  await viewport(cdp, 1440, 900, false);
  const root = await qualityFacts(cdp, ".appShell", 11, 32);
  collect(failures, root.overflow === 0, "desktop 1440 has no document overflow", root.overflow);
  collect(failures, root.smallText.length === 0, "desktop essential text is at least 11px", root.smallText.slice(0, 20));
  collect(failures, root.smallControls.length === 0, "desktop compact controls are at least 32px", root.smallControls.slice(0, 20));

  await click(cdp, '[data-classic-target="researchCenter"]');
  await clickText(cdp, ".uxCenter > .uxTabs button", "知识库");
  const funnel = await evaluate(cdp, `([...document.querySelectorAll('.cp2Funnel > div')].map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, text: node.textContent.trim() })))`);
  collect(failures, funnel.length === 4 && funnel.every((item) => item.width >= 140 && item.height <= 44), "Research validation funnel labels remain horizontally readable", funnel);

  await clickText(cdp, ".uxCenter > .uxTabs button", "能力库");
  const rowBefore = await evaluate(cdp, `(() => { const row=document.querySelector('.cp2Table.rowClickable tbody tr'); return row ? { tabIndex: row.tabIndex, selected: row.getAttribute('aria-selected') } : null; })()`);
  collect(failures, rowBefore && rowBefore.tabIndex === 0, "Registry rows expose a keyboard focus target", rowBefore);
  if (rowBefore?.tabIndex === 0) {
    await evaluate(cdp, "document.querySelector('.cp2Table.rowClickable tbody tr')?.focus()");
    await press(cdp, "Enter");
    const selected = await evaluate(cdp, "document.querySelector('.cp2Table.rowClickable tbody tr')?.getAttribute('aria-selected')");
    collect(failures, selected === "true", "Enter activates the focused Registry row", selected);
  }

  await click(cdp, '[data-classic-target="chat"]');
  await click(cdp, ".topAvatar");
  const account = await dialogFacts(cdp, ".modalCard");
  collect(failures, account?.role === "dialog" && account.modal === "true" && Boolean(account.label) && account.focusInside, "Account settings starts as a labelled modal with focus inside", account);
  await press(cdp, "Escape");
  const accountClosed = !await evaluate(cdp, "Boolean(document.querySelector('.modalCard'))");
  const accountReturned = await evaluate(cdp, "document.activeElement?.classList?.contains('topAvatar') === true");
  collect(failures, accountClosed && accountReturned, "Account settings closes on Escape and restores trigger focus", { accountClosed, accountReturned });
  if (!accountClosed) await click(cdp, ".modalOverlay");

  await click(cdp, ".killButton");
  const danger = await dialogFacts(cdp, ".confirmDialog");
  collect(failures, danger?.role === "dialog" && danger.modal === "true" && Boolean(danger.label) && danger.focusInside, "Emergency confirmation starts as a labelled modal with focus inside", danger);
  await press(cdp, "Escape");
  const dangerClosed = !await evaluate(cdp, "Boolean(document.querySelector('.confirmDialog'))");
  const dangerReturned = await evaluate(cdp, "document.activeElement?.classList?.contains('killButton') === true");
  collect(failures, dangerClosed && dangerReturned, "Emergency confirmation closes on Escape and restores trigger focus", { dangerClosed, dangerReturned });
}

async function runMobile(cdp, failures, width, height) {
  await viewport(cdp, width, height, true);
  const root = await qualityFacts(cdp, ".mShell2", 12, 44);
  collect(failures, root.overflow === 0, `APP ${width} has no document overflow`, root.overflow);
  collect(failures, root.smallText.length === 0, `APP ${width} essential text is at least 12px`, root.smallText.slice(0, 30));
  collect(failures, root.smallControls.length === 0, `APP ${width} touch targets are at least 44px`, root.smallControls.slice(0, 30));
  if (width === 768) {
    const measure = await evaluate(cdp, `(() => { const node=document.querySelector('.mChatContent'); const rect=node.getBoundingClientRect(); return { width: rect.width, left: rect.left, right: innerWidth-rect.right }; })()`);
    collect(failures, measure.width <= 680 && Math.abs(measure.left - measure.right) <= 2, "APP 768 chat uses a centred readable tablet measure", measure);
  }
}

const profile = await mkdtemp(path.join(os.tmpdir(), "kordyn-aug15-polish-"));
const port = await freePort();
let chrome;
let cdp;
try {
  chrome = spawn(chromeBinary, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu",
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore" });
  const targets = await waitFor(`http://127.0.0.1:${port}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);
  const failures = [];
  await runDesktop(cdp, failures);
  await runMobile(cdp, failures, 390, 844);
  await runMobile(cdp, failures, 430, 932);
  await runMobile(cdp, failures, 768, 1024);
  assert.deepEqual(failures, [], `August 15 professional polish contract failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log("aug15 professional polish browser PASS");
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null && !chrome.signalCode) chrome.kill("SIGTERM");
}
