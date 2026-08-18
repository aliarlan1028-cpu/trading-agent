import { activeProvider, runAgentChat } from "./agentChat.mjs";
import { expireStalePlans } from "./agentOrchestrator.mjs";
import { refreshAccounting } from "./accounting.mjs";
import { syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchMarketRegime } from "./marketSignals.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { describeWatch } from "./watchSentinel.mjs";
import { compactTriggeredWatch } from "./watchReviewGuard.mjs";
import { watchDirectionLabel, watchThesis, watchTriggerMeaning } from "./watchView.mjs";
import { applyOperationalDegradation } from "./professionalRiskGate.mjs";
import { consumeOpportunitySignals, peekOpportunitySignals } from "./earlyOpportunityEngine.mjs";
import { systemAgentInvocation } from "./agentInvocation.mjs";
import { approveStateFilePromptArtifact, markStateFilePromptDraft } from "./knowledgePromptPolicy.mjs";
import { analyzeQueuedNewsForDecision, newsDecisionAnalysisEvidence } from "./newsDecisionAnalysis.mjs";
import { evaluateAgentDecisionWake, recordAgentDecisionWake } from "./decisionWakePolicy.mjs";
import { refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";

// ---------------------------------------------------------------------------
// 自主巡检循环：由调度器周期触发。
// LLM 已配置且授权激活时 → 走真实 LLM 决策循环（与对话共用一套工具与风控）；
// 否则做真实数据巡检（行情同步 + 核算 + 风控复查），不产生编造内容。
// ---------------------------------------------------------------------------

export function newsSignalSymbols(signal = {}) {
  return [...new Set([...(signal.affectedSymbols || []), ...(signal.symbols || [])]
    .map((value) => String(value).toUpperCase())
    .filter((value) => /^[A-Z0-9]{2,15}\/USDT$/.test(value)))].slice(0, 12);
}

function safeDescriptorToken(value, fallback = "unknown") {
  const token = String(value || "").trim();
  return token && /^[a-zA-Z0-9._:/ -]{1,120}$/.test(token) ? token : fallback;
}

export function newsSignalDescriptor(signal = {}) {
  const kind = signal.kind === "scheduled_event" ? "scheduled_event" : "breaking_news";
  const evidenceId = String(signal.eventId || signal.factId || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120) || "unknown";
  const trustTier = ["verified_official", "verified_publisher", "verified_official_calendar", "unverified_manual", "unverified_aggregator", "unverified_custom", "unverified_fetch", "source_supplied"]
    .includes(signal.trustTier) ? signal.trustTier : "unknown_source";
  const symbols = newsSignalSymbols(signal);
  const impact = Number(signal.impact);
  const timestamp = signal.publishedAt || signal.queuedAt || null;
  const timestampMs = timestamp ? new Date(timestamp).getTime() : NaN;
  const publishedAt = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : "unknown";
  const verificationStatus = ["corroborated", "single_source", "conflicting", "not_found", "search_unavailable", "search_not_configured", "fact_missing", "not_searched_by_policy"]
    .includes(signal.verificationStatus) ? signal.verificationStatus : "not_verified";
  const analysisStatus = ["api_analyzed", "source_metadata_only", "fact_missing"].includes(signal.analysisStatus)
    ? signal.analysisStatus : "source_metadata_only";
  const category = /^[a-z_]{2,40}$/.test(String(signal.category || "")) ? signal.category : "unknown";
  const confidence = ["high", "medium", "low"].includes(signal.confidence) ? signal.confidence : "low";
  const materiality = ["high", "medium", "low", "none"].includes(signal.materiality) ? signal.materiality : "none";
  const eventType = /^[a-z_]{2,40}$/.test(String(signal.eventType || "")) ? signal.eventType : "other";
  const impactChannels = [...new Set((signal.impactChannels || []).filter((value) => /^[a-z_]{2,40}$/.test(String(value))))].slice(0, 4);
  const scope = /^[a-z_]{2,40}$/.test(String(signal.scope || "")) ? signal.scope : "unknown";
  const announcementStatus = /^[a-z_]{2,40}$/.test(String(signal.announcementStatus || "")) ? signal.announcementStatus : "unknown";
  const sentiment = Number.isFinite(Number(signal.sentiment)) ? Math.max(0, Math.min(100, Number(signal.sentiment))) : null;
  const citationCount = Math.max(0, Math.min(8, Number(signal.citationCount || 0)));
  const inputHash = /^[a-f0-9]{64}$/.test(String(signal.analysisContentHash || "")) ? signal.analysisContentHash : "none";
  const outputHash = /^[a-f0-9]{64}$/.test(String(signal.analysisOutputHash || "")) ? signal.analysisOutputHash : "none";
  return `kind=${kind} · evidenceId=${evidenceId} · trustTier=${trustTier} · verifiedOrigin=${signal.verifiedOrigin === true} · analysisStatus=${analysisStatus} · verificationStatus=${verificationStatus} · analysisSource=${safeDescriptorToken(signal.analysisSource, "source_metadata_only")} · category=${category} · eventType=${eventType} · impactChannels=${impactChannels.length ? impactChannels.join(",") : "none"} · scope=${scope} · announcementStatus=${announcementStatus} · sentiment=${sentiment ?? "unknown"} · confidence=${confidence} · materiality=${materiality} · citationCount=${citationCount} · analysisModel=${safeDescriptorToken(signal.analysisModel)} · analysisProvider=${safeDescriptorToken(signal.analysisProvider)} · analysisInputHash=${inputHash} · analysisOutputHash=${outputHash} · providerAttributionVerified=${signal.providerAttributionVerified === true} · publishedAt=${publishedAt}${Number.isFinite(impact) ? ` · impact=${impact}` : ""}${symbols.length ? ` · symbols=${symbols.join(",")}` : ""}`;
}

const MAX_EVENT_FOCUS_SYMBOLS = 4;
const MAX_FAST_MOVE_BATCH = 4;
const MAX_NEWS_BATCH = 3;

function fastMoveQueueKey(row = {}) {
  if (row.id) return `id:${row.id}`;
  return [row.symbol, row.direction, row.at || row.detectedAt || row.queuedAt || "", row.movePct ?? "", row.source || ""].join("|");
}

function newsQueueKey(row = {}) {
  const identity = row.factId || row.eventId || row.id;
  if (identity) return `id:${identity}`;
  return [row.kind, row.sourceId, row.publishedAt || row.queuedAt || "", (row.symbols || []).join(",")].join("|");
}

function removeAcknowledgedRows(queue = [], acknowledged = [], keyFor) {
  const remainingCounts = new Map();
  for (const row of acknowledged) {
    const key = keyFor(row);
    remainingCounts.set(key, Number(remainingCounts.get(key) || 0) + 1);
  }
  return queue.filter((row) => {
    const key = keyFor(row);
    const count = Number(remainingCounts.get(key) || 0);
    if (!count) return true;
    remainingCounts.set(key, count - 1);
    return false;
  });
}

// A decision batch is a read-only lease. Pending facts remain durable until the
// Agent has both returned successfully and completed the trigger's business
// closure. Applying the symbol cap before the call prevents the fifth event from
// being acknowledged even though only four symbols received deterministic proof.
export function selectAgentDecisionBatch(input = {}) {
  const trigger = String(input.trigger || "scheduled_patrol");
  const triggeredWatches = input.triggeredWatches || [];
  const selectedWatchSymbols = new Set();
  for (const watch of triggeredWatches) {
    if (!watch?.symbol || selectedWatchSymbols.has(watch.symbol)) continue;
    if (selectedWatchSymbols.size >= MAX_EVENT_FOCUS_SYMBOLS) break;
    selectedWatchSymbols.add(watch.symbol);
  }
  return {
    trigger,
    fastMoves: trigger === "fast_move" ? (input.fastMoves || []).slice(0, MAX_FAST_MOVE_BATCH) : [],
    triggeredWatches: trigger === "watch_trigger"
      ? triggeredWatches.filter((watch) => selectedWatchSymbols.has(watch.symbol))
      : [],
    newsSignals: trigger === "news" ? (input.newsSignals || []).slice(0, MAX_NEWS_BATCH) : []
  };
}

export function agentDecisionRunSucceeded(run = {}) {
  return run.status === "completed" && run.decisionBlocked !== true
    && (!run.watchReviewClosure?.applicable || run.watchReviewClosure.ok === true);
}

export function settleAgentDecisionBatch(db, batch = {}, run = {}) {
  if (!agentDecisionRunSucceeded(run)) return { acknowledged: false, fastMoves: 0, watches: 0, news: 0 };
  db.system ||= {};
  let fastMoves = 0, watches = 0, news = 0;
  if (batch.trigger === "fast_move" && batch.fastMoves?.length) {
    db.system.pendingFastMoves = removeAcknowledgedRows(db.system.pendingFastMoves || [], batch.fastMoves, fastMoveQueueKey);
    fastMoves = batch.fastMoves.length;
  }
  if (batch.trigger === "watch_trigger" && batch.triggeredWatches?.length) {
    const ids = new Set(batch.triggeredWatches.map((watch) => watch.id).filter(Boolean));
    for (const watch of db.watchTriggers || []) {
      if (ids.has(watch.id)) {
        watch.triggerHandled = true;
        watches += 1;
      }
    }
  }
  if (batch.trigger === "news" && batch.newsSignals?.length) {
    db.system.pendingNewsSignals = removeAcknowledgedRows(db.system.pendingNewsSignals || [], batch.newsSignals, newsQueueKey);
    news = batch.newsSignals.length;
  }
  return { acknowledged: true, fastMoves, watches, news };
}

export async function runAgentCycle(db, payload = {}, saveDb) {
  const mandate = activeMandate(db);
  const provider = activeProvider();
  // 巡检开始先作废陈旧计划,避免后台把隔夜旧计划当成"待执行"误下单。
  expireStalePlans(db);
  const awaitingPlan = (db.tradePlans || []).find((plan) => plan.status === "awaiting_approval");

  // 前置巡检：同步授权交易对行情 + 刷新真实核算
  const queuedOpportunitySymbols = (db.system?.pendingOpportunitySignals || []).map((row) => row.symbol).filter(Boolean);
  const queuedNewsSymbols = (db.system?.pendingNewsSignals || []).flatMap((row) => row.symbols || []).filter(Boolean);
  const activeWatchSymbols = (db.watchTriggers || [])
    .filter((watch) => ["active", "pending_analysis", "triggered"].includes(watch.status))
    .map((watch) => watch.symbol)
    .filter(Boolean);
  const symbols = [...new Set([
    // 固定工作集必须先占满路由配额；触发候选随后追加。观察哨只能登记白名单币，
    // 因而去重后不会挤掉授权币。旧顺序在新闻/机会较多时会把白名单尾部截掉。
    ...(mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT"]),
    ...activeWatchSymbols,
    ...queuedOpportunitySymbols,
    ...queuedNewsSymbols
  ])].slice(0, 8);
  const syncedSymbols = [];
  const syncErrors = []; // 失败原因必须留痕:空 catch 会让"没有机会"和"系统看不到数据"混为一谈(外审 P1)
  await Promise.all(symbols.map(async (symbol) => {
    try {
      await syncPublicMarket(db, "OKX", symbol);
      syncedSymbols.push(symbol);
    } catch (error) {
      syncErrors.push(`${symbol}: ${String(error.message || error).slice(0, 80)}`);
    }
  }));
  if (syncErrors.length) appendTrace(db, "agent_cycle", `巡检行情同步失败 ${syncErrors.join("；")}`, "warning");
  const accounting = refreshAccounting(db);
  // 先给公开行情同步一次自愈机会，再按 SLO 裁定是否自动进入只减仓。
  // 否则调度刚启动时的旧缓存会在成功刷新前误触发永久人工解锁。
  applyOperationalDegradation(db, "AgentRuntime");

  // 先判大盘：全局大盘 + 首个交易对聪明钱（免费公开数据，容错，不阻断）
  let regime = null;
  try {
    regime = await fetchMarketRegime(symbols[0] || "BTC/USDT");
    db.marketRegime = {
    ...regime,
    global: regime.global || db.marketRegime?.global || null,       // 免费源 429 时保留上次好值
    smartMoney: regime.smartMoney || db.marketRegime?.smartMoney || null,
    updatedAt: nowIso()
  };
  } catch (error) {
    appendTrace(db, "agent_cycle", `大盘/聪明钱预取失败：${String(error.message || error).slice(0, 100)}（沿用上次快照）`, "warning");
  }
  const regimeSummary = [regime?.global?.interpretation, regime?.smartMoney?.ok ? regime.smartMoney.interpretation : null].filter(Boolean).join("；");

  // 先只窥视待处理事件；只有本轮确定进入 LLM 决策后才消费，
  // 避免熔断、待批准或临时缺少 provider 时丢失真实触发。
  let triggeredWatches = (db.watchTriggers || []).filter((w) => w.status === "triggered" && !w.triggerHandled);
  // 快速异动消费:哨兵探测到的急速涨跌,本轮消费掉并注入目标,让 AI 优先评估(用户实锤:ADA一小时跌4%没反应)
  let fastMoves = db.system.pendingFastMoves || [];
  // 早期机会引擎在 WebSocket/全市场快扫层先发现启动迹象；本轮只消费最强两个，
  // 避免把一次针对性分析又扩成全市场串行研究。
  let opportunitySignals = peekOpportunitySignals(db, 2);
  // 突发快讯/高影响日程只唤起“复核”，不是订单信号；与观察哨一样，只有真正进入
  // LLM 决策循环后才消费，锁冲突/无模型/熔断时不能静默丢失。
  let newsSignals = (db.system?.pendingNewsSignals || []).slice(0, 3);

  const decisionTrigger = fastMoves.length ? "fast_move"
    : triggeredWatches.length ? "watch_trigger"
    : newsSignals.length ? "news"
    : opportunitySignals.length ? "early_opportunity"
    : "scheduled_patrol";
  const decisionBatch = selectAgentDecisionBatch({
    trigger: decisionTrigger,
    fastMoves,
    triggeredWatches,
    newsSignals
  });
  const wakeEvaluation = evaluateAgentDecisionWake(db, {
    trigger: decisionTrigger,
    symbols,
    force: payload.forceDecision === true || Boolean(payload.goal),
    now: payload.now
  });

  const skipReasons = [];
  if (!db.system.autonomyEnabled) skipReasons.push("自主推进已暂停");
  if (db.system.killSwitch) skipReasons.push("熔断开启");
  if (!mandate) skipReasons.push("无激活授权");
  if (!provider) skipReasons.push("未配置 LLM");
  if (awaitingPlan) skipReasons.push(`已有待批准计划 ${awaitingPlan.id}，避免重复生成`);
  if (accounting.remainingDailyLossUsdt !== null && accounting.remainingDailyLossUsdt !== undefined && accounting.remainingDailyLossUsdt <= 0) {
    skipReasons.push("日亏损预算耗尽");
  }
  if (!skipReasons.length && !wakeEvaluation.shouldWake) {
    skipReasons.push(wakeEvaluation.reason === "material_change_cooling_down"
      ? "决策环境已有变化，但仍在合并冷却窗口；继续由代码监控，下一批次再统一分析"
      : "决策环境没有发生需要重新推理的变化；本轮仅完成数据巡检");
  }

  if (skipReasons.length) {
    const run = {
      id: id("run"),
      traceId: null,
      role: "AI 交易员",
      goal: payload.goal || "周期巡检",
      status: "patrol_only",
      source: "agent_cycle",
      steps: [
        { phase: "observe", summary: syncedSymbols.length ? `已同步 ${syncedSymbols.join("、")} 真实行情。` : "行情同步失败或无授权交易对。" },
        ...(fastMoves.length ? [{ phase: "fast_move", summary: `快速异动但本轮未进入 LLM 决策：${fastMoves.map((e) => `${e.symbol} ${e.windowMin}分钟${e.direction === "down" ? "跌" : "涨"}${e.movePct}%`).join("；")}。` }] : []),
        ...(opportunitySignals.length ? [{ phase: "opportunity", summary: `早期机会但本轮未进入 LLM 决策：${opportunitySignals.map((e) => `${e.symbol} ${e.direction} score=${e.score}`).join("；")}。` }] : []),
        ...(newsSignals.length ? [{ phase: "news", summary: `有 ${newsSignals.length} 条重要信息等待结构化复核（原始自由文本未进入任务指令）。` }] : []),
        ...(triggeredWatches.length ? [{ phase: "watch", summary: `观察哨触发但本轮未进入 LLM 决策：${triggeredWatches.map((w) => `${w.symbol} ${watchDirectionLabel(w)}｜原判断=${watchThesis(w)}｜条件=${describeWatch(w)}｜命中含义=${watchTriggerMeaning(w)}｜触发价 ${w.triggerPrice}`).join("；")}。` }] : []),
        ...(regimeSummary ? [{ phase: "regime", summary: `大盘/聪明钱：${regimeSummary}。` }] : []),
        { phase: "accounting", summary: `今日盈亏 ${accounting.todayPnl ?? "未知"} USDT，剩余亏损预算 ${accounting.remainingDailyLossUsdt ?? "未授权"}。` },
        { phase: "decision", summary: `本轮不进入 LLM 决策：${skipReasons.join("；")}。`, reason: wakeEvaluation.reason }
      ],
      decisionWake: {
        shouldWake: wakeEvaluation.shouldWake,
        reason: wakeEvaluation.reason,
        materialChanged: wakeEvaluation.materialChanged,
        ageMs: wakeEvaluation.ageMs
      },
      createdAt: nowIso()
    };
    run.traceId = run.id;
    db.agentRuns.unshift(run);
    appendTrace(db, "agent_cycle", `巡检（${skipReasons[0]}）`, "ok");
    if (saveDb) saveDb(db);
    return run;
  }

  // 只有确定进入真实 LLM 决策后才消费 pending；被熔断、待批准计划、预算耗尽等原因跳过时
  // 必须保留触发事实，避免“巡检跑过了但机会被静默吃掉”。
  // 同一时刻可能同时积累异动、观察哨、新闻和早期机会。每轮只消费最高优先级的一类，
  // 其它事实留在队列供下一次哨兵 tick 立即唤起；否则 goal、focusSymbols 与实际消费内容会错位，
  // 还会在一次昂贵调用里把互不相关的事件混在一起。
  triggeredWatches = decisionBatch.triggeredWatches;
  fastMoves = decisionBatch.fastMoves;
  opportunitySignals = decisionTrigger === "early_opportunity" ? consumeOpportunitySignals(db, 2) : [];
  newsSignals = decisionBatch.newsSignals;
  const analyzeNews = payload.analyzeQueuedNewsForDecision || analyzeQueuedNewsForDecision;
  const newsAnalysis = await analyzeNews(db, newsSignals, { allowedSymbols: symbols });
  newsSignals = newsAnalysis.signals || newsSignals;
  if (newsAnalysis.error) appendTrace(db, "news_decision_analysis", `API 新闻直接影响分析未完成：${newsAnalysis.error}（使用来源元数据降级）`, "warning");
  else if (newsAnalysis.requested) appendTrace(db, "news_decision_analysis", `直接分析 API 新闻 ${newsAnalysis.analyzed}/${newsAnalysis.requested} 条；未联网搜索`, "ok");

  // 完整决策循环：与对话入口共用 runAgentChat（工具、风控、审计全一致）
  const regimeBullets = regimeSummary ? regimeSummary.split(/[;；]\s*/).filter(Boolean).map((x) => `- ${x.trim()}`).join("\n") : "";
  // 标题带批次开始时间(北京时间),用户在长会话里靠它区分每轮巡检。
  const startedHhmm = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });
  const watchBullets = triggeredWatches.map((w) => `- watchId=${w.id}｜${w.symbol}｜${watchDirectionLabel(w)}｜原判断：${watchThesis(w)}｜价格命中条件：${describeWatch(w)}（触发价 ${w.triggerPrice}）｜待复核含义：${watchTriggerMeaning(w)}｜注意：这里只确认价格到位，不代表量能、收盘、形态或入场已确认`);
  const moveBullets = fastMoves.map((e) => `- ${e.symbol} ${e.windowMin} 分钟内${e.direction === "down" ? "快速下跌" : "快速上涨"} ${e.movePct}%（现价 ${e.price}，自${e.direction === "down" ? "高" : "低"}点 ${e.refPrice}）`);
  const opportunityBullets = opportunitySignals.map((e) => `- ${e.symbol} ${e.features?.setupType === "reversal_reclaim" ? "极值回收反转" : "早期动量启动"}${e.direction === "short" ? "偏空" : "偏多"}候选 score=${e.score} · 发现于 ${e.detectedAt || e.queuedAt}${e.features ? ` · 15s ${e.features.ret15sPct ?? "-"}% / 30s ${e.features.ret30sPct ?? "-"}% / 1m ${e.features.ret1mPct ?? "-"}%${e.features.reclaimPct != null ? ` · 极值回收 ${e.features.reclaimPct}%` : ` · 加速度 ${e.features.acceleration ?? "-"}`}` : ""}`);
  const newsBullets = newsSignals.map((signal) => `- ${newsSignalDescriptor(signal)}`);
  const goal = payload.goal
    || [
      fastMoves.length ? `【⚠ 快速异动 · ${startedHhmm}】` : triggeredWatches.length ? `【⚠ 观察哨触发 · ${startedHhmm}】` : newsSignals.length ? `【📰 重要信息复核 · ${startedHhmm}】` : opportunitySignals.length ? `【⚡ 早期机会 · ${startedHhmm}】` : `【定时巡检 · ${startedHhmm}】`,
      ...(moveBullets.length ? [...moveBullets, ""] : []),
      ...(watchBullets.length ? [...watchBullets, ""] : []),
      ...(opportunityBullets.length ? [...opportunityBullets, ""] : []),
      ...(newsBullets.length ? [...newsBullets, ""] : []),
      `- 授权白名单：${mandate.allowedSymbols.join("、")}`,
      `- 单笔风险上限 ${mandate.maxSingleTradeRiskPct}% · 日亏上限 ${mandate.maxDailyLossPct}% · 近7日亏损上限 ${mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? 5}%`,
      ...(regimeBullets ? ["", "【大盘与聪明钱 · 系统预取，可调用 get_global_market / get_microstructure 复核】", regimeBullets] : []),
      "",
      "【本轮任务】",
      ...(newsSignals.length
        ? [
          "1. 直接分析系统已通过 API/RSS 获取的事件影响：analysisStatus=api_analyzed 表示已用无联网模型做受控语义分类；本轮禁止再为这条事件联网搜索。trustTier 与 verifiedOrigin 仍决定来源可信度，语义分类不等于来源核验",
          "2. 再检查市场是否已经反应：同步关联币种行情、结构、成交量和微观结构；新闻本身绝不构成开仓理由，禁止仅凭标题直接提出交易",
          "3. 对高影响日程只做多/空/中性场景树；公布后必须核验实际值及第一反应，不得把日程当结果、不得猜测数据",
          "4. 只有新闻与可验证行情证据共同满足原有强制证据包和全部硬风控时，才可走原有计划流程；否则登记观察哨或继续观察",
          "5. 本轮只分析事件关联币种与现有持仓，不重复执行无关的全市场漏斗；开放世界背景使用系统低频批量研究缓存"
        ]
        : fastMoves.length
        ? [
          "1. 读取系统预执行的 sync_market、get_microstructure 与结构结果，复核这波急速涨跌是否伴随放量、订单簿失衡与结构破位（覆盖缺失时才重试对应工具）；消息面只读取系统低频批量研究缓存，不为本次异动临时联网搜索",
          "2. 顺势评估机会：急跌可评估做空或规避、急涨可评估做多或止盈；按授权边界与盈亏比决定是否 propose_trade_plan，不达标则说明原因",
          "3. 若判断后续还有关键触发位（如跌破某支撑加速），逐条 register_watch 登记让哨兵继续盯",
          "4. 全市场漏斗由代码预筛；只对本轮异动币和漏斗最强候选做深度复核"
        ]
        : triggeredWatches.length
        ? [
          "1. 优先复核触发币种：使用系统预执行的 sync_market / get_microstructure / analyze_market_structure 结果确认价格命中是否伴随闭合K线、量能、结构与微观证据；只有覆盖缺失时才重试对应工具",
          "2. 必须闭环：方向成立但仍等回踩/吞没/影线/放量/收盘确认时，propose_trade_plan 创建 armed 条件计划；确有硬阻断时，record_watch_review 引用真实 evidence ID 记录拒绝或失效。禁止仅以‘继续观察/确认不足’换价再挂同一逻辑",
          "3. 同时检查大盘环境和现有持仓冲突；不为一次观察哨触发重跑无关币种的完整分析"
        ]
        : opportunitySignals.length
        ? [
          "1. 这是代码全市场漏斗筛出的启动早期信号，不是已完成的交易结论：优先分析上述候选，不重复扫描整个市场",
          "2. 并行复核候选微观结构与角色感知多周期结构：日内看1H/15m/5m，波段看1D/4H/1H；消息面使用已有新鲜缓存，只有明确事件策略才允许等待联网归因",
          "3. 当前条件已适合入场则 propose_trade_plan immediate；结构明确但价格尚未到位则 propose_trade_plan armed，把完整入场/止损/止盈与触发条件提前武装；结构不够则 register_watch",
          "4. 不得因为它是早期信号就跳过强制证据包或任何硬风控"
        ]
        : [
          "1. 先判大盘：全局方向与情绪、大户/散户多空结构",
          "2. 再看个币：逐一检查授权交易对的行情、持仓与事件；消息面读取 API 情报与系统低频批量联网研究缓存，禁止逐币临时搜索",
          "3. 扩大视野找机会：读取系统预执行的 scan_market_opportunities 全市场漏斗及 Top 候选结构/微观复核；只有覆盖缺失时才重试对应工具。白名单内达标就走第 4 步，白名单外若确属优质机会则在汇总里明确建议加白（附方向、理由与建议授权参数）",
          "4. 只有出现明确符合授权边界、且不与大盘/聪明钱明显背离的机会才提出交易计划；否则简要说明为什么继续观察",
          "5. 关键触发条件（若跌破/若突破/若回踩）必须逐条调用 register_watch 工具登记（想盯 3 个就调 3 次），绝不能只在回复里画“观察哨一览”表格——写表不等于登记，哨兵不会盯，等于骗自己。登记完文字里一句“已登记 N 个观察哨”即可，不要展开。"
        ])
    ].join("\n");
  // 自动巡检全部归入固定会话:此前每次巡检都新建会话,15 分钟一个,历史会话被无限堆满。
  // 交易计划另有一等公民承载(待批准卡片/计划卡/审计链),用户手动对话保持独立会话。
  db.chatSessions ||= [];
  if (!db.chatSessions.some((c) => c.id === "chat_autocycle")) {
    db.chatSessions.unshift({ id: "chat_autocycle", title: "自主巡检 · 自动汇总", status: "active", system: true, createdAt: nowIso(), updatedAt: nowIso() });
  }
  const focusSymbols = [...new Set((fastMoves.length ? fastMoves.map((row) => row.symbol)
    : triggeredWatches.length ? triggeredWatches.map((row) => row.symbol)
    : newsSignals.length ? newsSignals.flatMap(newsSignalSymbols)
    : opportunitySignals.length ? opportunitySignals.map((row) => row.symbol)
    : symbols).filter(Boolean))].slice(0, 4);
  const result = await runAgentChat(db, {
    message: goal,
    sessionId: "chat_autocycle",
    decisionTrigger,
    symbols,
    focusSymbols,
    triggeredWatches: triggeredWatches.map(compactTriggeredWatch),
    supplementalContextEvidence: newsSignals.length ? { news: newsDecisionAnalysisEvidence(newsSignals) } : null,
    invocationContext: payload.invocationContext || systemAgentInvocation("agent_cycle_internal")
  }, saveDb);
  result.run.source = "agent_cycle";
  if (agentDecisionRunSucceeded(result.run)) {
    recordAgentDecisionWake(db, wakeEvaluation, result.run);
    result.run.decisionBatchSettlement = settleAgentDecisionBatch(db, decisionBatch, result.run);
  } else {
    // LLM 402/超时/熔断不是“事件已经分析”。把本轮提前消费的确定性队列恢复，下一次
    // 周期仍可继续处理；这也防止成本保护本身变成漏报器。
    if (opportunitySignals.length) {
      const current = db.system.pendingOpportunitySignals || [];
      const known = new Set(current.map((row) => row.candidateId));
      db.system.pendingOpportunitySignals = [...opportunitySignals.filter((row) => !known.has(row.candidateId)), ...current];
      for (const signal of opportunitySignals) {
        const candidate = (db.opportunityCandidates || []).find((row) => row.id === signal.candidateId);
        if (candidate?.status === "ANALYZING" && !candidate.planId) candidate.status = "DISCOVERED";
      }
    }
  }
  // runAgentChat 在返回前保存的是模型结果；队列确认/恢复与 wake 指纹发生在其后，必须再落盘一次。
  if (saveDb) saveDb(db);
  appendAudit(db, "定时自主巡检完成", result.run.id, "AgentCycle");
  return result.run;
}

