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
}
