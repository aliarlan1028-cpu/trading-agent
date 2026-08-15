// 风控阈值:把原本写死在 env/代码里的硬闸阈值提为「运行时可配置」,前端「风控设置 · 风控阈值」直接改,
// 存 runtimeConfig(setConfig 会同步 process.env),读取处按调用时读 → 改完即生效、不用重部署。
// 所有对外(API/前端/state)一律用【人类友好单位】(百分比/小时/笔),内部再转成各 env 的原生单位。

// key: 配置项名; env: 对应环境变量; def: 默认(人类单位); min/max: 合法区间; unit: 展示单位;
// toEnv: 人类单位 → env 原生值; fromEnv: env 原生值 → 人类单位。
export const RISK_THRESHOLD_DEFS = [
  { key: "minRewardRisk", strictDirection: "higher", env: "MIN_REWARD_RISK", def: 2, min: 1, max: 5, step: 0.1, unit: "R", label: "盈亏比下限", hint: "计划 RR 低于此值不下(条令 R0.2)" },
  { key: "protectMaxConsecLosses", strictDirection: "lower", env: "PROTECT_MAX_CONSEC_LOSSES", def: 3, min: 1, max: 100, step: 1, unit: "笔", label: "连亏冷却触发笔数", hint: "尾部连亏达此触发冷却(条令 P5)" },
  { key: "protectCooldownHours", strictDirection: "higher", env: "PROTECT_COOLDOWN_HOURS", def: 4, min: 0.5, max: 48, step: 0.5, unit: "小时", label: "连亏冷却时长", hint: "冷却期暂停新开仓" },
  { key: "protectMaxDrawdownPct", strictDirection: "lower", env: "PROTECT_MAX_DRAWDOWN_PCT", def: 10, min: 3, max: 50, step: 0.5, unit: "%", label: "回撤锁仓阈值", hint: "近期成交回撤达此(占权益)触发锁仓" },
  { key: "protectDrawdownLockHours", strictDirection: "higher", env: "PROTECT_DRAWDOWN_LOCK_HOURS", def: 12, min: 1, max: 72, step: 1, unit: "小时", label: "回撤锁仓时长", hint: "锁仓期暂停新开仓" },
  { key: "trailActivatePct", strictDirection: "lower", env: "TRAIL_ACTIVATE_PCT", def: 1.5, min: 0.3, max: 10, step: 0.1, unit: "%", label: "追踪止损·激活盈利", hint: "浮盈达此即启动追踪止损(条令 P3)" },
  { key: "trailDistancePct", strictDirection: "lower", env: "TRAIL_PCT", def: 1.2, min: 0.3, max: 5, step: 0.1, unit: "%", label: "追踪止损·跟踪距离", hint: "止损跟在现价后方此距离",
    toEnv: (v) => v / 100, fromEnv: (raw) => raw * 100 }, // env 存小数(0.012),UI 用百分比(1.2)
  { key: "eventBlackoutMinutes", strictDirection: "higher", env: "EVENT_BLACKOUT_MINUTES", def: 30, min: 0, max: 240, step: 5, unit: "分钟", label: "事件静默窗口", hint: "具有精确发布时间的高影响事件前，此分钟数内暂停新开仓(条令 S7)" },
  { key: "entryOrderTtlMinutes", strictDirection: "lower", env: "ENTRY_ORDER_TTL_MINUTES", def: 90, min: 5, max: 1440, step: 5, unit: "分钟", label: "挂单保质期", hint: "入场限价单挂此分钟数仍未成交即主动撤单(行情已变);0=不超时" },
  { key: "entryStaleDeviationPct", strictDirection: "lower", env: "ENTRY_STALE_DEVIATION_PCT", def: 8, min: 1, max: 30, step: 0.5, unit: "%", label: "挂单失效偏离", hint: "未成交挂单的现价偏离入场超此百分比即撤(机会已走/结构改变)" }
];

export function classifyRiskThresholdChanges(body = {}, current = currentRiskThresholds()) {
  const changes = [];
  for (const def of RISK_THRESHOLD_DEFS) {
    if (body[def.key] === undefined || body[def.key] === null || body[def.key] === "" || !Number.isFinite(Number(body[def.key]))) continue;
    const before = Number(current[def.key]);
    const after = Math.min(def.max, Math.max(def.min, Number(body[def.key])));
    if (after === before) continue;
    const stricter = def.strictDirection === "higher" ? after > before : after < before;
    changes.push({ key: def.key, label: def.label, before, after, classification: stricter ? "tighten" : "loosen" });
  }
  return changes;
}

const clampNum = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

// 读取当前值(人类单位),供 state 展示与 GET。缺省即回落默认。
export function currentRiskThresholds() {
  const out = {};
  for (const d of RISK_THRESHOLD_DEFS) {
    const rawEnv = process.env[d.env];
    if (rawEnv === undefined || rawEnv === "" || !Number.isFinite(Number(rawEnv))) { out[d.key] = d.def; continue; }
    const human = d.fromEnv ? d.fromEnv(Number(rawEnv)) : Number(rawEnv);
    out[d.key] = clampNum(human, d.def, d.min, d.max);
  }
  return out;
}

// 校验/夹取 body(人类单位)→ 写 runtimeConfig(env 原生单位)。只写传入且合法的项。
// setConfig 由 ctx 注入(runtimeConfig.setConfig);返回写入后的当前值。
export function applyRiskThresholds(db, body = {}, setConfig) {
  const entries = {};
  const applied = [];
  for (const d of RISK_THRESHOLD_DEFS) {
    if (body[d.key] === undefined || body[d.key] === null || body[d.key] === "") continue;
    const raw = Number(body[d.key]);
    if (!Number.isFinite(raw)) continue; // 非数值忽略,不静默重置为默认(typo 保护)
    const human = Math.min(d.max, Math.max(d.min, raw));
    const envVal = d.toEnv ? d.toEnv(human) : human;
    entries[d.env] = String(envVal);
    applied.push(`${d.label}=${human}${d.unit}`);
  }
  if (Object.keys(entries).length) setConfig(db, entries);
  return { applied, current: currentRiskThresholds() };
}
