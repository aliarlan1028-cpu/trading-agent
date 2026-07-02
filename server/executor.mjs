export function executeTradePlan(db, plan, riskResult) {
  if (!plan?.agentRunId && !plan?.agent_run_id) {
    return {
      status: "blocked",
      reason: "missing_agent_run_id",
      message: "真实执行必须由 AgentRun 驱动，不能从前端或工具直接执行。"
    };
  }
  if (!plan?.analysisBundleId && !plan?.analysis_bundle_id) {
    return {
      status: "blocked",
      reason: "missing_analysis_bundle_id",
      message: "真实执行必须绑定 AnalysisBundle 证据包。"
    };
  }
  if (!riskResult?.passed) {
    return {
      status: "rejected",
      message: "风控未通过，执行器拒绝下单。",
      riskCheckId: riskResult?.id
    };
  }

  if (!db.system.liveTradingEnabled) {
    return {
      status: "guarded",
      message: "真实交易写操作已关闭。计划通过风控，但不会向交易所提交订单。",
      clientOrderId: `dry_${Date.now().toString(36)}`,
      exchange: plan.exchange,
      symbol: plan.symbol
    };
  }

  return {
    status: "blocked",
    reason: "execution_engine_not_confirmed",
    message: "直接执行接口已禁用。真实提交必须由 ExecutionEngine 内部路径完成，并绑定 ExecutionOrder。",
    exchange: plan.exchange,
    symbol: plan.symbol
  };
}