// 巡检后复查最新执行中计划的风控（授权过期、预算变化等）
export function recheckActivePlanRisk(db) {
  // 计划时效清扫:awaiting/approved 超过 24h 自动过期(用户实锤:7 月 7 日的 approved 计划
  // 挂了 19 天仍可被执行;行情早已作废它,计划必须有保质期)。executing 不动(有真实仓位)。
  const EXPIRY_MS = 24 * 60 * 60 * 1000;
  for (const p of db.tradePlans || []) {
    if (!["awaiting_approval", "approved"].includes(p.status)) continue;
    const age = Date.now() - new Date(p.createdAt || 0).getTime();
    if (age > EXPIRY_MS) {
      p.status = "expired";
      p.expiredAt = nowIso();
      appendAudit(db, `计划超时自动过期(${Math.round(age / 3600000)}h 未成交):${p.symbol}`, p.id, "PlanExpiry", "info");
    }
  }
  const plan = (db.tradePlans || []).find((item) => ["approved", "executing", "awaiting_approval"].includes(item.status));
  if (!plan) return null;
  const risk = evaluateTradePlan(db, plan);
  if (!risk.passed && plan.status !== "risk_rejected") {
    // 去重：同一计划的风控复查失败只保留一条 open 事件，重复只更新时间与计数，避免每轮巡检刷屏。
    const existing = (db.riskIncidents || []).find(
      (item) => item.status === "open" && item.source === plan.id && String(item.title || "").includes("风控复查失败")
    );
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeenAt = nowIso();
      existing.title = `计划 ${plan.symbol} 风控复查失败：${risk.summary}`;
    } else {
      appendAudit(db, `执行中计划风控复查失败：${risk.summary}`, plan.id, "AgentCycle", "warning");
      appendTrace(db, "risk_check", `${plan.symbol} 复查失败`, "blocked");
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "high",
        status: "open",
        title: `计划 ${plan.symbol} 风控复查失败：${risk.summary}`,
        source: plan.id,
        tenantId: plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner",
        ownerUserId: plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null,
        count: 1,
        createdAt: nowIso(),
        lastSeenAt: nowIso()
      });
      refreshOwnerImprovementRegistry(db);
    }
  }
  return risk;
}

