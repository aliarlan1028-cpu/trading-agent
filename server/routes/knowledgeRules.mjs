// 知识概念/框架/规则 路由组（概念卡/理论框架/规则草案 CRUD/批准入风控/去重/运行时专家分析）——
// 从 index.mjs 按 registrar 范式迁出。规则批准=编译成结构化条件则硬拦截,否则仅注入提示词(显式告警);
// 去重先立即响应后台执行。依赖经 ctx 注入。
export function registerKnowledgeRuleRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, appendTrace, compileNaturalRiskCondition, validateConditionSpec, validateDynamicRiskAction, consolidateRuleProposals, broadcastRaw, runExpertAnalysis } = ctx;

  app.post("/api/knowledge/cards/concept", requirePermission("write:knowledge"), (req, res) => {
    const card = {
      id: id("concept"),
      name: req.body.name || "新概念",
      domain: req.body.domain || "综合",
      indicators: req.body.indicators || [],
      tradingMeaning: req.body.tradingMeaning || "待补充交易含义。",
      sourceRefs: req.body.sourceRefs || [],
      createdAt: nowIso()
    };
    db.knowledge.conceptCards.unshift(card);
    appendAudit(db, "创建概念卡", card.id, "AI 研究员");
    persist(res, card);
  });

  app.post("/api/knowledge/frameworks", requirePermission("write:knowledge"), (req, res) => {
    const framework = { id: id("fw"), name: req.body.name || "新理论框架", domain: req.body.domain || "综合", inputs: req.body.inputs || [], outputs: req.body.outputs || [], failureModes: req.body.failureModes || [], createdAt: nowIso() };
    db.knowledge.theoryFrameworks.unshift(framework);
    appendAudit(db, "创建理论框架", framework.id, "AI 研究员");
    persist(res, framework);
  });

  app.post("/api/knowledge/rules/proposals", requirePermission("write:knowledge"), (req, res) => {
    const rule = {
      id: id("rule"),
      name: req.body.name || "新交易规则草案",
      description: String(req.body.description || ""), // (审计 H4)此前不读,用户写的依据全部丢失
      category: String(req.body.category || ""),
      condition: String(req.body.condition || ""),
      level: req.body.level || "L2",
      status: "待审批",
      action: validateDynamicRiskAction(req.body.action || "notify") ? (req.body.action || "notify") : "notify",
      sourceRefs: req.body.sourceRefs || [],
      createdAt: nowIso()
    };
    db.knowledge.ruleProposals.unshift(rule);
    appendAudit(db, "提交知识规则草案", rule.id, "Rule Compiler");
    persist(res, rule);
  });

  app.post("/api/knowledge/rules/:id/approve", requirePermission("approve:knowledge_skill"), (req, res) => {
    const rule = db.knowledge.ruleProposals.find((item) => item.id === req.params.id);
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    rule.status = req.body.approved === false ? "已拒绝" : "已批准";
    rule.reviewedAt = nowIso();
    rule.reviewedBy = req.user?.name || db.user.name;
    let enforcementWarning = null;
    if (rule.status === "已批准") {
      const conditionSpec = rule.conditionSpec || compileNaturalRiskCondition(rule.condition);
      const conditionValidation = validateConditionSpec(conditionSpec);
      const action = validateDynamicRiskAction(rule.action) ? rule.action : "notify";
      if (!conditionValidation.valid) {
        // 显式告知：这条规则编译不成结构化条件，只会作为提示注入提示词、不会被风控引擎硬拦截。
        // 否则运维会以为"配上了就在拦"，实际是静默放行。
        enforcementWarning = "该规则的自然语言条件无法编译为结构化拦截条件，批准后仅注入 AI 提示词作纪律提醒，不会被风控引擎硬性拦截；如需硬拦截请在规则库补充结构化条件（conditionSpec）。";
        appendAudit(db, `知识规则「${rule.name}」批准为仅提示（条件不可编译，无硬拦截）`, rule.id, "RiskCompiler", "warning");
      }
      db.riskRules.unshift({
        id: `risk_from_${rule.id}`,
        name: rule.name,
        scope: "knowledge",
        level: rule.level,
        enabled: true,
        action,
        condition: rule.condition || "",
        conditionSpec: conditionValidation.valid ? conditionSpec : null,
        enforcementStatus: conditionValidation.valid ? (action === "notify" ? "notification_enforced" : "entry_enforced") : "advisory_uncompiled",
        description: `来自专家知识库规则 ${rule.id}${conditionValidation.valid ? "" : "；自然语言条件尚未编译，当前仅作提示"}`
      });
    }
    appendAudit(db, `${rule.status}知识规则`, rule.id, req.user?.name || db.user.name);
    persist(res, { ...rule, enforcementWarning });
  });

  app.delete("/api/knowledge/rules/:id", requirePermission("write:knowledge"), (req, res) => {
    const before = (db.knowledge.ruleProposals || []).length;
    db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).filter((r) => r.id !== req.params.id);
    if ((db.knowledge.ruleProposals || []).length === before) return res.status(404).json({ error: "Rule not found" });
    db.riskRules = (db.riskRules || []).filter((r) => r.id !== `risk_from_${req.params.id}`);
    appendAudit(db, "删除知识规则草案", req.params.id, db.user.name);
    persist(res, { removed: 1 });
  });

  // 一键去重（智能合并）：把同类别下语义重复的待审批草案用 LLM 合并成精简规范集，
  // 阈值冲突取更严格；已批准的一律保留。LLM 调用较慢（数十秒），先立即响应、后台执行，
  // 前端 15s 轮询会自动刷新结果。无 LLM 时退回按名称精确去重。
  app.post("/api/knowledge/rules/dedup", requirePermission("write:knowledge"), (_req, res) => {
    const pendingCount = (db.knowledge.ruleProposals || []).filter((r) => r.status !== "已批准").length;
    res.json({ message: "规则库去重进行中，稍后自动刷新", status: "processing", pending: pendingCount });
    consolidateRuleProposals(db)
      .then((r) => {
        if (r.method !== "llm") {
          // 无 LLM：退回按 类别+名称+依据 精确去重
          const norm = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}]/gu, "");
          const seen = new Set(); const kept = []; const removedIds = [];
          for (const rule of db.knowledge.ruleProposals || []) {
            const key = `${norm(rule.category)}|${norm(rule.name)}|${norm(rule.description).slice(0, 40)}`;
            if (rule.status === "已批准" || !seen.has(key)) { seen.add(key); kept.push(rule); } else removedIds.push(rule.id);
          }
          db.knowledge.ruleProposals = kept;
        }
        saveDb(db);
        try { broadcastRaw({ type: "knowledge_updated", status: "rules_deduped" }); } catch { /* SSE 可选 */ }
      })
      .catch((err) => { appendAudit(db, `规则库去重失败：${err.message}`, "rule_dedup", "System", "warning"); });
  });

  app.post("/api/knowledge/runtime-query", requirePermission("write:knowledge"), (req, res) => {
    const bundle = runExpertAnalysis(db, req.body);
    appendAudit(db, "生成运行时专家分析", bundle.id, "专家知识库");
    appendTrace(db, "analysis_bundle", `知识召回：${bundle.question}`);
    persist(res, bundle);
  });
}
