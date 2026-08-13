const clip = (value, max = 520) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const cleanLine = (value = "") => String(value)
  .replace(/^#{1,6}\s*/, "")
  .replace(/^>\s*/, "")
  .replace(/^[-*•]\s+/, "")
  .replace(/\*\*/g, "")
  .trim();

function firstSentence(value = "") {
  const text = cleanLine(value);
  const match = text.match(/^.*?[。！？!?]/);
  return clip(match?.[0]?.trim() || text, 180);
}

function baseSymbols(symbols = [], separator = "，") {
  const rows = [...new Set(symbols.map((symbol) => String(symbol || "").toUpperCase().split(/[\/-]/)[0]).filter(Boolean))];
  return rows.length ? rows.join(separator) : "未设置";
}

function isHeading(line = "") {
  return /^(?:#{1,6}\s+|【).+?(?:】)?$/.test(String(line).trim());
}

function isConclusionHeading(line = "") {
  return /^(?:#{1,6}\s*)?(?:结论|当前结论|巡检结论|决策结论|Conclusion|Decision)[:：]?$|^【(?:结论|当前结论|巡检结论|决策结论)】$/i.test(String(line).trim());
}

function labelValue(line = "", label) {
  const match = cleanLine(line).match(new RegExp(`^${label}[:：]\\s*(.+)$`, "i"));
  return match?.[1]?.trim() || "";
}

// 行情分析的结论必须在最上方稳定呈现为三行。提示词负责生成优质内容；本守卫负责
// 在模型偶发偏离格式时重新编排已有文字，不新增交易事实或凭空改变方向。
export function ensureAnalysisConclusionFormat(content = "", options = {}) {
  if (options.enabled === false || !String(content || "").trim()) return String(content || "").trim();
  const lines = String(content).replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  const firstConclusionHeading = lines.findIndex(isConclusionHeading);
  const headingAt = isConclusionHeading(lines[cursor]) ? cursor : firstConclusionHeading;
  const beforeSection = headingAt > 0 ? lines.slice(0, headingAt).join("\n").trim() : "";
  if (headingAt >= 0) cursor = headingAt;
  if (headingAt >= 0) cursor += 1;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;

  const existingWhitelist = labelValue(lines[cursor], "(?:白名单|Whitelist)");
  const existingSummary = labelValue(lines[cursor + 1], "(?:总结|Summary)");
  const existingConclusion = labelValue(lines[cursor + 2], "(?:结论|Conclusion)");
  let sectionEnd = cursor;
  let summary = existingSummary;
  let conclusion = existingConclusion;

  if (existingWhitelist && existingSummary && existingConclusion) {
    sectionEnd = cursor + 3;
  } else {
    const section = [];
    for (let index = cursor; index < lines.length; index += 1) {
      if (index > cursor && isHeading(lines[index])) break;
      if (lines[index].trim()) section.push(cleanLine(lines[index]));
      sectionEnd = index + 1;
    }
    const combined = clip(section
      .filter((line) => !/^(?:白名单|Whitelist)[:：]/i.test(line))
      .map((line) => line.replace(/^(?:总结|Summary)[:：]\s*/i, ""))
      .filter((line) => !/^(?:结论|Conclusion)[:：]/i.test(line))
      .join(" "));
    const explicitConclusion = section.map((line) => labelValue(line, "(?:结论|Conclusion)")).find(Boolean);
    conclusion = explicitConclusion || firstSentence(combined);
    summary = clip(combined.slice(conclusion.length).trim()) || combined;
  }

  summary ||= "本轮分析未形成可用摘要。";
  conclusion ||= "等待补齐证据后再作最终判断。";
  const prefix = options.language === "en"
    ? [`Whitelist: ${baseSymbols(options.whitelist || [], ", ")}`, `Summary: ${summary}`, `Conclusion: ${conclusion}`]
    : [`白名单：${baseSymbols(options.whitelist || [])}`, `总结：${summary}`, `结论：${conclusion}`];
  const afterSection = lines.slice(sectionEnd).join("\n").trim();
  const remainder = [beforeSection, afterSection].filter(Boolean).join("\n\n");
  return [...prefix, ...(remainder ? ["", remainder] : [])].join("\n");
}
