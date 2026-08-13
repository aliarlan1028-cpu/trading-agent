import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduler-catchup-test-"));
process.env.DATA_DIR = dataDir;

const { overdueLongTasks } = await import("../server/scheduler.mjs");

test("启动补跑只挑超期长任务，并补跑当天错过的显式 daily cron", () => {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const db = {
    tasks: [
      // 6h 任务,上次运行 10h 前 → 超期,补跑(生产实锤:频繁部署使 setInterval 反复归零,策略研究几乎永不执行)
      { id: "research", enabled: true, type: "Every", schedule: "Every 6h", lastRunAt: iso(10 * 3_600_000) },
      // 6h 任务,上次运行 2h 前 → 未超期,不补
      { id: "improve", enabled: true, type: "Every", schedule: "Every 6h", lastRunAt: iso(2 * 3_600_000) },
      // 从未跑过的长间隔任务 → 补
      { id: "never", enabled: true, type: "Every", schedule: "Every 6h" },
      // 1m 任务哪怕超期也不补(60s 内自然触发,补跑只添乱)
      { id: "poll", enabled: true, type: "Every", schedule: "Every 1m", lastRunAt: iso(3_600_000) },
      // 15m 任务(< 30m 门槛)不补
      { id: "cycle", enabled: true, type: "Every", schedule: "Every 15m", lastRunAt: iso(3_600_000) },
      // 关键情报任务显式要求启动补跑，即使低于 30m 门槛也要补，避免部署后继续使用旧闻。
      { id: "intel", enabled: true, type: "Every", schedule: "Every 20m", startupCatchup: true, lastRunAt: iso(3_600_000) },
      // 禁用任务不补
      { id: "off", enabled: false, type: "Every", schedule: "Every 6h", lastRunAt: iso(10 * 3_600_000) },
      // 未显式 startupCatchup 的 cron 不补
      { id: "cron", enabled: true, type: "Cron", schedule: "0 0 * * *", lastRunAt: iso(10 * 3_600_000) }
    ]
  };
  const ids = overdueLongTasks(db, now).map((t) => t.id);
  assert.deepEqual(ids.sort(), ["intel", "never", "research"]);
});

test("daily cron 在计划时间后重启会补跑，今天已跑或尚未到点则不补", () => {
  const now = Date.parse("2026-08-14T02:20:00.000Z"); // Asia/Shanghai 10:20
  const db = { tasks: [
    { id: "digest", enabled: true, type: "Cron", schedule: "5 8 * * *", timezone: "Asia/Shanghai", startupCatchup: true, lastRunAt: "2026-08-13T00:05:00.000Z" },
    { id: "already", enabled: true, type: "Cron", schedule: "5 8 * * *", timezone: "Asia/Shanghai", startupCatchup: true, lastRunAt: "2026-08-14T00:06:00.000Z" },
    { id: "later", enabled: true, type: "Cron", schedule: "30 11 * * *", timezone: "Asia/Shanghai", startupCatchup: true, lastRunAt: "2026-08-13T03:30:00.000Z" }
  ] };
  assert.deepEqual(overdueLongTasks(db, now).map((task) => task.id), ["digest"]);
});
