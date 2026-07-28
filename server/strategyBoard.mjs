// 统一策略表现看板:把三类"在用策略"聚合成一张表——
//   ① 知识技能(书本/口述/精选,live_probation/active/degraded)
//   ② 自适应画像(strategyProfiles,系统寻优产出,只读)
//   ③ 受信任的导入 skill(用户点信任后进 AI 工具表,可下线)
// 每行给身份/生命周期/实盘战绩/回测参考/派生健康裁定。实盘与回测严格分层,展示口径=自动下线口径。
import { appendAudit, nowIso } from "./store.mjs";
import { createNotification } from "./notificationStore.mjs";

const MIN_JUDGE_TRADES = Math.max(5, Number(process.env.KNOWLEDGE_SKILL_MIN_LIVE_TRADES || 10));
const POOR_PF = 0.8;
const POOR_STREAK = 5;
const GOOD_PF = 1.2;

// 派生健康裁定:样本不足不误判;阈值与自动下线一致(展示即执行口径)。
export function healthVerdict(m) {
  const trades = Number(m?.trades || 0);
  if (trades < MIN_JUDGE_TRADES) return { key: "insufficient", label: "样本不足", tone: "neutral" };
  const pf = m.profitFactor;
  const streak = Number(m.consecutiveLosses || 0);
  if ((pf !== null && pf < POOR_PF) || streak >= POOR_STREAK) return { key: "retire", label: "建议下线", tone: "danger" };
  if ((pf !== null && pf < 1) || streak >= 3) return { key: "watch", label: "逼近下线线", tone: "warning" };
  if (pf === null || pf >= GOOD_PF) return { key: "good", label: "表现良好", tone: "ok" };
  return { key: "ok", label: "观察中", tone: "info" };
}

function knowledgeRows(db) {
  const shown = new Set(["active", "live_probation", "degraded"]);
  const invocations = db.knowledge?.skillInvocations || [];
  return (db.knowledge?.tradingSkills || []).filter((s) => shown.has(s.status)).map((s) => {
    const m = s.liveMetrics || {};
    const inv = invocations.filter((i) => i.skillId === s.id);
    return {
      adopted: { count: inv.length, lastAt: inv[0]?.createdAt || null },
      id: s.id,
      kind: "knowledge",
      name: s.name,
      sourceLabel: s.userAuthored ? "口述" : s.curated ? "精选" : "书本",
      direction: s.spec?.direction || "long",
      scope: (s.spec?.symbolScope || []).join("/") || "*",
      timeframe: s.spec?.timeframe || "-",
      status: s.status,
      since: s.probationStartedAt || s.approval?.approvedAt || s.updatedAt || null,
      live: {
        trades: Number(m.trades || 0),
        winRatePct: m.winRatePct ?? null,
        profitFactor: m.profitFactor ?? null,
        weightedPnl: m.weightedPnl ?? null,
        consecutiveLosses: Number(m.consecutiveLosses || 0)
      },
      backtest: s.validation?.test ? { expectancyR: s.validation.test.expectancyR ?? null, profitFactor: s.validation.test.profitFactor ?? null } : null,
      verdict: healthVerdict(m),
      controls: s.status === "degraded" ? ["reactivate"] : ["retire"]
    };
  });
}

function profileRows(db) {
  return (db.strategyProfiles || []).filter((p) => p.strategyId).map((p) => ({
    id: `profile_${p.symbol}_${p.timeframe}`,
    kind: "profile",
    name: p.label || p.strategyId,
    sourceLabel: "自适应",
    direction: p.direction || "long",
    scope: p.symbol,
    timeframe: p.timeframe,
    status: "adaptive",
    since: p.updatedAt || p.createdAt || null,
    live: null, // 画像来自寻优/前向,不是逐笔实盘归因
    backtest: { expectancyR: p.oosScore ?? null, confidence: p.confidence ?? null },
    adopted: null, // 画像为顾问注入,不逐笔绑定归因
    verdict: { key: "adaptive", label: "自动换代", tone: "info" },
    controls: [] // 系统自动换代,不手动上下线
  }));
}

