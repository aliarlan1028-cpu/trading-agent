import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fs.readFileSync(path.join(root, "deploy", "safe-docker-cleanup.sh"), "utf8");
const service = fs.readFileSync(path.join(root, "deploy", "trading-agent-cache-prune.service"), "utf8");
const timer = fs.readFileSync(path.join(root, "deploy", "trading-agent-cache-prune.timer"), "utf8");

test("disk cleanup caps BuildKit cache at 3GB without waiting for cache age", () => {
  assert.match(service, /^Environment=DOCKER_BUILD_CACHE_MAX_USED_SPACE=3gb$/m);
  assert.doesNotMatch(service, /DOCKER_BUILD_CACHE_MAX_AGE|DISK_CLEANUP_THRESHOLD_PCT/);
  assert.match(script, /docker buildx prune --all --force --max-used-space/);
  assert.doesNotMatch(script, /(?:until=|DOCKER_BUILD_CACHE_MAX_AGE|DISK_CLEANUP_THRESHOLD_PCT)/);
});

test("disk cleanup timer runs daily at 04:30 Asia Shanghai", () => {
  assert.match(timer, /^OnCalendar=\*-\*-\* 04:30:00 Asia\/Shanghai$/m);
  assert.doesNotMatch(timer, /^OnCalendar=Sun\b/m);
});

test("disk cleanup removes only dangling images after capping build cache", () => {
  assert.match(script, /docker image prune --force/);
  assert.doesNotMatch(script, /docker image prune[^\n]*(?:--all|-a(?:\s|$))/);
});

test("disk cleanup never targets containers, volumes, application data, or backups", () => {
  assert.doesNotMatch(script, /docker (?:container|volume|system) prune/);
  assert.doesNotMatch(script, /(?:^|\s)rm\s+-[a-zA-Z]*r/);
  assert.doesNotMatch(script, /(?:data|backup)[^\n]*(?:delete|prune|rm)/i);
});
