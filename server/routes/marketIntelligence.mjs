import {
  getDailyBrief,
  getFlowSnapshot,
  getMarketIntelligence,
  intelligenceStatus,
  refreshMarketIntelligence
} from "../marketIntelligence.mjs";
import { getOfficialCalendar } from "../officialCalendar.mjs";

export function registerMarketIntelligenceRoutes(app, ctx) {
  const { db, persist, requirePermission } = ctx;

  app.get("/api/market-intelligence/status", (_req, res) => res.json(intelligenceStatus(db)));

  app.get("/api/market-intelligence/facts", (req, res) => {
    const symbols = String(req.query.symbols || "").split(",").map((item) => item.trim()).filter(Boolean);
    const categories = String(req.query.categories || "").split(",").map((item) => item.trim()).filter(Boolean);
    res.json(getMarketIntelligence(db, { symbols, categories, horizonHours: req.query.horizonHours, limit: req.query.limit }));
  });

  app.get("/api/market-intelligence/daily", (req, res) => {
    const brief = getDailyBrief(db, req.query.date);
    if (!brief) return res.status(404).json({ error: "Daily Market Brief 尚未生成" });
    res.json(brief);
  });

  app.get("/api/market-intelligence/calendar", (req, res) => {
    res.json(getOfficialCalendar(db, {
      from: req.query.from ? new Date(req.query.from).getTime() : Date.now(),
      to: req.query.to ? new Date(req.query.to).getTime() : Date.now() + 7 * 86_400_000,
      importance: req.query.importance
    }));
  });

  app.get("/api/market-intelligence/flows", (_req, res) => res.json(getFlowSnapshot(db)));

  app.post("/api/market-intelligence/refresh", requirePermission("write:event"), async (_req, res) => {
    persist(res, await refreshMarketIntelligence(db));
  });
}