function trustedRows(db) {
  // 与技能流水线策略同一生命周期:live_probation(试用)/active(转正)/degraded(退役)
  return (db.skills || []).filter((s) => !s.native && (s.trusted || s.trustStatus === "degraded")).map((s) => {
    const m = s.liveMetrics || {};
    return {
      id: s.id,
      kind: "trusted",
      name: s.name,
      sourceLabel: "导入",
      direction: s.direction || "both",
      scope: "-",
      timeframe: "-",
      status: s.trustStatus || "live_probation",
      since: s.trustedAt || null,
      live: {
        trades: Number(m.trades || 0),
        winRatePct: m.winRatePct ?? null,
        profitFactor: m.profitFactor ?? null,
        weightedPnl: m.weightedPnl ?? null,
        consecutiveLosses: Number(m.consecutiveLosses || 0)
      },
      backtest: null, // 导入 skill 无系统回测
      adopted: { count: Number(s.invocations || 0), lastAt: s.lastCalledAt || null },
      verdict: healthVerdict(m),
      controls: s.trustStatus === "degraded" ? ["retrust"] : ["untrust"]
    };
  });
}

// 受信任导入 skill 的实盘复盘 + 自动撤信任:按 plan.adoptedTrustedSkillIds 归因真实平仓盈亏,
// 达阈值(盈亏因子<0.8 或连亏5,样本≥N)自动撤信任并通知(用户选:自动下线+通知)。
export function refreshTrustedSkillMetrics(db, actor = "TrustedSkillGuard") {
  const trusted = (db.skills || []).filter((s) => !s.native && s.trusted);
  if (!trusted.length) return { untrusted: [], graduated: [] };
  const closes = (db.fills || []).filter((f) => f.kind === "close" && Number.isFinite(Number(f.realizedPnl)));
  const untrusted = [];
  const graduated = [];
  for (const skill of trusted) {
    const rows = [];
    for (const f of closes) {
      const plan = (db.tradePlans || []).find((p) => p.id === (f.tradePlanId || f.planId));
      if (plan?.adoptedTrustedSkillIds?.includes(skill.id)) rows.push(Number(f.realizedPnl));
    }
    if (!rows.length) { skill.liveMetrics = { trades: 0 }; continue; }
    const wins = rows.filter((r) => r > 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(rows.filter((r) => r < 0).reduce((a, b) => a + b, 0));
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) { if (rows[i] < 0) streak += 1; else break; }
    skill.liveMetrics = {
      trades: rows.length,
      wins: wins.length,
      winRatePct: Number(((wins.length / rows.length) * 100).toFixed(1)),
      weightedPnl: Number(rows.reduce((a, b) => a + b, 0).toFixed(4)),
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
      consecutiveLosses: streak,
      updatedAt: nowIso()
    };
    // 与技能流水线策略同一套生命周期:试用(live_probation)→真实成绩好则转正(active)、差则退役(degraded)
    const m2 = skill.liveMetrics;
    const poor = m2.trades >= MIN_JUDGE_TRADES && ((m2.profitFactor !== null && m2.profitFactor < POOR_PF) || streak >= POOR_STREAK);
    const good = m2.trades >= MIN_JUDGE_TRADES && m2.weightedPnl > 0 && (m2.profitFactor === null || m2.profitFactor >= GOOD_PF) && streak < 3;
    if (poor) {
      skill.trustStatus = "degraded";
      skill.trusted = false;
      skill.untrustedAt = nowIso();
      skill.untrustReason = `实盘不达标(PF ${m2.profitFactor ?? "-"}/连亏 ${streak})`;
      untrusted.push(skill.id);
      appendAudit(db, `受信任导入 skill 自动退役「${skill.name}」：${skill.untrustReason}`, skill.id, actor, "warning");
      createNotification(db, { eventType: "skill_untrust", severity: "warning", title: "导入策略自动下线", body: `${skill.name} 真实成绩不达标（${skill.untrustReason}），已自动退役、移出 AI 决策。` });
    } else if (good && skill.trustStatus !== "active") {
      skill.trustStatus = "active";
      skill.graduatedAt = nowIso();
      graduated.push(skill.id);
      appendAudit(db, `受信任导入 skill 转正「${skill.name}」：真实成绩达标(${m2.trades}笔 PF ${m2.profitFactor})`, skill.id, actor, "info");
      createNotification(db, { eventType: "skill_graduate", severity: "info", title: "导入策略转正", body: `${skill.name} 真实成绩达标（${m2.trades} 笔 PF ${m2.profitFactor}），已转正为已验证策略。` });
    }
  }
  return { untrusted, graduated };
}

export function buildStrategyBoard(db) {
  const rows = [...knowledgeRows(db), ...trustedRows(db), ...profileRows(db)];
  const summary = {
    total: rows.length,
    live: rows.filter((r) => ["active", "live_probation"].includes(r.status)).length,
    suggestRetire: rows.filter((r) => r.verdict.key === "retire").length,
    generatedAt: nowIso()
  };
  return { rows, summary };
}
