import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const finalRoot = path.join(rootDir, ".impeccable/review/kordyn-v2/final");
const htmlPath = path.join(finalRoot, "contact-sheet.html");
const pngPath = path.join(finalRoot, "contact-sheet.png");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const scopes = Object.freeze(["ai", "account", "assets", "governance"]);
const requiredStates = Object.freeze([
  "loading", "empty", "processing", "stale", "degraded", "failed", "forbidden",
  "disabled", "approval", "partial", "no-result", "long-content", "large-list"
]);

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function regularContainedFile(target, label) {
  assert.equal(inside(finalRoot, target), true, `${label} remains inside final evidence root`);
  const identity = await lstat(target);
  assert.equal(identity.isFile() && !identity.isSymbolicLink(), true, `${label} is a regular file`);
  return target;
}

function relativeUrl(target) {
  return path.relative(finalRoot, target).split(path.sep).map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadJson(target, label) {
  await regularContainedFile(target, label);
  return JSON.parse(await readFile(target, "utf8"));
}

async function buildModel() {
  await realpath(finalRoot);
  const groups = [];
  const provenance = [];
  for (const scope of scopes) {
    const indexPath = path.join(finalRoot, "compare", scope, "comparison-index.json");
    const index = await loadJson(indexPath, `${scope} comparison index`);
    assert.equal(index.counts?.pendingConcepts, 0, `${scope}: no pending concepts`);
    assert.equal(index.counts?.comparisons, index.comparisons?.length, `${scope}: comparison count`);
    const sourceCommit = index.productionSourceCommit || index.productSourceCommit;
    assert.match(sourceCommit || "", /^[0-9a-f]{40}$/, `${scope}: exact product source`);
    assert.match(index.captureTestSourceCommit || "", /^[0-9a-f]{40}$/, `${scope}: exact capture-test source`);
    provenance.push({ scope, product: sourceCommit, capture: index.captureTestSourceCommit });
    const byConcept = new Map();
    for (const comparison of index.comparisons) {
      const rows = byConcept.get(comparison.conceptId) || [];
      rows.push(comparison);
      byConcept.set(comparison.conceptId, rows);
    }
    for (const [conceptId, rows] of byConcept) {
      assert.equal(rows.length, 2, `${conceptId}: primary and adaptation comparison`);
      rows.sort((left, right) => Number.parseInt(right.viewport, 10) - Number.parseInt(left.viewport, 10));
      const primary = rows.find((row) => row.viewport.startsWith("1440x") || row.viewport.startsWith("390x"));
      const adaptation = rows.find((row) => row !== primary);
      assert.ok(primary && adaptation, `${conceptId}: deterministic primary/adaptation`);
      const captureDir = path.dirname(path.join(rootDir, index.captureEvidence));
      const compareDir = path.join(rootDir, index.outputRoot);
      const images = [
        { label: `Approved · normalized ${primary.viewport}`, path: path.join(compareDir, primary.artifacts.normalizedReference.file) },
        { label: `Production · ${primary.viewport}`, path: path.join(captureDir, primary.actual) },
        { label: `Overlay 50% · ${primary.viewport}`, path: path.join(compareDir, primary.artifacts.overlay50.file) },
        { label: `Responsive production · ${adaptation.viewport}`, path: path.join(captureDir, adaptation.actual) }
      ];
      for (const image of images) await regularContainedFile(image.path, `${conceptId}:${image.label}`);
      groups.push({ scope, conceptId, images, metric: primary.pixelDifference });
    }
  }
  assert.equal(groups.length, 15, "all 15 approved concepts are represented");

  const overlayEvidence = await loadJson(path.join(finalRoot, "screens", "overlays", "capture-evidence.json"), "overlay evidence");
  assert.equal(overlayEvidence.captures?.length, 9, "nine overlay/confirmation captures");
  assert.match(overlayEvidence.productionSourceCommit || "", /^[0-9a-f]{40}$/, "overlay product source");
  assert.match(overlayEvidence.captureTestSourceCommit || "", /^[0-9a-f]{40}$/, "overlay capture-test source");
  const overlayImages = [];
  for (const capture of overlayEvidence.captures) {
    const target = path.join(finalRoot, "screens", "overlays", capture.file);
    await regularContainedFile(target, `overlay:${capture.file}`);
    overlayImages.push({ label: capture.surface, meta: capture.viewport, path: target });
  }

  const stateEvidence = await loadJson(path.join(finalRoot, "screens", "ai", "state-evidence.json"), "AI state evidence");
  const stateImages = [];
  for (const kind of requiredStates) {
    const state = stateEvidence.states?.find((row) => row.state === kind);
    assert.ok(state, `state evidence:${kind}`);
    const target = path.join(finalRoot, "screens", "ai", state.file);
    await regularContainedFile(target, `state:${kind}`);
    stateImages.push({ label: kind, meta: state.viewport, path: target });
  }
  return { groups, provenance, overlays: { evidence: overlayEvidence, images: overlayImages }, stateImages };
}

function imageFigure(image) {
  return `<figure><img src="${relativeUrl(image.path)}" alt="${escapeHtml(image.label)}"><figcaption><strong>${escapeHtml(image.label)}</strong>${image.meta ? `<span>${escapeHtml(image.meta)}</span>` : ""}</figcaption></figure>`;
}

function renderHtml(model) {
  const provenance = model.provenance.map((row) => `<li><b>${escapeHtml(row.scope.toUpperCase())}</b><span>product ${escapeHtml(row.product.slice(0, 8))}</span><span>capture ${escapeHtml(row.capture.slice(0, 8))}</span></li>`).join("");
  const concepts = model.groups.map((group, index) => `<article class="concept"><header><span>${String(index + 1).padStart(2, "0")} / 15</span><h2>${escapeHtml(group.conceptId)}</h2><em>${escapeHtml(group.scope)}</em></header><div class="quad">${group.images.map(imageFigure).join("")}</div><footer>Pixel MAE ${Number(group.metric).toFixed(6)} · diagnostic only · region verdict recorded separately</footer></article>`).join("");
  const overlays = model.overlays.images.map(imageFigure).join("");
  const states = model.stateImages.map(imageFigure).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KORDYN V2 Final Visual Evidence</title>
<style>
:root{--ink:#08111e;--panel:#0c1828;--line:#243a57;--soft:#8fa3bd;--text:#e8f0fa;--blue:#3478ff;--mint:#20d794;--violet:#8167ff;--danger:#ff5968}*{box-sizing:border-box}html,body{margin:0;background:#050c16;color:var(--text);font-family:Inter,"Helvetica Neue",Arial,sans-serif}body{width:1800px;padding:44px;background:radial-gradient(circle at 82% 4%,rgba(52,120,255,.11),transparent 24%),#050c16}header.hero{padding:32px 34px;border:1px solid var(--line);background:linear-gradient(135deg,#0e1d31,#08111e)}.kicker{color:#6ca0ff;font:700 12px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.18em}.hero h1{margin:12px 0 8px;font-size:42px;letter-spacing:-.04em}.hero p{max-width:1100px;margin:0;color:var(--soft);font-size:15px;line-height:1.65}.provenance{margin:22px 0 0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;list-style:none}.provenance li{padding:11px 12px;display:flex;align-items:center;gap:12px;border:1px solid #223954;background:#071321;font:11px/1.2 ui-monospace,SFMono-Regular,monospace}.provenance b{color:var(--mint)}.provenance span{color:var(--soft)}section{margin-top:30px}.sectionTitle{margin:0 0 14px;display:flex;align-items:end;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:10px}.sectionTitle h2{margin:0;font-size:24px}.sectionTitle p{margin:0;color:var(--soft);font-size:12px}.conceptGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.concept{min-width:0;padding:14px;border:1px solid var(--line);background:linear-gradient(150deg,rgba(12,24,40,.97),rgba(6,15,27,.99))}.concept>header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;margin-bottom:10px}.concept>header span,.concept>header em{color:#79a7ff;font:10px/1.2 ui-monospace,SFMono-Regular,monospace;font-style:normal}.concept h2{margin:0;overflow:hidden;font-size:15px;text-overflow:ellipsis;white-space:nowrap}.quad{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}figure{min-width:0;margin:0;border:1px solid #1b304a;background:#030913}figure img{width:100%;height:220px;display:block;object-fit:contain;background:#020711}figcaption{min-height:42px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #1b304a;font-size:10px}figcaption strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}figcaption span{flex:0 0 auto;color:var(--soft);font:9px/1.2 ui-monospace,SFMono-Regular,monospace}.concept>footer{margin-top:9px;color:var(--soft);font:9px/1.4 ui-monospace,SFMono-Regular,monospace}.evidenceGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.evidenceGrid figure img{height:280px}.stateGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.stateGrid figure img{height:215px}.finalNote{margin-top:30px;padding:18px 22px;display:flex;justify-content:space-between;border:1px solid var(--line);color:var(--soft);background:#071321;font:10px/1.5 ui-monospace,SFMono-Regular,monospace}.finalNote b{color:var(--mint)}
</style></head><body>
<header class="hero"><div class="kicker">KORDYN V2 · FINAL VISUAL EVIDENCE</div><h1>15 个批准概念 · 真实组件收敛总览</h1><p>每个概念并列展示批准参考、生产主视口、50% Overlay 与响应式生产适配。截图来自 production-shaped、无凭据、零生产写入的真实 KordynV2Root 浏览器门禁；像素差仅用于诊断，区域级判定以原尺寸审查记录为准。</p><ul class="provenance">${provenance}</ul></header>
<section><div class="sectionTitle"><h2>01 / Approved concepts</h2><p>15 concepts · 30 viewport comparisons · 60 images</p></div><div class="conceptGrid">${concepts}</div></section>
<section><div class="sectionTitle"><h2>02 / Context, Proof & authority layers</h2><p>Context / Proof / AI support / approval / ordinary confirmation / danger confirmation</p></div><div class="evidenceGrid">${overlays}</div></section>
<section><div class="sectionTitle"><h2>03 / Truthful state semantics</h2><p>13 / 13 required product states</p></div><div class="stateGrid">${states}</div></section>
<footer class="finalNote"><b>PRODUCT SOURCE ${escapeHtml(model.provenance[0].product)}</b><span>IMAGE COUNT 82 · no evidence-commit self reference · generated ${escapeHtml(new Date().toISOString())}</span></footer>
</body></html>`;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, predicate) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) return value;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
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
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++requestId;
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
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

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function render() {
  const model = await buildModel();
  await writeFile(htmlPath, renderHtml(model));
  const chromePort = await freePort();
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-contact-sheet-"));
  const chrome = spawn(chromeBinary, ["--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
    cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
    await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 900, screenWidth: 1800, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    const deadline = Date.now() + 20_000;
    let imageGate;
    while (Date.now() < deadline) {
      imageGate = await evaluate(cdp, `(async()=>{await document.fonts.ready;const rows=[...document.images];return {ready:document.readyState,imageCount:rows.length,broken:rows.filter((img)=>!img.complete||img.naturalWidth===0).map((img)=>img.getAttribute('src')),pendingText:/EVIDENCE COMMIT PENDING|PENDING EVIDENCE/i.test(document.body.innerText),width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight};})()`);
      if (imageGate.ready === "complete" && imageGate.broken.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(imageGate.imageCount, 82, "contact sheet contains exactly 82 governed images");
    assert.deepEqual(imageGate.broken, [], "every contact-sheet image has naturalWidth > 0");
    assert.equal(imageGate.pendingText, false, "contact sheet contains no pending/self-reference placeholder");
    assert.equal(imageGate.width, 1800, "contact sheet has exact output width");
    assert.ok(imageGate.height > 5_000 && imageGate.height < 15_000, `bounded contact-sheet height ${imageGate.height}`);
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1800, height: imageGate.height, scale: 1 }
    });
    await writeFile(pngPath, Buffer.from(screenshot.data, "base64"));
    const metadata = await sharp(pngPath).metadata();
    assert.deepEqual([metadata.width, metadata.height], [1800, imageGate.height], "rendered PNG matches full document geometry");
    return { imageCount: imageGate.imageCount, broken: imageGate.broken, width: metadata.width, height: metadata.height, pendingText: imageGate.pendingText, productSourceCommit: model.provenance[0].product, captureSources: Object.fromEntries(model.provenance.map((row) => [row.scope, row.capture])), overlayCaptureSource: model.overlays.evidence.captureTestSourceCommit };
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const result = await render();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
