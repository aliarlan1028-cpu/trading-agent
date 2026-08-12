import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduler-catchup-test-"));
process.env.DATA_DIR = dataDir;

const { overdueLongTasks } = await import("../server/scheduler.mjs");

test("启动补跑只挑超期的长间隔任务:短间隔/未超期/禁用/cron 均不补", () => {
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
      // cron 类型不归此机制管
      { id: "cron", enabled: true, type: "Cron", schedule: "0 0 * * *", lastRunAt: iso(10 * 3_600_000) }
    ]
  };
  const ids = overdueLongTasks(db, now).map((t) => t.id);
  assert.deepEqual(ids.sort(), ["intel", "never", "research"]);
});
