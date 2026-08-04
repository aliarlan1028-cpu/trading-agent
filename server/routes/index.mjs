// 路由汇总入口：把已按 registrar 范式迁出的所有路由组集中注册。
// index.mjs 末尾只需一行 registerAllRoutes(app, ctx)。ctx 是所有组依赖的并集——
// 每个 register* 只解构自己需要的键，多余的键被忽略，因此传一个超集是安全的。
import { registerObservabilityRoutes } from "./observability.mjs";
import { registerMandateRoutes } from "./mandates.mjs";
import { registerEventRoutes } from "./events.mjs";
import { registerTaskRoutes } from "./tasks.mjs";
import { registerNotificationRoutes } from "./notifications.mjs";
import { registerPaperRoutes } from "./paper.mjs";
import { registerMcpRoutes } from "./mcp.mjs";
import { registerEventSourceRoutes } from "./eventSources.mjs";
import { registerSecurityConfigRoutes } from "./securityConfig.mjs";
import { registerPaymentRoutes } from "./payments.mjs";
import { registerStrategyRoutes } from "./strategy.mjs";
import { registerReviewRoutes } from "./review.mjs";
import { registerAdminUserRoutes } from "./adminUsers.mjs";
import { registerExchangeRoutes } from "./exchange.mjs";
import { registerRiskRoutes } from "./risk.mjs";
import { registerTradePlanRoutes } from "./tradePlans.mjs";
import { registerSkillRoutes } from "./skills.mjs";
import { registerMarketRoutes } from "./market.mjs";
import { registerTradingDataRoutes } from "./tradingData.mjs";
import { registerRealtimeRoutes } from "./realtime.mjs";
import { registerExecutionOrderRoutes } from "./executionOrders.mjs";
import { registerKnowledgeImportRoutes } from "./knowledgeImport.mjs";
import { registerKnowledgeSkillRoutes } from "./knowledgeSkills.mjs";
import { registerKnowledgeRuleRoutes } from "./knowledgeRules.mjs";
import { registerKnowledgeConvertRoutes } from "./knowledgeConvert.mjs";
import { registerAgentChatRoutes } from "./agentChatRoutes.mjs";
import { registerAgentRunRoutes } from "./agentRuns.mjs";
import { registerSystemRoutes } from "./system.mjs";
import { registerAssistantRoutes } from "./assistant.mjs";
import { registerPosterRoutes } from "./posters.mjs";
import { registerBehaviorProfileRoutes } from "./behaviorProfile.mjs";

export function registerAllRoutes(app, ctx) {
  registerObservabilityRoutes(app, ctx);
  registerMandateRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerTaskRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerPaperRoutes(app, ctx);
  registerMcpRoutes(app, ctx);
  registerEventSourceRoutes(app, ctx);
  registerSecurityConfigRoutes(app, ctx);
  registerPaymentRoutes(app, ctx);
  registerStrategyRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerAdminUserRoutes(app, ctx);
  registerExchangeRoutes(app, ctx);
  registerRiskRoutes(app, ctx);
  registerTradePlanRoutes(app, ctx);
  registerSkillRoutes(app, ctx);
  registerMarketRoutes(app, ctx);
  registerTradingDataRoutes(app, ctx);
  registerRealtimeRoutes(app, ctx);
  registerExecutionOrderRoutes(app, ctx);
  registerKnowledgeImportRoutes(app, ctx);
  registerKnowledgeSkillRoutes(app, ctx);
  registerKnowledgeRuleRoutes(app, ctx);
  registerKnowledgeConvertRoutes(app, ctx);
  registerAgentChatRoutes(app, ctx);
  registerAgentRunRoutes(app, ctx);
  registerSystemRoutes(app, ctx);
  registerAssistantRoutes(app, ctx);
  registerPosterRoutes(app, ctx);
  registerBehaviorProfileRoutes(app, ctx);
}
