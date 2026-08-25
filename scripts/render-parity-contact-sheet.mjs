import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const htmlPath = path.resolve(process.argv[2] || ".impeccable/review/parity-contact-sheet.html");
const pngPath = path.resolve(process.argv[3] || ".impeccable/review/parity-contact-sheet.png");
const expectedImageCount = Number(process.env.EXPECTED_IMAGE_COUNT || 62);

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

async function waitFor(url, predicate = () => true) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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
    close() {
      socket.close();
    }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result.value;
}

async function waitForDocument(cdp) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState === 'complete' && [...document.images].every((image) => image.complete)");
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the contact sheet and its images");
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-contact-sheet-"));
const chromeOutput = [];
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-default-browser-check",
  "--no-first-run",
  "--allow-file-access-from-files",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });
chrome.stdout.on("data", (chunk) => chromeOutput.push(chunk.toString()));
chrome.stderr.on("data", (chunk) => chromeOutput.push(chunk.toString()));

let cdp;
try {
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);
  await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await waitForDocument(cdp);

  const proof = await evaluate(cdp, `(() => {
    const images = [...document.images];
    const broken = images
      .map((image, index) => ({ index, src: image.getAttribute('src'), complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }))
      .filter((image) => !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0);
    return {
      imageCount: images.length,
      broken,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      pendingText: document.body.innerText.includes('EVIDENCE COMMIT PENDING')
    };
  })()`);

  if (proof.imageCount !== expectedImageCount || proof.broken.length || proof.pendingText) {
    throw new Error(`Contact sheet gate failed: ${JSON.stringify({ expectedImageCount, ...proof })}`);
  }
  if (proof.width !== 1800 || proof.height <= 0) {
    throw new Error(`Unexpected contact sheet geometry: ${JSON.stringify(proof)}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: proof.width, height: proof.height, deviceScaleFactor: 1, mobile: false });
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: proof.width, height: proof.height, scale: 1 }
  });
  await writeFile(pngPath, Buffer.from(screenshot.data, "base64"));
  process.stdout.write(`${JSON.stringify({ htmlPath, pngPath, ...proof })}\n`);
} catch (error) {
  const tail = chromeOutput.join("").slice(-4_000);
  throw new Error(`${error.message}${tail ? `\nChrome output:\n${tail}` : ""}`, { cause: error });
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true });
}
