import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runInContainer } from "../server/skillSandbox.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killedWith = null;
  child.kill = (signal) => {
    child.killedWith = signal;
    queueMicrotask(() => child.emit("close", null));
    return true;
  };
  return child;
}

test("skill sandbox rejects arbitrary executables", async () => {
  let spawned = false;
  const result = await runInContainer("/tmp/skill", "curl", ["https://example.test"], {
    spawnImpl: () => { spawned = true; }
  });
  assert.equal(result.rejected, true);
  assert.equal(spawned, false);
});

test("skill sandbox stops at the streaming output cap instead of buffering forever", async () => {
  const child = fakeChild();
  const promise = runInContainer("/tmp/skill", "sh", ["-lc", "yes"], {
    spawnImpl: () => child,
    timeoutMs: 5_000,
    maxOutputBytes: 32
  });
  child.stdout.emit("data", Buffer.alloc(128, 0x78));
  const result = await promise;
  assert.equal(result.outputLimited, true);
  assert.equal(child.killedWith, "SIGKILL");
  assert.ok(Buffer.byteLength(result.output) < 256);
});

test("skill sandbox enforces a wall-clock timeout and settles once", async () => {
  const child = fakeChild();
  const result = await runInContainer("/tmp/skill", "sh", ["-lc", "sleep 999"], {
    spawnImpl: () => child,
    timeoutMs: 5,
    maxOutputBytes: 1024
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 124);
  assert.equal(child.killedWith, "SIGKILL");
});

test("skill sandbox refuses work above the concurrency cap", async () => {
  const child = fakeChild();
  const first = runInContainer("/tmp/skill", "sh", ["-lc", "sleep 1"], {
    spawnImpl: () => child,
    timeoutMs: 5_000,
    maxConcurrency: 1
  });
  const second = await runInContainer("/tmp/skill", "sh", ["-lc", "true"], {
    spawnImpl: () => fakeChild(),
    maxConcurrency: 1
  });
  assert.equal(second.busy, true);
  child.emit("close", 0);
  await first;
});
