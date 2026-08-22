import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fs.readFileSync(path.join(root, "deploy", "safe-docker-cleanup.sh"), "utf8");

test("disk cleanup removes only dangling images after pruning old build cache", () => {
  assert.match(script, /docker image prune --force/);
  assert.doesNotMatch(script, /docker image prune[^\n]*(?:--all|-a(?:\s|$))/);
});

test("disk cleanup never targets containers, volumes, application data, or backups", () => {
  assert.doesNotMatch(script, /docker (?:container|volume|system) prune/);
  assert.doesNotMatch(script, /(?:^|\s)rm\s+-[a-zA-Z]*r/);
  assert.doesNotMatch(script, /(?:data|backup)[^\n]*(?:delete|prune|rm)/i);
});