export function updateStateFile(db, name, content, options = {}) {
  const key = String(name || "").toUpperCase();
  if (!["USER", "AGENT", "HISTORY"].includes(key)) {
    throw new Error("Unknown state file");
  }
  db.agentStateFiles[key] ||= { id: `state_${key.toLowerCase()}`, title: `${key}.md`, content: "", updatedAt: nowIso() };
  db.agentStateFiles[key].content = content;
  db.agentStateFiles[key].updatedAt = nowIso();
  if (["USER", "AGENT"].includes(key)) markStateFilePromptDraft(key, db.agentStateFiles[key], options);
  appendAudit(db, `更新状态文件 ${key}.md`, db.agentStateFiles[key].id, "Memory Agent");
  appendTrace(db, "state_file", `更新 ${key}.md`);
  return db.agentStateFiles[key];
}

export function approveStateFile(db, name, options = {}) {
  const key = String(name || "").toUpperCase();
  const file = db.agentStateFiles?.[key];
  if (!file) throw new Error("State file not found");
  approveStateFilePromptArtifact(key, file, options);
  file.updatedAt = nowIso();
  appendAudit(db, `批准状态文件 ${key}.md 进入系统提示`, file.id, options.actor || "KnowledgeApprover", "warning");
  appendTrace(db, "state_file", `批准 ${key}.md 的哈希封印`, "ok");
  return file;
}

export function addMemoryItem(db, payload = {}) {
  const item = {
    id: id("mem"),
    layer: payload.layer || "episodic",
    title: payload.title || "新记忆",
    content: payload.content || "",
    tags: payload.tags || [],
    source: payload.source || "manual",
    promptTrust: "untrusted_user_data",
    mayEnterSystemPrompt: false,
    tenantId: payload.tenantId || "tenant_owner",
    createdByUserId: payload.createdByUserId || null,
    provenance: {
      origin: payload.provenance?.origin || "manual_or_api_memory",
      sourceId: payload.provenance?.sourceId || null,
      promotableToPromptAuthority: false
    },
    createdAt: nowIso()
  };
  db.memoryItems.unshift(item);
  appendAudit(db, "写入三层记忆", item.id, "Memory Agent");
  return item;
}
