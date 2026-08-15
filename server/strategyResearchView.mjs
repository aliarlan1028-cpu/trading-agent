const asArray = (value) => Array.isArray(value) ? value : [];
const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function drawdownCurve(values = []) {
  let peak = -Infinity;
  return asArray(values).map(Number).filter(Number.isFinite).map((value) => {
    peak = Math.max(peak, value);
    return peak > 0 ? Number((((peak - value) / peak) * 100).toFixed(3)) : 0;
  });
}

function commonRecord(row, metrics, source) {
  const equityCurve = asArray(metrics?.equityCurve).map(Number).filter(Number.isFinite);
  return {
    id: row.id,
    source,
    evidenceType: source,
    name: row.name || row.strategyName || row.label || row.strategy || `${row.symbol || "—"} · ${row.strategyId || "strategy"}`,
    symbol: row.symbol || null,
    timeframe: row.timeframe || null,
    direction: row.direction || null,
    status: row.status || (row.passed === false ? "failed" : "completed"),
    passed: row.passed ?? null,
    version: row.version || null,
    createdAt: row.createdAt || row.chosenAt || null,
    startAt: row.startAt || null,
    endAt: row.endAt || null,
    methodology: row.methodology || null,
    parameters: row.parameters || row.params || {},
    trades: finiteOrNull(metrics?.trades),
    winRatePct: finiteOrNull(metrics?.winRatePct),
    expectancyR: finiteOrNull(metrics?.expectancyR),
    expectancyLower90R: finiteOrNull(metrics?.expectancyLower90R),
    profitFactor: finiteOrNull(metrics?.profitFactor),
    totalReturnPct: finiteOrNull(metrics?.netReturnPct ?? row.totalReturnPct),
    annualizedReturnPct: finiteOrNull(row.annualizedReturnPct),
    maxDrawdownPct: finiteOrNull(metrics?.maxDrawdownPct),
    sharpeRatio: finiteOrNull(metrics?.tradeSharpe ?? metrics?.sharpeRatio ?? row.sharpeRatio),
    equityCurve,
    drawdownCurve: drawdownCurve(equityCurve),
    folds: asArray(row.folds),
    activeFolds: finiteOrNull(row.activeFolds),
    positiveFolds: finiteOrNull(row.positiveFolds),
    regime: row.regime || null,
    confidence: row.confidence || null,
    diagnostics: row.overfitDiagnostics || null
  };
}

function legacyRecord(row) {
  const studio = row.kind === "strategy_blueprint" || Boolean(row.oos && row.draftId);
  const metrics = studio ? row.oos : row;
  return commonRecord(row, metrics, studio ? "studio_oos" : "historical_backtest");
}

function profileRecord(profile) {
  const record = commonRecord({
    ...profile,
    name: `${profile.symbol || "—"} · ${profile.label || "无合格策略"}`,
    status: profile.strategyId ? profile.confidence || "oos_ok" : "no_qualified_strategy",
    methodology: "自动参数研究：锚定训练段 + 3 段 purge/embargo 样本外验证"
  }, profile.oos || {}, "optimizer_oos");
  const activeFolds = asArray(profile.folds).filter((fold) => Number(fold?.trades) >= 2);
  const positiveFolds = activeFolds.filter((fold) => Number(fold?.expectancyR) > 0);
  return {
    ...record,
    // oos_ok is a research candidate, not a validated strategy. Only the full
    // optimizer validation gate may be shown as passed in research views.
    passed: profile.strategyId ? profile.confidence === "validated" && profile.rollingValidation?.passed === true : false,
    activeFolds: activeFolds.length,
    positiveFolds: positiveFolds.length,
    rollingValidation: profile.rollingValidation || null,
    regimeMatch: profile.regimeMatch ?? null,
    oosFoldsLabel: profile.oosFolds || null
  };
}

function forwardRecord(session, minimumTrades) {
  const metrics = session.metrics || {};
  return {
    id: session.id,
    evidenceType: "forward_paper",
    name: `${session.symbol || "—"} · ${session.label || session.strategyId || "策略"}`,
    symbol: session.symbol || null,
    timeframe: session.timeframe || null,
    direction: session.direction || null,
    status: session.status || "running",
    seeded: session.seeded === true,
    startedAt: session.startedAt || session.createdAt || null,
    updatedAt: session.updatedAt || null,
    completedTrades: finiteOrNull(metrics.trades) ?? asArray(session.trades).length,
    minimumTrades,
    progressPct: Math.min(100, ((finiteOrNull(metrics.trades) ?? asArray(session.trades).length) / Math.max(1, minimumTrades)) * 100),
    openPosition: session.paperPosition ? {
      entry: finiteOrNull(session.paperPosition.entry),
      stop: finiteOrNull(session.paperPosition.stop),
      target: finiteOrNull(session.paperPosition.tp)
    } : null,
    expectancyR: finiteOrNull(metrics.expectancyR),
    profitFactor: finiteOrNull(metrics.profitFactor),
    maxDrawdownPct: finiteOrNull(metrics.maxDrawdownPct)
  };
}

export function buildBacktestResearch(db = {}) {
  const historical = [];
  const seen = new Set();
  for (const row of [...asArray(db.backtests), ...asArray(db.strategyStudioBacktests)]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    historical.push(legacyRecord(row));
  }
  for (const profile of asArray(db.strategyProfiles)) {
    if (!profile?.id || seen.has(profile.id)) continue;
    seen.add(profile.id);
    historical.push(profileRecord(profile));
  }
  historical.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const minimumForwardTrades = Math.max(1, Number(process.env.MIN_FORWARD_TRADES || 30));
  const forward = asArray(db.paperSessions)
    .map((session) => forwardRecord(session, minimumForwardTrades))
    .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));

  return {
    historical,
    forward,
    summary: {
      totalHistoricalEvidence: historical.length,
      historicalBacktests: historical.filter((row) => row.evidenceType === "historical_backtest").length,
      optimizerOos: historical.filter((row) => row.evidenceType === "optimizer_oos").length,
      studioOos: historical.filter((row) => row.evidenceType === "studio_oos").length,
      forwardRunning: forward.filter((row) => row.status === "running").length,
      forwardPassed: forward.filter((row) => row.status === "passed").length,
      forwardFailed: forward.filter((row) => row.status === "failed").length
    }
  };
}
