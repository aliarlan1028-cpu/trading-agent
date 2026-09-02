import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  cacheControlForStatic,
  installStaticDelivery,
  staticContentSecurityPolicy,
  staticDocumentForPath,
} from "../server/staticDelivery.mjs";

test("static delivery assigns documents, cache policy, and a self-hosted CSP", () => {
  assert.equal(staticDocumentForPath("/"), "landing.html");
  assert.equal(staticDocumentForPath("/landing.html"), "landing.html");
  assert.equal(staticDocumentForPath("/app"), "index.html");
  assert.equal(staticDocumentForPath("/app/settings"), "index.html");
  assert.equal(cacheControlForStatic("/dist/assets/landing-abc.css"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForStatic("/dist/landing.html"), "no-cache");
  assert.doesNotMatch(staticContentSecurityPolicy(), /fonts\.googleapis|fonts\.gstatic/);
});

test("static delivery serves landing at the public root and product at app paths", async (t) => {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "trading-agent-static-delivery-"));
  t.after(async () => rm(publicDir, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(publicDir, "landing.html"), "LANDING"),
    writeFile(path.join(publicDir, "index.html"), "PRODUCT"),
    mkdir(path.join(publicDir, "api")),
  ]);
  await writeFile(path.join(publicDir, "api", "proof"), "STATIC API");

  const app = express();
  installStaticDelivery(app, { publicDir });
  app.get("/api/proof", (_req, res) => res.send("API"));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(`${baseUrl}/`)).text(), "LANDING");
  assert.equal(await (await fetch(`${baseUrl}/app`)).text(), "PRODUCT");
  assert.equal(await (await fetch(`${baseUrl}/api/proof`)).text(), "API");
});
