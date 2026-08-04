// 海报路由组:把 AI 交易员的巡检分析翻译成英文,供前端渲染中/英双语海报(社交分享获客)。
// 只做文本翻译,不生成图片——图片在前端把设计好的海报模板导成 PNG。依赖经 ctx 注入。
export function registerPosterRoutes(app, ctx) {
  const { llmComplete, appendTrace, db } = ctx;

  // 把一段中文交易分析翻译成英文,尽量保留 Markdown 结构与交易术语。
  app.post("/api/posters/translate", async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text 不能为空" });
    if (text.length > 8000) return res.status(400).json({ error: "内容过长(上限 8000 字)" });
    const system = [
      "You are a professional crypto-derivatives trading translator.",
      "Translate the given Chinese trading analysis into fluent, professional English for a social-media audience.",
      "STRICT rules:",
      "- Preserve the Markdown structure exactly (headings, tables, bullet lists, bold, blockquotes, line breaks).",
      "- Keep all symbols, numbers, prices, percentages and tickers unchanged (e.g. BTC/USDT, 0.192, +3.5%, 2.14R).",
      "- Use standard trading terminology (e.g. 做多=Long, 做空=Short, 止损=Stop-loss, 止盈=Take-profit, 突破=Breakout, 回踩=Pullback, 结构=Structure, 微观=Microstructure, 观察哨=Watch/Alert).",
      "- Do NOT add, remove, or invent any facts. Output ONLY the translation, no preface or notes."
    ].join("\n");
    try {
      const translated = await llmComplete(text, system);
      if (!translated) {
        try { appendTrace(db, "poster_translate", "LLM 未返回", "warning", 0); } catch { /* 记录失败不阻断 */ }
        return res.status(503).json({ error: "翻译不可用(未配置模型或调用失败)" });
      }
      try { appendTrace(db, "poster_translate", `${text.length} 字翻译`, "ok", 0); } catch { /* noop */ }
      res.json({ translated: String(translated).trim(), llm: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
