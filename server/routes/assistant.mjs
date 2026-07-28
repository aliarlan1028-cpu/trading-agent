// 悬浮 AI 助手路由组（状态总结 + 只读 copilot 问答）—— 从 index.mjs 按 registrar 范式迁出。
// 只读：只解读账户/行情/知识，绝不下单/改配置/生成计划，也不写「AI 交易员」会话历史。
// 只基于真实上下文回答、不编造数字、缺数据写「未同步」。依赖经 ctx 注入。
export function registerAssistantRoutes(app, ctx) {
  const { db, refreshAccounting, llmComplete, ragQuery, appendTrace } = ctx;

  app.post("/api/assistant/summarize", async (req, res) => {
    refreshAccounting(db);
    const pf = db.portfolio || {};
    const positions = db.positions || [];
    const sys = db.system || {};
    const awaitingPlans = (db.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status));
    const pendingActions = (db.pendingActions || []).filter((a) => !a.status || a.status === "pending");
    const openIncidents = (db.riskIncidents || []).filter((i) => i.status === "open");
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const runsToday = (db.agentRuns || []).filter((r) => new Date(r.createdAt) >= dayStart).length;
    const auditsToday = (db.auditLogs || []).filter((a) => new Date(a.createdAt) >= dayStart).length;
    const lastSnap = (db.accountSnapshots || [])[0];
    const digest = {
      account: {
        totalEquityUsdt: pf.totalEquityUsdt ?? null,
        todayPnl: pf.todayPnl ?? null,
        unrealizedPnl: pf.unrealizedPnl ?? null,
        positions: positions.length,
        lastSyncAt: lastSnap?.createdAt || null
      },
      autonomy: { enabled: sys.autonomyEnabled === true, killSwitch: sys.killSwitch === true, liveTrading: sys.liveTradingEnabled === true },
      todayActivity: { agentRuns: runsToday, auditEvents: auditsToday },
      todos: { plansAwaitingApproval: awaitingPlans.length, pendingActions: pendingActions.length },
      risk: { openIncidents: openIncidents.length, topIncident: openIncidents[0]?.title || null }
    };
    const facts = [
      `账户：总资产 ${digest.account.totalEquityUsdt ?? "未同步"} USDT，今日盈亏 ${digest.account.todayPnl ?? "未同步"} USDT，未实现 ${digest.account.unrealizedPnl ?? "未同步"} USDT，持仓 ${digest.account.positions} 个，最后同步 ${digest.account.lastSyncAt || "从未"}`,
      `自主：${digest.autonomy.killSwitch ? "已熔断" : digest.autonomy.enabled ? "自主运行中" : "已暂停"}，实盘写入 ${digest.autonomy.liveTrading ? "开启" : "关闭"}`,
      `今日活动：自主巡检 ${digest.todayActivity.agentRuns} 次，审计事件 ${digest.todayActivity.auditEvents} 条`,
      `待办：待批准计划 ${digest.todos.plansAwaitingApproval} 个，待确认操作 ${digest.todos.pendingActions} 个`,
      `风险：未处理告警 ${digest.risk.openIncidents} 条${digest.risk.topIncident ? `（最新：${digest.risk.topIncident}）` : ""}`
    ].join("\n");
    const system = "你是用户的交易系统助手。用中文把下面的系统状态总结成 3-5 条简洁要点（账户、自主状态、今日活动、待办、风险），并在最后给一句最该关注的行动建议。只基于给定事实，不要编造任何数字，不确定的写『未同步』。";
    let summary = null;
    try { summary = await llmComplete(facts, system); } catch { summary = null; }
    res.json({ summary: summary || facts, digest, llm: Boolean(summary) });
  });

  // 悬浮 AI 助手（只读 copilot）：只读账户/行情/知识回答问题，绝不下单/改配置/生成计划，
  // 也不写入「AI 交易员」的会话历史（不建 chatMessage/agentRun）——与交易员职责彻底分开。
  app.post("/api/assistant/chat", async (req, res) => {
    const question = String(req.body?.message || "").trim();
    if (!question) return res.status(400).json({ error: "问题不能为空" });
    try {
      refreshAccounting(db);
      const pf = db.portfolio || {};
      const sys = db.system || {};
      const positions = (db.positions || []).filter((p) => Number(p.size ?? p.pos ?? 0) !== 0);
      const awaiting = (db.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status)).length;
      const pending = (db.pendingActions || []).filter((a) => !a.status || a.status === "pending" || a.status === "awaiting_confirmation").length;
      const incidents = (db.riskIncidents || []).filter((i) => i.status === "open");
      const regime = db.marketRegime || {};
      const movers = (db.marketMovers?.movers || []).slice(0, 6).map((m) => `${m.symbol} ${m.changePct >= 0 ? "+" : ""}${m.changePct}%`).join("、");
      const contextText = [
        `账户：总资产 ${pf.totalEquityUsdt ?? "未同步"} USDT，今日盈亏 ${pf.todayPnl ?? "未同步"}，未实现 ${pf.unrealizedPnl ?? "未同步"}，持仓 ${positions.length} 个`,
        positions.length ? `持仓明细：${positions.map((p) => `${p.symbol} ${p.direction || ""} 浮盈 ${p.pnl ?? p.upl ?? "?"} ROI ${p.roiPct ?? "?"}%`).join("；")}` : "当前无持仓",
        `自主：${sys.killSwitch ? "已熔断" : sys.autonomyEnabled ? "自主运行中" : "已暂停"}，实盘写入 ${sys.liveTradingEnabled ? "开启" : "关闭"}`,
        `待办：待批准计划 ${awaiting}，待确认操作 ${pending}；未处理风险告警 ${incidents.length}${incidents[0] ? `（最新：${incidents[0].title || ""}）` : ""}`,
        regime.global || regime.smartMoney ? `大盘：${regime.global?.label || regime.global?.trend || "?"}${regime.smartMoney?.label ? ` · 聪明钱 ${regime.smartMoney.label}` : ""}` : "",
        movers ? `今日异动：${movers}` : ""
      ].filter(Boolean).join("\n");

      // 知识问答：轻量 RAG 召回相关片段做接地（服务端 chunk 有正文）。
      let knowledge = "";
      let citations = [];
      try {
        const bundle = await ragQuery(db, question, { topK: 4 });
        const refs = bundle.retrievedRefs || [];
        citations = refs.map((r) => r.citationLocator).filter(Boolean);
        const chunkById = new Map((db.knowledge?.chunks || []).map((c) => [c.id, c]));
        const snippets = refs.map((r) => { const c = chunkById.get(r.chunkId); return c ? `【${r.citationLocator}】${String(c.text || c.content || "").slice(0, 400)}` : null; }).filter(Boolean);
        if (snippets.length) knowledge = snippets.join("\n");
      } catch { /* 知识召回失败不阻断问答 */ }

      const system = "你是交易系统的【只读助手 copilot】。职责：帮用户理解账户状态、行情与知识库，做解读与建议。"
        + "你不能下单、撤单、改配置或生成交易计划——那是『AI 交易员』的职责；用户要执行交易/改授权时，引导他去主对话『AI 交易员』操作。"
        + "只依据下面给定的真实上下文与知识片段回答，不编造任何数字，不确定就说『未同步/未知』。用中文，简洁，可用 Markdown。";
      const prompt = `用户问题：${question}\n\n【系统只读上下文】\n${contextText}${knowledge ? `\n\n【相关知识片段】\n${knowledge}` : ""}`;
      let reply = null;
      try { reply = await llmComplete(prompt, system); } catch { reply = null; }
      appendTrace(db, "assistant_chat", question.slice(0, 60), reply ? "ok" : "warning", 0);
      res.json({ reply: reply || "助手暂时不可用（未配置模型或调用失败）。你可以先用上方的『总结状态 / 今日异动 / 持仓护航 / 待办』查看真实数据。", citations, llm: Boolean(reply) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
