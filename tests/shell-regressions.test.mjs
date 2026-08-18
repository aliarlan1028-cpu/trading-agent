import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { shellStatusTone } from "../src/shellStatus.js";

const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("narrow web viewports keep using the dedicated mobile application shell", () => {
  assert.match(main, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(main, /if \(isNativeApp \|\| isMobileViewport\)/);
  assert.match(main, /<MobileApp key=\{lang\}/);
});

test("desktop shell retains discoverable language, notification, and account controls", () => {
  assert.match(main, /operationsCenter:notifications/);
  assert.match(main, /switchLang\("zh"\)/);
  assert.match(main, /switchLang\("en"\)/);
  assert.match(main, /aria-label=\{t\("账户设置", "Account settings"\)\}/);
  assert.match(main, /onClick=\{\(\) => setActive\("systemSettings"\)\}/);
});

test("shell status lamps fail closed for exchange and automation incidents", () => {
  assert.equal(shellStatusTone("off", "disconnected"), "red");
  assert.equal(shellStatusTone("warning", "opening_paused"), "amber");
  assert.equal(shellStatusTone("danger", "emergency_stopped"), "red");
  assert.equal(shellStatusTone("ok", "normal"), "green");
  assert.equal(shellStatusTone("", "unrecognized_state"), "amber");
});
