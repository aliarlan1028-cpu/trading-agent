import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const MAX_SAMPLES = 500;
const samples = [];
const startup = { phases: {}, readyAt: null, totalMs: null };
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

export function recordHttpPerformance(req, res, next) {
  const started = performance.now();
  res.on("finish", () => {
    const durationMs = Number((performance.now() - started).toFixed(1));
    const responseBytes = Number(res.getHeader("content-length") || 0) || 0;
    samples.push({
      method: req.method,
      path: req.route?.path || req.path,
      status: res.statusCode,
      durationMs,
      responseBytes,
      at: new Date().toISOString()
    });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  });
  next();
}

export function recordStartupPhase(name, startedAt) {
  startup.phases[name] = Number((performance.now() - startedAt).toFixed(1));
}

export function recordStartupReady() {
  startup.readyAt = new Date().toISOString();
  // process.uptime includes module loading, which starts before this metrics module is imported.
  startup.totalMs = Number((process.uptime() * 1000).toFixed(1));
}

export function httpPerformanceSnapshot() {
  const durations = samples.map((row) => row.durationMs);
  const slowest = samples.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 20);
  return {
    startup: { ...startup, phases: { ...startup.phases } },
    sampleCount: samples.length,
    latencyMs: {
      p50: Number(percentile(durations, 0.5).toFixed(1)),
      p95: Number(percentile(durations, 0.95).toFixed(1)),
      max: Number((durations.length ? Math.max(...durations) : 0).toFixed(1))
    },
    eventLoopDelayMs: {
      mean: Number.isFinite(eventLoop.mean) ? Number((eventLoop.mean / 1e6).toFixed(1)) : null,
      p95: Number((eventLoop.percentile(95) / 1e6).toFixed(1)),
      max: Number((eventLoop.max / 1e6).toFixed(1))
    },
    slowest,
    generatedAt: new Date().toISOString()
  };
}
