import React, { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { uiConfirm } from "./confirm.jsx";
import { executionExitAction, requestExecutionExit } from "./executionExit.js";
import { runShellRegistrySelection } from "./productShell.jsx";
import { agentChatRequestForSurface } from "./chatArchive.js";
import {
  AlertTriangle,
  Activity,
  ArrowUp,
  BarChart3,
  Bot,
  BrainCircuit,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  Hourglass,
  MessageSquare,
  Radar,
  RefreshCw,
  Rocket,
  Trash2,
  ListChecks,
  Plus,
  Shield,
  ShieldCheck,
  Target,
  TrendingUp,
  Wrench,
  XCircle,
  Download,
  Layers3,
  Sparkles,
  Clock3,
  Image as ImageIcon,
  X
} from "lucide-react";

import { apiUrl, displayMoney, displayPrice, displayPct, formatDateTime, formatTime, humanize, localizeText, marginUsage, authHeaders, smartMoneyBias, statusTone, StatusBadge, SymbolChips } from "./lib.jsx";
import { t } from "./i18n.js";
import { SITE_URL, SITE_QR } from "./siteQr.js";
import { hasFiniteNumber } from "./viewData.js";
import { buildPatrolView } from "./patrolView.js";

export function selectAgentTradePlan({ plan, ui } = {}) {
  if (!plan?.id) return null;
  return runShellRegistrySelection({
    candidate: { id: plan.id, type: "Trade plan" },
    onSelectObject: (candidate) => ui?.selectObject?.(candidate),
    onNavigate: (route, selected) => ui?.setActive?.(route, selected)
  });
}

export function AgentTradePlanButton({ plan, ui, children }) {
  return <button type="button" className="agPlanObject" data-shell-object-id={plan?.id} data-shell-object-type="Trade plan" onClick={() => selectAgentTradePlan({ plan, ui })}>{children}</button>;
}

// 模型按知识库提示会输出 [[n]] 引用编号(用于内部接地),对终端用户是噪音、且渲染成裸标记像 bug。
// 统一剥掉编号并清理残留的多余空格与中文标点前空格,让"超出了 [[2]] 建议的 3x"读成"超出了建议的 3x"。
function stripCitationMarkers(text = "") {
  return String(text)
    .replace(/\[\[\d+\]\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([，。、；：）】」』"])/g, "$1");
}

// 模型在工具调用后偶尔会留下“计划已武装。现在汇总全貌。”一类过程旁白。
// 这不是行情事实，也不是交易依据：展示层过滤它，原始消息仍完整保存在会话与审计记录中。
// 规则只匹配完整的过程句，不做关键词删除，避免误伤“状态：等待价格条件”等有用信息。
const PROCESS_NARRATION_PATTERNS = [
  /^(?:(?:✅|☑️|⚡)\s*)?(?:好的[，,。!！]?\s*)?(?:(?:交易|条件)?计划|条件)(?:均|全部)?(?:已|已经)武装[。.!！；;,，]?\s*(?:(?:现在|下面|接下来)(?:我来|将|开始)?(?:汇总|总结|梳理|呈现)(?:全貌|本轮|分析|结果|情况)?[。.!！]?)?$/,
  /^(?:现在|下面|接下来)(?:我来|将|开始)?(?:汇总|总结|梳理|呈现)(?:全貌|本轮|分析|结果|情况)?[。.!！]?$/,
  /^(?:工具调用|数据同步|行情同步)(?:均|全部)?(?:已|已经)?(?:完成|结束)[。.!！]?\s*(?:(?:现在|下面|接下来)(?:我来|将|开始)?(?:汇总|总结|梳理|呈现)(?:全貌|本轮|分析|结果|情况)?[。.!！]?)?$/,
  /^(?:the\s+)?(?:plan|setup|conditions?)(?:\s+(?:is|are|has\s+been|have\s+been))?\s+armed[.!]?\s*(?:(?:now|next|below),?\s*(?:i(?:'ll|\s+will)\s+)?(?:summari[sz]e|present|recap)(?:\s+(?:the\s+)?(?:full\s+picture|analysis|results?))?[.!]?)?$/i,
  /^(?:now|next|below),?\s*(?:i(?:'ll|\s+will)\s+)?(?:summari[sz]e|present|recap)(?:\s+(?:the\s+)?(?:full\s+picture|analysis|results?))?[.!]?$/i
];

// 用户正文保留事实含义，但不暴露审计 ID、枚举值和量化缩写。原始 content 从未被修改，
// 证据 ID、模型原文与工具轨迹仍保存在消息/审计层，需要时可在技术明细中核对。
function humanizeEvidenceStatus(value = "") {
  return String(value)
    .replace(/fresh\s*\/\s*passed/gi, t("数据新鲜度与校验均通过", "data is fresh and validation passed"))
    .replace(/stale\s*\/\s*failed/gi, t("数据陈旧且获取失败", "data is stale and retrieval failed"))
    .replace(/missing\s*\/\s*failed/gi, t("数据缺失且获取失败", "data is missing and retrieval failed"))
    .replace(/\bstale\b/gi, t("数据已陈旧", "data is stale"))
    .replace(/\bmissing\b/gi, t("数据缺失", "data is missing"))
    .replace(/\bfailed\b/gi, t("获取失败", "retrieval failed"))
    .replace(/\berror\b/gi, t("获取出错", "retrieval error"))
    .replace(/\bfresh\b/gi, t("数据为最新", "data is fresh"))
    .replace(/\bpassed\b/gi, t("校验通过", "validation passed"));
}

function humanizeAnalysisPresentation(text = "") {
  let value = String(text)
    .replace(/\\_/g, "_")
    .replace(/〔已按\s+ev:[^〕]*?更正；\s*([^〕]+)〕/gi, t("（已按最新市场事实校正；校正于 $1）", "(corrected using the latest market fact at $1)"))
    .replace(/\[(fresh\s*\/\s*passed)\s*[·,，]?\s*ev:[^\]]+\]/gi, t("（数据新鲜度与校验均通过）", "(data is fresh and validation passed)"))
    .replace(/\[(fresh)\s*[·,，]?\s*ev:[^\]]+\]/gi, t("（数据为最新）", "(data is fresh)"))
    .replace(/事实守卫[（(]\s*ev:[^，,）)]+[，,]\s*([^）)]+)[）)]/gi, t("事实校验（校验于 $1）", "fact validation (checked at $1)"))
    .replace(/事实守卫[（(]\s*ev:[^）)]+[）)]/gi, t("事实校验", "fact validation"))
    .replace(/\[([^\]]*?)[·,，]?\s*ev:[^\]]+\]/gi, (_match, prefix) => prefix?.trim() ? t(`（${humanizeEvidenceStatus(prefix.trim())}）`, `(${humanizeEvidenceStatus(prefix.trim())})`) : "")
    .replace(/\[ev:[^\]]+\]/gi, "")
    .replace(/\bev:[a-z_]+:[^，,；;\s）)\]]+/gi, "")
    .replace(/\bevb_[a-z0-9_-]+\b/gi, "")
    .replace(/\bLH\s*\/\s*LL\b/gi, t("高点和低点持续下移", "lower highs and lower lows"))
    .replace(/\bHH\s*\/\s*HL\b/gi, t("高点和低点持续上移", "higher highs and higher lows"))
    .replace(/\bBOS\s+down\s*@\s*([0-9.]+)/gi, t("跌破结构位 $1", "bearish structure break at $1"))
    .replace(/\bBOS\s+up\s*@\s*([0-9.]+)/gi, t("突破结构位 $1", "bullish structure break at $1"))
    .replace(/\bCHoCH\s+down\b/gi, t("结构转弱", "structure turned weaker"))
    .replace(/\bCHoCH\s+up\b/gi, t("结构转强", "structure turned stronger"));
  const terms = [
    [/\blong_build_crowded\b/gi, t("多头增仓且较拥挤", "crowded long build-up")],
    [/\bshort_build_crowded\b/gi, t("空头增仓且较拥挤", "crowded short build-up")],
    [/\bleverage_build_up\b/gi, t("杠杆堆积但价格尚未确认", "leverage is building without price confirmation")],
    [/\bprice_move_without_oi_confirmation\b/gi, t("价格移动但未获持仓量确认", "price move lacks open-interest confirmation")],
    [/\bdeleveraging_without_direction\b/gi, t("去杠杆但方向不明确", "deleveraging without a clear direction")],
    [/\blong_deleveraging\b/gi, t("多头去杠杆", "long deleveraging")],
    [/\bshort_covering\b/gi, t("空头回补反弹", "short-covering rebound")],
    [/\blong_build\b/gi, t("多头增仓", "long build-up")],
    [/\bshort_build\b/gi, t("空头增仓", "short build-up")],
    [/\bstable_or_mixed\b/gi, t("状态稳定或信号混合", "stable or mixed signals")],
    [/\bbullish_price_cvd\b/gi, t("价格与主动买盘同步转强", "price and aggressive buying are strengthening together")],
    [/\bbearish_price_cvd\b/gi, t("价格上涨但主动卖盘偏强", "price is rising while aggressive selling remains stronger")],
    [/\bcontinuation\b/gi, t("延续结构", "continuation structure")],
    [/\bpullback\b/gi, t("回调阶段", "pullback phase")],
    [/\bNEUTRAL\b/g, t("方向未确认", "direction unconfirmed")],
    [/\bS5\s*极低流动性/gi, t("极低流动性", "extremely low liquidity")],
    [/\bS5\b/g, t("极低流动性等级", "extremely low-liquidity tier")]
  ];
  for (const [pattern, label] of terms) value = value.replace(pattern, label);
  value = value
    .replace(/((?:证据)?状态\s*[:：]?\s*)(fresh\s*\/\s*passed|stale\s*\/\s*failed|missing\s*\/\s*failed|stale|missing|failed|error|fresh|passed)\b/gi, (_match, label, status) => `${label}${humanizeEvidenceStatus(status)}`)
    .replace(/事实守卫/g, t("事实校验", "fact validation"));
  return value
    .replace(/证据\s*[，,](?=\s*状态|\s*[。；;）)])/g, "")
    .replace(/证据\s*(?=状态)/g, "")
    .replace(/（\s*[,，、;；·]*\s*）/g, "")
    .replace(/（([^）]*?)[,，、;；·]\s*）/g, "（$1）")
    .replace(/[，,]\s*[，,]/g, "，")
    .replace(/\s+([，。、；：）】])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

export function cleanPresentationText(text = "") {
  const cleaned = humanizeAnalysisPresentation(text)
    .split("\n")
    .filter((line) => {
      const candidate = line.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim();
      return !PROCESS_NARRATION_PATTERNS.some((pattern) => pattern.test(candidate));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

// 只在句号等自然边界处分段；不摘要、不改写，也不强行切断数字、价位或英文长句。
function splitParagraphForReading(text = "", maxLength = 108) {
  return String(text).split("\n").flatMap((line) => {
    const value = line.trim();
    if (!value || value.length <= maxLength) return value ? [value] : [];
    const sentences = value.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [value];
    const chunks = [];
    let chunk = "";
    for (const sentence of sentences) {
      if (chunk && chunk.length + sentence.length > maxLength) {
        chunks.push(chunk.trim());
        chunk = sentence;
      } else {
        chunk += sentence;
      }
    }
    if (chunk.trim()) chunks.push(chunk.trim());
    return chunks;
  });
}

function renderInline(text = "") {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={index}>{part}</React.Fragment>
  );
}

function visualTone(text = "") {
  const value = String(text);
  if (/风险|警告|阻断|拒绝|失败|止损|亏损|回撤|不要|禁止|未配置|异常|risk|warning|blocked|rejected|failed|failure|error|unavailable|stop loss|drawdown|loss/i.test(value)) return "danger";
  if (/等待|观察|谨慎|不确定|授权|确认|未同步|建议|wait|watch|caution|uncertain|approval|confirm|pending|suggest/i.test(value)) return "warning";
  if (/机会|通过|正常|优势|盈利|止盈|完成|可执行|opportunity|passed|healthy|profit|take profit|complete|executable/i.test(value)) return "ok";
  return "neutral";
}

function sectionIcon(title = "") {
  if (/结论|判断|摘要|conclusion|decision|summary|core view/i.test(title)) return Target;
  if (/依据|数据|行情|指标|evidence|data|market|indicator/i.test(title)) return BarChart3;
  if (/风险|限制|注意|risk|limit|warning|caution/i.test(title)) return AlertTriangle;
  if (/下一步|计划|动作|执行|next|plan|action|execution/i.test(title)) return ListChecks;
  if (/机会|方向|趋势|opportunity|direction|trend/i.test(title)) return TrendingUp;
  return BrainCircuit;
}

function parseRichText(text = "") {
  const blocks = [];
  let paragraph = [];
  let bullets = [];
  let steps = [];
  let metrics = [];
  let tableLines = [];
  let checklist = [];

  function flushTable() {
    if (!tableLines.length) return;
    const rows = tableLines
      .map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
    const sepIdx = rows.findIndex((r) => r.length && r.every((c) => /^:?-{2,}:?$/.test(c) || /^:?-+:?$/.test(c)));
    let header = null;
    let body = rows;
    if (sepIdx === 0) { body = rows.slice(1); }
    else if (sepIdx > 0) { header = rows[sepIdx - 1]; body = rows.slice(sepIdx + 1); }
    body = body.filter((r) => r.some((c) => c !== ""));
    if (header || body.length) blocks.push({ type: "table", header, rows: body });
    tableLines = [];
  }
  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }
  function flushBullets() {
    if (bullets.length) {
      blocks.push({ type: "bullets", items: bullets });
      bullets = [];
    }
  }
  function flushSteps() {
    if (steps.length) {
      blocks.push({ type: "steps", items: steps });
      steps = [];
    }
  }
  function flushMetrics() {
    if (metrics.length) {
      blocks.push({ type: "metrics", items: metrics });
      metrics = [];
    }
  }
  function flushChecklist() {
    if (checklist.length) {
      blocks.push({ type: "checklist", items: checklist });
      checklist = [];
    }
  }
  function flushAll() {
    flushParagraph();
    flushBullets();
    flushSteps();
    flushMetrics();
    flushChecklist();
    flushTable();
  }

  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    // Markdown 水平分隔线(--- / *** / ___):模型偶尔会输出,渲染成裸文本很丑,直接当段落分隔吞掉。
    if (/^([-*_])\1{2,}$/.test(line.replace(/\s+/g, ""))) {
      flushAll();
      continue;
    }
    // 代码围栏(``` 或 ```lang):模型偶尔用它包住指标块,前端不渲染代码块,裸 ``` 会漏出来(用户实锤)。
    // 直接吞掉围栏行本身,里面的内容照常按富文本解析。
    if (/^`{3,}[a-zA-Z0-9_-]*$/.test(line)) {
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && (line.match(/\|/g) || []).length >= 2) {
      flushParagraph();
      flushBullets();
      flushSteps();
      flushMetrics();
      flushChecklist();
      tableLines.push(line);
      continue;
    }
    flushTable();
    const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^【(.+)】$/);
    if (heading) {
      flushAll();
      blocks.push({ type: "heading", text: heading[1].replace(/\*\*/g, "") });
      continue;
    }
    const strongHeading = line.match(/^\*\*([^*]{2,26})\*\*[:：]?$/);
    if (strongHeading) {
      flushAll();
      blocks.push({ type: "heading", text: strongHeading[1] });
      continue;
    }
    // 数据源异常和消息面降级属于需要先看到的上下文，单独做克制的提示块，
    // 避免与普通分析段落混在一起；不把常规风险描述一律卡片化。
    if (/^(?:⚠️?|🚨|❗)\s*/.test(line) || /(?:消息面|news|sentiment).*(?:失败|未知|不可用|failed|failure|unavailable|rate limited)/i.test(line)) {
      flushAll();
      blocks.push({ type: "notice", text: line.replace(/^(?:⚠️?|🚨|❗)\s*/, ""), tone: visualTone(line) });
      continue;
    }
    const numbered = line.match(/^(\d+)[.、)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      flushBullets();
      flushMetrics();
      flushChecklist();
      steps.push({ number: numbered[1], text: numbered[2] });
      continue;
    }
    const check = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (check) {
      flushParagraph();
      flushBullets();
      flushSteps();
      flushMetrics();
      checklist.push({ checked: check[1].toLowerCase() === "x", text: check[2], tone: visualTone(check[2]) });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushSteps();
      flushMetrics();
      flushChecklist();
      bullets.push({ text: bullet[1], tone: visualTone(bullet[1]) });
      continue;
    }
    const metric = line.match(/^(白名单|总结|结论|巡检范围|视野外候选|能力调用|本轮证据检查|方向|交易对|现价|价格|成本|浮盈|浮亏|PnL|区间位|结构|周期|入场|触发条件|失效条件|止损|止盈|风险|仓位|杠杆|置信度|状态|账户|持仓|事件|建议|动作|下一步|依据|Whitelist|Summary|Conclusion|Coverage|External Candidates|Capability Calls|Evidence checks this run|Direction|Pair|Price|Entry|Trigger|Invalidation|Stop(?: Loss)?|Take Profit|Risk|Position|Leverage|Confidence|Status|Account|Event|Action|Next Step|Evidence)[:：]\s*(.+)$/i);
    if (metric) {
      flushParagraph();
      flushBullets();
      flushSteps();
      flushChecklist();
      metrics.push({ label: metric[1], value: metric[2], tone: visualTone(line) });
      continue;
    }
    flushBullets();
    flushSteps();
    flushMetrics();
    flushChecklist();
    paragraph.push(line);
  }
  flushAll();
  return blocks.length ? blocks : [{ type: "paragraph", text }];
}

function posterSectionKind(title = "") {
  const value = String(title);
  if (/结论|摘要|总览|summary|conclusion|overview/i.test(value)) return "summary";
  if (/风险|警告|注意|risk|warning|caution/i.test(value)) return "risk";
  if (/持仓|仓位|position|portfolio/i.test(value)) return "position";
  if (/全市场|市场|market/i.test(value)) return "market";
  if (/依据|数据|指标|证据|evidence|data|indicator/i.test(value)) return "evidence";
  if (/下一步|动作|执行|计划|观察|action|next|execution|plan|watch/i.test(value)) return "action";
  if (/机会|方向|趋势|setup|opportunity|direction|trend/i.test(value)) return "opportunity";
  return "detail";
}

// 海报内容不是固定模板：仅按实际出现的 Markdown 标题动态分区，标题数量和正文长度均不设上限。
// 没有标题的内容仍原样进入引言区，避免为了排版而删改模型输出。
function groupPosterBlocks(blocks = []) {
  const groups = [];
  let current = { heading: null, blocks: [] };
  for (const block of blocks) {
    if (block.type === "heading") {
      if (current.heading || current.blocks.length) groups.push(current);
      current = { heading: block, blocks: [] };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.heading || current.blocks.length) groups.push(current);
  return groups;
}

function isFullMarketScanHeading(title = "") {
  return /全市场(?:机会|异动)?扫描|全市场[^\n]{0,18}候选|full[- ]?market scan|market-wide scan/i.test(String(title));
}

function RichBlock({ block, blockKey, onSuggest = null, poster = false }) {
  const isSuggestion = (t) => /[?？]\s*$/.test(String(t || "").trim());
  const cleanSuggest = (t) => String(t || "").replace(/\*\*/g, "").trim();

  if (block.type === "heading") {
    const Icon = sectionIcon(block.text);
    const kind = posterSectionKind(block.text);
    return <div className={`richHeading richHeading--${kind}`} key={blockKey}><i><Icon size={14} /></i><strong>{block.text}</strong></div>;
  }
  if (block.type === "notice") {
    return (
      <div className={`richNotice ${block.tone}`} key={blockKey}>
        <AlertTriangle size={15} />
        <span>{renderInline(block.text)}</span>
      </div>
    );
  }
  if (block.type === "table") {
    return (
      <div className="richTableWrap" key={blockKey}>
        <table className="richTable">
          {block.header && (
            <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
          )}
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "metrics") {
    const conclusionRows = block.items.some((item) => /^(白名单|总结|结论|Whitelist|Summary|Conclusion)$/i.test(item.label));
    return (
      <div className={`richMetricGrid ${conclusionRows ? "richMetricGrid--conclusion" : ""}`} key={blockKey}>
        {block.items.map((item, itemIndex) => (
          <div className={`richMetric ${item.tone} ${/^(白名单|总结|结论|Whitelist|Summary|Conclusion)$/i.test(item.label) ? "richMetric--conclusion" : ""}`} key={`${item.label}-${itemIndex}`}>
            <span>{item.label}</span>
            <b>{renderInline(item.value)}</b>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "bullets") {
    return (
      <div className="richBulletList" key={blockKey}>
        {block.items.map((item, itemIndex) => (
          onSuggest && isSuggestion(item.text)
            ? <button type="button" className="chatSuggestBtn" key={itemIndex} onClick={() => onSuggest(cleanSuggest(item.text))}><span>{renderInline(item.text)}</span><ChevronRight size={14} /></button>
            : (
              <div className={`richBullet ${item.tone}`} key={itemIndex}>
                <i>{item.tone === "danger" ? <AlertTriangle size={12} /> : item.tone === "ok" ? <CheckCircle2 size={12} /> : <span />}</i>
                <span>{renderInline(item.text)}</span>
              </div>
            )
        ))}
      </div>
    );
  }
  if (block.type === "checklist") {
    return (
      <div className="richChecklist" key={blockKey}>
        {block.items.map((item, itemIndex) => (
          <div className={`richCheck ${item.checked ? "checked" : "pending"} ${item.tone}`} key={itemIndex}>
            <i>{item.checked ? <CheckCircle2 size={14} /> : <span />}</i>
            <span>{renderInline(item.text)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "steps") {
    return (
      <div className="richSteps" key={blockKey}>
        {block.items.map((item, itemIndex) => (
          onSuggest && isSuggestion(item.text)
            ? <button type="button" className="chatSuggestBtn step" key={itemIndex} onClick={() => onSuggest(cleanSuggest(item.text))}><b>{item.number}</b><span>{renderInline(item.text)}</span><ChevronRight size={14} /></button>
            : (
              <div className="richStep" key={itemIndex}>
                <b>{item.number}</b>
                <span>{renderInline(item.text)}</span>
              </div>
            )
        ))}
      </div>
    );
  }

  const readingLines = String(block.text).split("\n").flatMap((sourceLine) => {
    const quote = sourceLine.match(/^>\s?(.*)$/);
    const chunks = splitParagraphForReading(quote ? quote[1] : sourceLine, poster ? 88 : 108);
    return quote ? chunks.map((chunk) => `> ${chunk}`) : chunks;
  });
  return readingLines.map((line, lineIndex) => {
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      // 核心结论保持普通正文。旧版把 Markdown 引用同时渲染成图标、底色和
      // 左侧竖线，叠在决策简报外框里会出现两道 quote bar，反而延迟阅读。
      return <p className="richParagraph richConclusion" key={`${blockKey}-${lineIndex}`}>{renderInline(quote[1])}</p>;
    }
    const emphasized = poster && /^\s*\*\*[^*]{1,32}[：:]/.test(line);
    return <p className={emphasized ? "richParagraph posterEmphasisLine" : "richParagraph"} key={`${blockKey}-${lineIndex}`}>{renderInline(line)}</p>;
  });
}

function RichMessage({ text = "", compact = false, onSuggest = null, poster = false }) {
  const blocks = parseRichText(cleanPresentationText(stripCitationMarkers(text)));

  if (poster) {
    const groups = groupPosterBlocks(blocks);
    return (
      <div className="richMessage posterRichMessage">
        {groups.map((group, groupIndex) => {
          const kind = group.heading ? posterSectionKind(group.heading.text) : "intro";
          return (
            <section className={`posterSection posterSection--${kind}`} key={groupIndex}>
              {group.heading && <RichBlock block={group.heading} blockKey={`${groupIndex}-heading`} poster />}
              <div className="posterSectionContent">
                {group.blocks.map((block, blockIndex) => (
                  <RichBlock block={block} blockKey={`${groupIndex}-${blockIndex}`} poster key={blockIndex} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  const groups = groupPosterBlocks(blocks);
  return (
    <div className={compact ? "richMessage compact" : "richMessage"}>
      {groups.map((group, groupIndex) => {
        const kind = group.heading ? posterSectionKind(group.heading.text) : "intro";
        return (
          <section className={`richMessageGroup richMessageGroup--${kind} ${group.heading && isFullMarketScanHeading(group.heading.text) ? "richMessageGroup--marketScan" : ""}`} key={groupIndex}>
            {group.heading && <RichBlock block={group.heading} blockKey={`${groupIndex}-heading`} onSuggest={onSuggest} />}
            {group.blocks.map((block, blockIndex) => <RichBlock block={block} blockKey={`${groupIndex}-${blockIndex}`} onSuggest={onSuggest} key={blockIndex} />)}
          </section>
        );
      })}
    </div>
  );
}

const DECISION_KIND_LABELS = {
  market_analysis: ["市场研判", "Market read"],
  watch_update: ["观察决策", "Watch decision"],
  trade_plan: ["交易计划", "Trade plan"],
  execution_update: ["执行进度", "Execution update"],
  position_management: ["持仓管理", "Position management"],
  risk_blocked: ["风控阻断", "Risk blocked"],
  closed_trade: ["平仓复盘", "Closed trade"],
  error: ["分析异常", "Analysis error"]
};

function decisionStateLabel(state = "") {
  const labels = {
    analysis_only: ["分析完成 · 未下单", "Analysis complete · no order"],
    watching: ["观察中 · 未下单", "Watching · no order"],
    draft: ["计划草案", "Plan draft"],
    awaiting_approval: ["待你批准 · 未下单", "Awaiting approval · no order"],
    armed: ["等待条件 · 未下单", "Waiting for conditions · no order"],
    approved: ["已批准 · 准备执行", "Approved · preparing execution"],
    created: ["执行单已创建 · 尚未提交", "Execution created · not submitted"],
    dry_run: ["模拟计算完成 · 未提交实盘", "Dry run complete · no live order"],
    executing: ["执行中", "Executing"],
    entry_pending: ["入场单已提交 · 等待成交", "Entry submitted · awaiting fill"],
    entry_filled: ["入场已成交", "Entry filled"],
    protecting: ["持仓中 · 保护单已布置", "Holding · protection placed"],
    closed: ["已平仓", "Closed"],
    risk_rejected: ["风控未通过 · 未下单", "Risk rejected · no order"],
    blocked: ["执行被阻断 · 未下单", "Execution blocked · no order"],
    setup_rejected: ["结构审核未过 · 未下单", "Setup rejected · no order"],
    protection_failed: ["保护单异常", "Protection failed"],
    triggered: ["观察条件已触发 · 正在重新分析", "Watch triggered · re-analysis running"],
    cancelled: ["已取消", "Cancelled"],
    expired: ["已过期", "Expired"],
    invalidated: ["已作废", "Invalidated"],
    superseded: ["已被最新分析取代", "Superseded by latest analysis"],
    failed: ["本轮失败", "Run failed"]
  };
  const pair = labels[state] || [humanize(state, "未知状态"), humanize(state, "Unknown")];
  return t(pair[0], pair[1]);
}

function decisionTone(state = "", direction = "neutral") {
  if (["risk_rejected", "blocked", "setup_rejected", "protection_failed", "failed"].includes(state)) return "danger";
  if (["awaiting_approval", "armed", "approved", "executing", "entry_pending", "watching"].includes(state)) return "warning";
  if (["entry_filled", "protecting", "closed"].includes(state)) return "ok";
  if (direction === "long") return "long";
  if (direction === "short") return "short";
  return "neutral";
}

function directionLabel(direction = "neutral") {
  if (direction === "long") return t("偏多", "Long bias");
  if (direction === "short") return t("偏空", "Short bias");
  return t("中性", "Neutral");
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Math.abs(number) >= 1_000_000 ? `${(number / 1_000_000).toFixed(1)}M`
    : Math.abs(number) >= 1_000 ? `${(number / 1_000).toFixed(1)}K`
      : number.toFixed(Math.abs(number) < 10 ? 2 : 0);
}

function executionStageState(status, stage) {
  const entryDone = ["entry_filled", "protecting", "closed", "protection_failed"].includes(status);
  const terminalFailure = ["blocked", "failed", "setup_rejected", "cancelled"].includes(status);
  if (stage === "plan") return terminalFailure ? "error" : "done";
  if (stage === "entry") {
    if (entryDone) return "done";
    if (terminalFailure) return "error";
    if (["created", "approved", "executing", "entry_pending"].includes(status)) return "active";
    return "pending";
  }
  if (stage === "protection") {
    if (status === "protection_failed") return "error";
    if (["protecting", "closed"].includes(status)) return "done";
    if (status === "entry_filled") return "active";
    return "pending";
  }
  if (stage === "closed") return status === "closed" ? "done" : "pending";
  return "pending";
}

function protectionLabel(protection, status) {
  if (protection === "stop_only") return t("仅止损保护", "Stop only");
  if (protection?.attachedAlgoStop) return t("原生止损已附加", "Native stop attached");
  if (protection) return t("保护单已布置", "Protection placed");
  if (status === "protecting") return t("保护单已布置", "Protection placed");
  if (status === "protection_failed") return t("保护异常", "Protection failed");
  return t("尚未布置", "Not placed");
}

function ExecutionSnapshot({ execution }) {
  if (!execution) return null;
  const confirmedNetPnl = hasFiniteNumber(execution.netRealizedPnl)
    ? Number(execution.netRealizedPnl)
    : /net/i.test(String(execution.financialBasis || "")) && hasFiniteNumber(execution.realizedPnl) ? Number(execution.realizedPnl) : null;
  const displayGrossPnl = hasFiniteNumber(execution.grossRealizedPnl)
    ? Number(execution.grossRealizedPnl)
    : confirmedNetPnl == null && hasFiniteNumber(execution.realizedPnl) ? Number(execution.realizedPnl) : null;
  const stages = [
    ["plan", t("计划", "Plan")],
    ["entry", t("入场", "Entry")],
    ["protection", t("保护", "Protection")],
    ["closed", t("平仓", "Close")]
  ];
  return (
    <section className="decisionExecution" aria-label={t("执行进度", "Execution progress")}>
      <div className="decisionSectionLabel"><Activity size={12} /> {t("真实执行进度", "Live execution progress")}<b>{decisionStateLabel(execution.status)}</b></div>
      <div className="decisionTimeline">
        {stages.map(([key, label]) => {
          const stageState = executionStageState(execution.status, key);
          return <div className={stageState} key={key}><i>{stageState === "done" ? <CheckCircle2 size={12} /> : stageState === "error" ? <XCircle size={12} /> : stageState === "active" ? <Hourglass size={12} /> : null}</i><span>{label}</span></div>;
        })}
      </div>
      <div className="decisionExecutionFacts">
        <span><small>{t("数量", "Quantity")}</small><b className="mono">{compactNumber(execution.quantity)}</b></span>
        <span><small>{t("名义价值", "Notional")}</small><b className="mono">{execution.notionalUsdt != null ? `${displayMoney(execution.notionalUsdt)} USDT` : "—"}</b></span>
        <span><small>{execution.filledPrice != null ? t("实际成交均价", "Average fill") : t("计划入场参考", "Planned entry")}</small><b className="mono">{displayPrice(execution.filledPrice ?? execution.plannedEntryPrice)}</b></span>
        <span><small>{t("保护状态", "Protection")}</small><b>{protectionLabel(execution.protection, execution.status)}</b></span>
        {confirmedNetPnl != null ? <span><small>{t("净已实现盈亏", "Net realized PnL")}</small><b className={`mono ${confirmedNetPnl >= 0 ? "positive" : "negative"}`}>{displayMoney(confirmedNetPnl)} USDT</b></span> : displayGrossPnl != null ? <span><small>{t("价格毛盈亏", "Gross price PnL")}</small><b className="mono">{displayMoney(displayGrossPnl)} USDT · {t("成本待对账", "costs pending")}</b></span> : null}
      </div>
    </section>
  );
}

function PositionSnapshot({ position, live = false }) {
  if (!position) return null;
  return (
    <section className="decisionPosition" aria-label={t("当前仓位", "Current position")}>
      <div className="decisionSectionLabel"><ShieldCheck size={12} /> {live ? t("当前真实仓位", "Current live position") : t("回复生成时仓位快照", "Position snapshot at reply time")}</div>
      <div className="decisionPositionGrid">
        <span><small>{t("方向 / 数量", "Side / size")}</small><b className={position.direction === "short" ? "negative" : position.direction === "long" ? "positive" : ""}>{directionLabel(position.direction)} · <i className="mono">{compactNumber(position.size)}</i></b></span>
        <span><small>{t("入场均价", "Entry")}</small><b className="mono">{displayPrice(position.entryPrice)}</b></span>
        <span><small>{t("标记价格", "Mark")}</small><b className="mono">{displayPrice(position.markPrice)}</b></span>
        <span><small>{t("未实现盈亏", "Unrealized PnL")}</small><b className={`mono ${position.unrealizedPnl == null ? "" : Number(position.unrealizedPnl) >= 0 ? "positive" : "negative"}`}>{position.unrealizedPnl != null ? `${displayMoney(position.unrealizedPnl)} USDT` : "—"}</b></span>
        <span><small>{t("杠杆", "Leverage")}</small><b className="mono">{position.leverage != null ? `${position.leverage}×` : "—"}</b></span>
      </div>
    </section>
  );
}

export function DecisionBrief({ presentation, content = "", currentState = null, currentExecution = undefined, currentPosition = undefined, isLatest = true, onSuggest = null }) {
  if (!presentation || presentation.layout !== "decision_brief") return <RichMessage text={content} onSuggest={onSuggest} />;
  const decision = presentation.decision || {};
  const snapshotState = decision.state || "analysis_only";
  const state = currentState || snapshotState;
  const tone = decisionTone(state, decision.direction);
  const kindPair = DECISION_KIND_LABELS[presentation.kind] || DECISION_KIND_LABELS.market_analysis;
  const stateChanged = currentState && currentState !== snapshotState;
  const generatedAt = presentation.generatedAt ? formatDateTime(presentation.generatedAt) : "";
  const symbols = presentation.symbols || (presentation.symbol ? [presentation.symbol] : []);
  const cleanedContent = cleanPresentationText(content);
  const headline = String(presentation.headline || "").trim();
  const contentAlreadyHasHeadline = headline && cleanedContent.includes(headline);
  const execution = currentExecution === undefined ? presentation.execution : currentExecution;
  const position = currentPosition === undefined ? presentation.position : currentPosition;

  return (
    <div className={`decisionBrief decisionBrief--narrative ${tone}`}>
      <header className="decisionBriefHead">
        <div className="decisionBriefIdentity">
          <span className="decisionKind"><Layers3 size={12} /> {t(kindPair[0], kindPair[1])}</span>
          {presentation.symbol && <b className="decisionSymbol mono">{presentation.symbol}</b>}
          {symbols.length > 1 && <span className="decisionMultiSymbols" title={symbols.join(" · ")}>{`+${symbols.length - 1} ${t("币种", "markets")}`}</span>}
          {decision.role && <span className="decisionRole">{decision.role === "day_trader" ? t("日内", "Day") : t("波段", "Swing")}</span>}
          {decision.primaryTimeframe && <span className="decisionRole mono">{decision.primaryTimeframe.toUpperCase()}</span>}
        </div>
        <div className="decisionBriefMeta">
          <div className="decisionBadges">
            <span className={`decisionDirection ${decision.direction || "neutral"}`}>{directionLabel(decision.direction)}</span>
            <span className={`decisionState ${tone}`}>{decisionStateLabel(state)}</span>
          </div>
          <div className="decisionFreshness">
            <Clock3 size={11} />
            <span>{isLatest ? t("最新分析", "Latest") : t("历史快照", "Snapshot")}</span>
            {generatedAt && <time>{generatedAt}</time>}
          </div>
        </div>
      </header>

      {stateChanged && (
        <div className="decisionStateChanged">
          <Activity size={13} />
          <span>{t("生成时", "Generated")}：{decisionStateLabel(snapshotState)}；{t("当前", "now")}：{decisionStateLabel(currentState)}</span>
        </div>
      )}
      {!contentAlreadyHasHeadline && headline && <p className="decisionFallbackHeadline">{headline}</p>}
      <div className="decisionNarrative"><RichMessage text={cleanedContent} onSuggest={onSuggest} /></div>
      {execution && <ExecutionSnapshot execution={execution} />}
      {position && <PositionSnapshot position={position} live={currentPosition !== undefined} />}
    </div>
  );
}

// 执行状态标签在渲染时取 t()，语言切换（key=lang 重挂载）才能生效；模块级常量不会重算。
function executionLabel(status) {
  const map = {
    dry_run: t("干跑完成（实盘关闭）", "Dry run done (live off)"),
    entry_pending: t("入场单挂单中", "Entry order pending"),
    entry_filled: t("入场已成交", "Entry filled"),
    protecting: t("止盈止损已布置", "TP/SL placed"),
    closed: t("已平仓", "Closed"),
    cancelled: t("已取消", "Cancelled"),
    blocked: t("被安全闸拦截", "Blocked by safety gate"),
    failed: t("提交失败", "Submit failed"),
    setup_rejected: t("结构审核未过 · 未下单", "Setup rejected · no order"),
    protection_failed: t("保护单布置失败", "Protection order failed")
  };
  return map[status] || status;
}

export function buildCurrentExecutionSnapshot(data = {}, linked = {}) {
  if (!linked.executionOrderId && !linked.planId) return undefined;
  const order = (data.executionOrders || []).find((item) => item.id === linked.executionOrderId || item.planId === linked.planId);
  if (!order) return undefined;
  const fills = (data.fills || []).filter((item) => item.executionOrderId === order.id || (!item.executionOrderId && item.tradePlanId === linked.planId));
  const entries = fills.filter((item) => item.kind === "entry" && hasFiniteNumber(item.price) && hasFiniteNumber(item.quantity));
  const entryQty = entries.reduce((sum, item) => sum + Math.abs(Number(item.quantity)), 0);
  const entryNotional = entries.reduce((sum, item) => sum + Math.abs(Number(item.price) * Number(item.quantity)), 0);
  const suppliedLifecycle = (Array.isArray(data.closedTradeLifecycles) ? data.closedTradeLifecycles : []).find((item) => item.tradeLifecycleKey === order.id
    || item.key === order.id
    || item.executionOrderId === order.id
    || (linked.planId && (item.tradePlanId === linked.planId || item.planId === linked.planId)));
  const lifecycles = suppliedLifecycle ? [suppliedLifecycle] : [];
  const grossRealizedPnl = lifecycles.length && lifecycles.every((lifecycle) => hasFiniteNumber(lifecycle.realizedPnl))
    ? lifecycles.reduce((sum, lifecycle) => sum + Number(lifecycle.realizedPnl), 0)
    : hasFiniteNumber(order.realizedPnl) ? Number(order.realizedPnl) : null;
  const netRealizedPnl = lifecycles.length && lifecycles.every((lifecycle) => hasFiniteNumber(lifecycle.netRealizedPnl))
    ? lifecycles.reduce((sum, lifecycle) => sum + Number(lifecycle.netRealizedPnl), 0)
    : null;
  return {
    status: order.status || null,
    quantity: order.quantity ?? null,
    notionalUsdt: order.notionalUsdt ?? null,
    filledPrice: entryQty > 0 ? entryNotional / entryQty : order.filledPrice ?? null,
    plannedEntryPrice: order.entryPrice ?? null,
    grossRealizedPnl,
    netRealizedPnl,
    // 旧卡片读取 realizedPnl；只有完整生命周期净值可写入，禁止用执行单毛值冒充。
    realizedPnl: netRealizedPnl,
    financialBasis: netRealizedPnl == null && grossRealizedPnl != null ? "gross_only_costs_unreconciled" : lifecycles.length ? "completed_trade_lifecycle/net_recorded_costs" : null,
    protection: order.protection || null,
    updatedAt: order.updatedAt || order.completedAt || order.createdAt || null
  };
}

export function PlanCard({ plan, executionOrder, action, ui, markets, data }) {
  if (!plan) return null;
  const risk = plan.lastRiskCheck || {};
  const checks = risk.checks || [];
  const passedCount = checks.filter((check) => check.passed).length;
  const [showChecks, setShowChecks] = useState(false);
  const awaiting = plan.status === "awaiting_approval";
  // 计划新鲜度:现价已越过止损的做多/做空计划已失效,批准必被风控复查拒绝(且会一开仓即触发止损)——
  // 直接在卡上禁用"批准计划"并说明原因,别让用户点了才被拒。
  const nowPrice = Number((markets || []).find((m) => m.symbol === plan.symbol)?.price);
  const stopVal = Number(plan.stopLoss ?? plan.stop_loss);
  const isShort = String(plan.direction).toLowerCase() === "short";
  const stopCrossed = Number.isFinite(nowPrice) && nowPrice > 0 && Number.isFinite(stopVal) && (isShort ? nowPrice >= stopVal : nowPrice <= stopVal);
  const invalidForApproval = stopCrossed || plan.status === "expired";
  const armedSetup = (data?.armedSetups || []).find((setup) => setup.id === plan.armedSetupId || setup.planId === plan.id);
  const scenarioStages = armedSetup?.scenario?.stages || plan.scenario?.stages || [];
  const scenarioStageIndex = Number(armedSetup?.scenario?.currentStageIndex ?? plan.scenario?.currentStageIndex ?? 0);
  const scenarioStage = scenarioStages[scenarioStageIndex];
  const scenarioProgress = scenarioStages.length > 1 ? `${scenarioStageIndex + 1}/${scenarioStages.length} · ${scenarioStage?.label || t("等待当前阶段", "Waiting for current stage")}` : null;
  const waitingState = armedSetup?.status === "FAST_VALIDATING"
    ? t("正在刷新行情、账户与风控（尚未提交订单）", "Refreshing market, account, and risk checks (no order submitted yet)")
    : armedSetup?.status === "TRIGGERED"
      ? t("价格条件已达到，正在执行前复核（尚未提交订单）", "Price condition reached; running pre-trade checks (no order submitted yet)")
      : armedSetup?.confirmationPending
        ? t("价格已进入目标区，等待K线确认（尚未提交订单）", "Price reached the target zone; waiting for candle confirmation (no order submitted yet)")
        : t("系统正在等待价格条件（尚未向 OKX 下单）", "Waiting for the price condition (no OKX order placed)");
  const currentProtection = data?.system?.tradeProtections;
  const executionSnapshot = executionOrder ? buildCurrentExecutionSnapshot(data, { executionOrderId: executionOrder.id, planId: plan.id }) : null;
  return (
    <div className={`chatPlanCard ${risk.passed ? "" : "rejected"}`}>
      <header>
        <b>{plan.symbol}</b>
        <span className={plan.direction === "short" ? "negative" : "positive"}>{plan.direction === "short" ? t("做空", "Short") : t("做多", "Long")}</span>
        <StatusBadge tone={awaiting ? "warning" : statusTone(plan.status)}>{humanize(plan.status)}</StatusBadge>
        {plan.outOfWhitelist && <span className="evBadge warn" title={t("该币不在授权白名单，确认即一次性授权本笔交易，不会加入常驻白名单", "This coin is not on the whitelist; confirming authorizes only this single trade and does not add it to the standing whitelist")}>⚠ {t("白名单外 · 一次性授权", "Off whitelist · one-time")}</span>}
        {stopCrossed && <span className="evBadge neg">{t("已失效 · 现价越过止损", "Void · price crossed stop")}</span>}
        <small>{plan.traderRole === "day_trader" ? t("日内交易", "Day trade") : plan.traderRole === "swing_trader" ? t("波段交易", "Swing trade") : plan.strategy ? humanize(plan.strategy) : ""} {plan.leverage ? `· ${plan.leverage}x` : ""}</small>
      </header>
      <div className="planNumbers">
        <span><small>{t("入场区间", "Entry zone")}</small><b>{plan.entry?.range || "-"}</b></span>
        <span><small>{t("止损", "Stop")}</small><b className="negative">{displayPrice(plan.stopLoss)}</b></span>
        <span><small>{t("止盈", "Take profit")}</small><b className="positive">{(plan.takeProfit || []).map((tp) => displayPrice(tp)).join(" / ") || "-"}</b></span>
        <span><small>{t("单笔风险", "Per-trade risk")}</small><b>{plan.entry?.riskPercent ?? plan.max_loss_pct ?? "-"}%</b></span>
      </div>
      <button className="riskSummaryRow" onClick={() => setShowChecks((current) => !current)}>
        {risk.passed
          ? <CheckCircle2 size={15} className="positive" />
          : <XCircle size={15} className="negative" />}
        <span>{t("该计划最近一次风控快照", "Latest risk snapshot for this plan")} · {passedCount}/{checks.length} {t("通过", "passed")} · {risk.summary || t("未检查", "not checked")}</span>
        <ChevronDown size={14} style={{ transform: showChecks ? "rotate(180deg)" : "none" }} />
      </button>
      {showChecks && (
        <div className="riskCheckList">
          {currentProtection?.cooldown && (
            <div className={currentProtection.cooldown.active ? "failed" : ""}>
              {currentProtection.cooldown.active ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
              <span>{t("当前账户保护", "Current account protection")}</span>
              <small>{t("连续亏损", "Consecutive losses")} {currentProtection.cooldown.streak}/{currentProtection.cooldown.maxLosses} · {currentProtection.cooldown.active ? t("冷却中", "cooldown active") : t("未触发", "not active")}</small>
            </div>
          )}
          {checks.map((check) => (
            <div key={check.name} className={check.passed ? "" : "failed"}>
              {check.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <span>{check.name}</span>
              <small>{check.detail}</small>
            </div>
          ))}
        </div>
      )}
      {plan.smartMoneyAlignment && plan.smartMoneyAlignment.alignment !== "neutral" && (
        <div className={`smAlignRow ${plan.smartMoneyAlignment.alignment}`}>
          {plan.smartMoneyAlignment.alignment === "favor" ? <TrendingUp size={14} /> : <AlertTriangle size={14} />}
          <span>{t("聪明钱", "Smart money")}{plan.smartMoneyAlignment.alignment === "favor" ? t("支持该方向", " favors this side") : t("与该方向相悖", " opposes this side")}</span>
          <small>{(plan.smartMoneyAlignment.reasons || []).join("；")}</small>
        </div>
      )}
      {plan.status === "armed" && plan.armedTrigger && (
        <div className="planHint">
          ⚡ {waitingState}{scenarioProgress ? ` · ${scenarioProgress}` : ""} · {plan.armedTrigger.kind === "price_above"
            ? `${t("等待向上穿越", "Waiting to cross above")} ${displayPrice(plan.armedTrigger.level)}`
            : plan.armedTrigger.kind === "price_below"
              ? `${t("等待向下穿越", "Waiting to cross below")} ${displayPrice(plan.armedTrigger.level)}`
              : `${t("等待进入区间", "Waiting to enter zone")} ${displayPrice(plan.armedTrigger.levelLow)}–${displayPrice(plan.armedTrigger.levelHigh)}`}
          {plan.armedExpiresAt ? ` · ${t("到期", "expires")} ${formatTime(plan.armedExpiresAt)}` : ""}
        </div>
      )}
      <footer>
        {awaiting && !invalidForApproval && <button className="approveButton" onClick={() => action(`/api/trade-plans/${plan.id}/approve`, {})}>{plan.outOfWhitelist ? t("确认下单（仅本笔）", "Confirm order (this trade only)") : t("批准计划", "Approve plan")}</button>}
        {awaiting && invalidForApproval && <button className="approveButton" disabled title={t("现价已越过止损，计划已失效，无法批准", "Price has crossed the stop; the plan is void and cannot be approved")}>{t("已失效 · 不可批准", "Void · cannot approve")}</button>}
        {awaiting && <button onClick={() => action(`/api/trade-plans/${plan.id}/cancel`, { reason: "user_rejected" })}>{invalidForApproval ? t("作废", "Discard") : t("拒绝", "Reject")}</button>}
        {plan.status === "armed" && plan.armedSetupId && <button onClick={() => action(`/api/armed-setups/${plan.armedSetupId}/cancel`, { reason: "user_cancelled" })}>{t("停止等待", "Stop waiting")}</button>}
        <button className="ghostButton" onClick={() => ui.openPanel("auditChain")}>{t("审计链", "Audit chain")} <ChevronRight size={13} /></button>
      </footer>
      {plan.appliedKnowledge && ((plan.appliedKnowledge.lenses || []).length > 0 || (plan.appliedKnowledge.rules || []).length > 0) && (
        <div className="planKnowledge" title={t("本计划实际依据的透镜与铁律（AI 自报，已按真实知识库校验）", "Lenses and hard rules this plan actually relies on (AI-reported, verified against the real knowledge base)")}>
          <BookOpen size={12} />
          <span>{t("依据知识：", "Knowledge used: ")}
            {(plan.appliedKnowledge.lenses || []).map((n) => <em key={`l-${n}`} className="pkLens">{n}</em>)}
            {(plan.appliedKnowledge.rules || []).map((n) => <em key={`r-${n}`} className="pkRule">{n}</em>)}
          </span>
        </div>
      )}
      {(plan.reviewLearning?.applied || []).length > 0 && (
        <div className="planKnowledge planReviewLearning" title={t("本计划明确采用的真实交易复盘；ID 与影响说明已经服务端校验并进入成交归因", "Real trade reviews explicitly applied by this plan; IDs and impact notes are server-validated and carried into fill attribution") }>
          <BrainCircuit size={12} />
          <span><b>{t("采用复盘：", "Reviews applied: ")}</b>
            {(plan.reviewLearning.applied || []).map((item) => <em key={item.memoryId} className="pkReview" title={item.memoryId}>{item.note}</em>)}
          </span>
        </div>
      )}
      {awaiting && invalidForApproval && <small className="planHint danger">{t("现价", "Now")} {displayPrice(nowPrice)} {t("已越过止损", "has crossed the stop")} {displayPrice(stopVal)}{t("——计划已失效，批准会一开仓即触发止损，请作废后等 AI 重新提计划。", " — the plan is void; approving would trigger the stop right on entry. Discard it and wait for the AI to re-propose.")}</small>}
      {awaiting && !invalidForApproval && !plan.outOfWhitelist && <small className="planHint">{t("确认后立即进入执行引擎：按净值与止损距离计算数量、提交入场单并附带保护性止损；若当前是只分析，则只完成计算而不提交订单。", "After confirmation it enters the execution engine immediately: it sizes from equity and stop distance, submits the entry order with a protective stop attached; in analysis-only mode it calculates without submitting an order.")}</small>}
      {awaiting && !invalidForApproval && plan.outOfWhitelist && <small className="planHint">{plan.symbol}{t(" 不在授权白名单——这是全市场扫描发现的机会。点「确认下单」只授权本笔交易；它不会加入常驻交易范围，之后的自动分析也不会自行交易它。若当前是只分析，则只完成计算而不提交订单。", " is outside the authorized list — this opportunity came from a full-market scan. Confirming authorizes this trade only; it is not added to the standing scope and future automatic analysis will not trade it. In analysis-only mode it calculates without submitting an order.")}</small>}
      {executionOrder && (
        <div className="executionStrip">
          <span className={`execDot ${["entry_filled", "protecting"].includes(executionOrder.status) ? "on" : executionOrder.status === "closed" ? "done" : ""}`} />
          <b>{executionLabel(executionOrder.status)}</b>
          <small>
            {t("数量", "Qty")} {executionOrder.quantity} · {t("名义", "Notional")} {displayMoney(executionOrder.notionalUsdt)} USDT
            {Number.isFinite(Number(executionOrder.projectedMargin?.incrementalMargin)) ? ` · ${t("预计保证金", "Est. margin")} ${displayMoney(executionOrder.projectedMargin.incrementalMargin)} USDT` : ""}
            {Number.isFinite(Number(executionOrder.projectedMargin?.projectedUtilizationPct)) ? ` · ${t("成交后使用率", "Post-trade use")} ${Number(executionOrder.projectedMargin.projectedUtilizationPct).toFixed(1)}%` : ""}
            {executionOrder.filledPrice ? ` · ${t("成交", "Filled")} ${displayMoney(executionOrder.filledPrice)}` : ""}
            {executionSnapshot?.netRealizedPnl != null ? ` · ${t("净盈亏", "Net PnL")} ${displayMoney(executionSnapshot.netRealizedPnl)}` : executionSnapshot?.grossRealizedPnl != null ? ` · ${t("价格毛盈亏", "Gross price PnL")} ${displayMoney(executionSnapshot.grossRealizedPnl)} · ${t("成本待对账", "costs pending")}` : ""}
            {executionOrder.status === "setup_rejected" && executionOrder.setupReview?.reason ? ` · ${t("原因：", "Reason: ")}${executionOrder.setupReview.reason}` : ""}
          </small>
          {executionExitAction(executionOrder) && (
            <button onClick={() => requestExecutionExit(action, executionOrder, "manual_ui")}>{executionExitAction(executionOrder).label}</button>
          )}
        </div>
      )}
    </div>
  );
}

function MandateCard({ mandate, action }) {
  if (!mandate) return null;
  const pending = mandate.status === "pending_confirmation";
  return (
    <div className="chatMandateCard">
      <header><Shield size={15} /><b>{t("交易权限", "Trading permissions")}{pending ? t("草案", " draft") : ""}</b><StatusBadge tone={pending ? "warning" : "ok"}>{humanize(mandate.status)}</StatusBadge></header>
      <div className="mandateGridMini">
        <span><small>{t("交易对", "Symbols")}</small><SymbolChips symbols={mandate.allowedSymbols} empty="-" /></span>
        <span><small>{t("最大杠杆", "Max leverage")}</small><b>{mandate.max_leverage || 1}x</b></span>
        <span><small>{t("单笔风险", "Per-trade risk")}</small><b>{mandate.maxSingleTradeRiskPct}%</b></span>
        <span><small>{t("日亏上限", "Daily loss cap")}</small><b>{mandate.maxDailyLossPct}%</b></span>
        <span><small>{t("近7日亏损上限", "Rolling 7-day loss cap")}</small><b>{mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? 5}%</b></span>
      </div>
      {pending && <footer><button className="approveButton" onClick={() => action(`/api/mandates/${mandate.id}/activate`, {})}>{t("确认激活", "Confirm & activate")}</button><small>{t("激活后 Agent 才能在此边界内提出可执行计划", "Only after activation can the agent propose executable plans within these bounds")}</small></footer>}
    </div>
  );
}

function StrategyDraftCard({ draft, ui, mobile = false }) {
  if (!draft?.id) return null;
  const blueprint = draft.blueprint || {};
  const tests = draft.generatedTests || {};
  const statusLabel = tests.status === "passed" ? t("自动测试通过", "Tests passed") : tests.status === "failed" ? t("自动测试未通过", "Tests failed") : t("草稿", "Draft");
  return <div className="chatStrategyDraftCard">
    <header><Rocket size={15}/><span><b>{t("策略工作室草稿", "Strategy Studio draft")}</b><small>{t("与策略库使用同一版本链", "Uses the same version pipeline as the Strategy Library")}</small></span><StatusBadge tone={tests.status === "passed" ? "ok" : "warning"}>{statusLabel}</StatusBadge></header>
    <div className="chatStrategyDraftFacts"><span><small>{t("策略", "Strategy")}</small><b>{localizeText(blueprint.name) || "—"}</b></span><span><small>{t("交易对 · 周期", "Symbol · timeframe")}</small><b>{(blueprint.symbols || []).join("、") || "—"} · {blueprint.timeframe || "—"}</b></span><span><small>{t("止损 · 止盈", "Stop · target")}</small><b>{blueprint.exitPolicy?.stopLossPct ?? "—"}% · {blueprint.exitPolicy?.takeProfitR ?? "—"}R</b></span><span><small>{t("自动测试", "Generated tests")}</small><b>{tests.passed ?? 0}/{tests.total ?? 0}</b></span></div>
    <small>{t("编译来源", "Compiler provenance")}：{humanize(draft.compilationReport?.compiler || draft.compiler, "—")}{draft.compilationReport?.warnings?.length ? ` · ${draft.compilationReport.warnings.map((value) => humanize(value)).join(" · ")}` : ""}</small>
    <footer><button type="button" onClick={() => ui.setActive(mobile ? "strategyLib:studio" : "strategyStudio")}>{t("打开策略工作室", "Open Strategy Studio")}<ChevronRight size={14}/></button><small>{t("草稿不会下单；回测通过后仍需人工发布。", "Drafts never place orders; publication remains manual after OOS validation.")}</small></footer>
  </div>;
}

export function ToolTrace({ trace = [], coverage = null, callSummary = null }) {
  const [open, setOpen] = useState(false);
  if (!trace.length && !coverage) return null;
  const verified = callSummary || {
    totalCalls: trace.length,
    modelCalls: trace.filter((item) => item.origin !== "system_preflight").length,
    preflightCalls: trace.filter((item) => item.origin === "system_preflight").length
  };
  const coverageBits = coverage
    ? [
      `${t("本轮证据检查", "Evidence checks")} ${coverage.covered || 0}/${coverage.required || 0}`,
      `${t("白名单", "Whitelist")} ${coverage.whitelist?.analyzed || 0}/${coverage.whitelist?.expected || 0}`,
      `${t("观察哨", "Watches")} ${coverage.watches?.analyzed || 0}/${coverage.watches?.expected || 0}`,
      coverage.marketScan?.completed ? `${t("全市场", "Market")} ${coverage.marketScan.universe || 0}` : t("全市场未完成", "Market scan incomplete"),
      coverage.externalCandidates?.length ? `${t("视野外复核", "External review")} ${coverage.externalCandidates.filter((item) => item.analyzed).length}/${coverage.externalCandidates.length}` : null
    ].filter(Boolean)
    : [];
  const sourceBits = [
    verified.modelCalls ? `${t("模型主动", "Model")} ${verified.modelCalls}` : null,
    verified.preflightCalls ? `${t("系统预检", "Preflight")} ${verified.preflightCalls}` : null,
    !verified.modelCalls && !verified.preflightCalls ? `${verified.totalCalls || trace.length} ${t("次工具调用", "tool calls")}` : null
  ].filter(Boolean);
  const summary = [...sourceBits, ...coverageBits].join(" · ");
  return (
    <div className="toolTrace">
      <button onClick={() => setOpen((current) => !current)}>
        <Wrench size={12} /> <span>{summary}</span> <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && coverage && <p className="toolTraceHint">{t("检查项由本次问题、币种与交易场景动态选择，不是固定调用一组能力。", "Checks are selected dynamically for this question, symbols, and trading scenario; the set is not fixed.")}</p>}
      {open && trace.map((item, index) => (
        <div key={index}><b>{item.name}</b><span>{item.summary}</span><small>{item.origin === "system_preflight" ? t("预检", "preflight") : t("模型", "model")} · {item.latencyMs}ms</small></div>
      ))}
    </div>
  );
}

function patrolActionLabel(action = {}) {
  const labels = {
    propose_trade_plan: t("交易计划", "Trade plan"),
    register_watch: t("新增观察哨", "Watch registered"),
    cancel_watch: t("撤销观察哨", "Watch cancelled"),
    record_watch_review: t("观察哨复核", "Watch review")
  };
  return labels[action.name] || humanize(action.name, action.name || "—");
}

function patrolNextActionLabel(nextAction = {}) {
  const action = nextAction || {};
  const labels = {
    review_error: t("检查本轮错误", "Inspect this run's error"),
    rebuild_plan: t("按风控反馈重建计划", "Rebuild the plan from risk feedback"),
    approve_or_reject: t("等待人工批准或拒绝", "Await human approval or rejection"),
    wait_for_trigger: t("等待条件触发", "Wait for the setup trigger"),
    wait_for_fill: t("等待订单成交", "Wait for the order to fill"),
    monitor_position: t("继续监控持仓与保护单", "Keep monitoring the position and protection"),
    review_closed_trade: t("进入实盘复盘", "Move to live-trade review"),
    inspect_execution_block: t("检查执行阻断", "Inspect the execution block"),
    watch_primary_condition: t("继续盯住主观察条件", "Keep watching the primary condition"),
    analysis_only: t("等待下一轮巡检", "Wait for the next patrol")
  };
  const label = labels[action.code] || (action.code ? humanize(action.code) : t("等待下一轮巡检", "Wait for the next patrol"));
  return action.detail ? `${label} · ${action.detail}` : label;
}

function PatrolDetail({ view }) {
  const symbols = [...view.scope.whitelist.symbols, ...view.scope.watches.symbols];
  const linked = Object.entries(view.linked || {});
  return (
    <div className="patrolDetail kEvidenceLedger">
      <section className="patrolDetailSection">
        <header><span>01</span><b>{t("检查范围", "Inspection scope")}</b></header>
        <dl className="patrolScopeList">
          <div><dt>{t("证据能力", "Evidence")}</dt><dd>{view.scope.evidence.value}/{view.scope.evidence.total}{view.scope.evidence.missing.length ? ` · ${t("缺失", "Missing")} ${view.scope.evidence.missing.map((item) => item.symbol ? `${item.name}(${item.symbol})` : item.name).join("、")}` : ""}</dd></div>
          <div><dt>{t("白名单", "Whitelist")}</dt><dd>{view.scope.whitelist.value}/{view.scope.whitelist.total}{view.scope.whitelist.symbols.length ? ` · ${view.scope.whitelist.symbols.join(" · ")}` : ""}</dd></div>
          <div><dt>{t("观察哨", "Watches")}</dt><dd>{view.scope.watches.value}/{view.scope.watches.total}{view.scope.watches.symbols.length ? ` · ${view.scope.watches.symbols.join(" · ")}` : ""}</dd></div>
          <div><dt>{t("全市场", "Market")}</dt><dd>{view.scope.market.completed ? `${view.scope.market.universe} ${t("个合约", "instruments")} · Top ${view.scope.market.candidates}` : `${t("未完成", "Incomplete")}${view.scope.market.error ? ` · ${view.scope.market.error}` : ""}`}</dd></div>
          {view.scope.externalCandidates.length > 0 && <div><dt>{t("视野外候选", "External candidates")}</dt><dd>{view.scope.externalCandidates.map((item) => `${item.symbol || "—"}${item.side ? ` ${humanize(item.side)}` : ""}${item.analyzed ? ` · ${t("已复核", "reviewed")}` : ` · ${t("未复核", "not reviewed")}`}`).join("；")}</dd></div>}
        </dl>
        {symbols.length === 0 && <small className="patrolEmptyNote">{t("本轮没有记录具体币种范围。", "No symbol scope was recorded for this run.")}</small>}
      </section>

      <section className="patrolDetailSection">
        <header><span>02</span><b>{t("决策与动作", "Decision and actions")}</b></header>
        <div className="patrolOutcome">
          <small>{t("本轮结论", "Outcome")}</small>
          <b>{view.headline || t("本轮未记录结构化结论", "No structured outcome was recorded")}</b>
          <span>{patrolNextActionLabel(view.nextAction)}</span>
        </div>
        <div className="patrolOperationList">
          {view.operations.map((operation, index) => <div className={operation.succeeded ? "ok" : "attention"} key={`${operation.name}-${index}`}><i /> <span><b>{patrolActionLabel(operation)}</b><small>{operation.summary || t("已调用，但未记录摘要", "Called without a recorded summary")}</small></span></div>)}
          {!view.operations.length && <div className="neutral"><i /><span><b>{t("未产生交易或观察哨变更", "No trade or watch mutation")}</b><small>{t("本轮只有分析与证据检查，没有可执行动作落库。", "This run recorded analysis and evidence checks only; no executable mutation was persisted.")}</small></span></div>}
        </div>
        {linked.length > 0 && <div className="patrolLinked"><small>{t("关联记录", "Linked records")}</small>{linked.map(([key, value]) => <span key={key}><b>{humanize(key)}</b>{value}</span>)}</div>}
      </section>

      <section className="patrolDetailSection patrolDetailSection--trace">
        <header><span>03</span><b>{t("运行回执", "Run receipts")}</b><small>{view.calls.total} {t("次调用", "calls")} · {t("预检", "preflight")} {view.calls.preflight} · {t("模型", "model")} {view.calls.model}</small></header>
        <div className="patrolTraceList">
          {view.traces.map((trace, index) => <div key={`${trace.name}-${index}`}><i className={trace.succeeded ? "ok" : "attention"} /><b>{trace.name}</b><span>{trace.summary || t("无摘要", "No summary")}</span><small>{trace.origin === "system_preflight" ? t("系统预检", "preflight") : trace.origin === "local_fallback" ? t("本地回退", "fallback") : t("模型调用", "model")}{trace.latencyMs !== null ? ` · ${trace.latencyMs}ms` : ""}</small></div>)}
          {!view.traces.length && <p>{t("本轮没有工具调用回执。", "No tool receipts were recorded for this run.")}</p>}
        </div>
      </section>
    </div>
  );
}

export function PatrolReceipt({ message = {}, mobile = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const view = buildPatrolView(message);
  if (!view) return null;
  const statusLabel = view.status === "complete" ? t("巡检完成", "Patrol complete") : t("需要关注", "Needs attention");
  return (
    <section className={`patrolReceipt ${view.status}`} aria-label={t("自主巡检回执", "Autonomous patrol receipt")}>
      <header className="patrolReceiptHead">
        <span className="patrolRunMark"><Radar size={14} /> AUTONOMOUS / PATROL</span>
        <b className="patrolRunStatus"><i />{statusLabel}</b>
        <time>{formatDateTime(view.checkedAt, "—")}</time>
      </header>
      <div className="patrolMetricStrip kTruthBand">
        <span><small>{t("证据", "Evidence")}</small><b>{view.scope.evidence.value}/{view.scope.evidence.total}</b></span>
        <span><small>{t("白名单", "Whitelist")}</small><b>{view.scope.whitelist.value}/{view.scope.whitelist.total}</b></span>
        <span><small>{t("观察哨", "Watches")}</small><b>{view.scope.watches.value}/{view.scope.watches.total}</b></span>
        <span><small>{t("全市场", "Market")}</small><b>{view.scope.market.completed ? view.scope.market.universe : "—"}</b></span>
      </div>
      <div className="patrolReceiptSummary kActionBar">
        <span><small>{t("下一步", "Next")}</small><b>{patrolNextActionLabel(view.nextAction)}</b></span>
        <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {mobile ? t("查看巡检详情", "View patrol details") : open ? t("收起运行回执", "Hide run receipts") : t("展开运行回执", "Open run receipts")}
          <ChevronRight size={14} />
        </button>
      </div>
      {!mobile && open && <PatrolDetail view={view} />}
      {mobile && open && <div className="patrolSheetOverlay" onClick={() => setOpen(false)}>
        <section className="patrolSheet" role="dialog" aria-modal="true" aria-label={t("自主巡检详情", "Autonomous patrol details")} onClick={(event) => event.stopPropagation()}>
          <header><span><small>AUTONOMOUS / PATROL</small><b>{t("自主巡检详情", "Patrol details")}</b></span><button type="button" onClick={() => setOpen(false)} aria-label={t("关闭", "Close")}><X size={18} /></button></header>
          <div className="patrolSheetScroll"><PatrolDetail view={view} /></div>
        </section>
      </div>}
    </section>
  );
}

function AgentRail({ data, action, ui }) {
  const system = data.system || {};
  const agentStatus = data.agentStatus || {};
  const riskWall = agentStatus.riskWall || {};
  const portfolio = data.portfolio || {};
  const mandate = (data.mandates || []).find((m) => ["active", "running"].includes(m.status)) || {};
  const hasMandate = Boolean(mandate.id);
  // 多仓/多计划:全部取出,卡片可切换逐个看(此前只 find 出一个,多仓时看不到其余)。
  const plans = (data.tradePlans || []).filter((p) => ["armed", "awaiting_approval", "approved", "executing"].includes(p.status));
  const [planIdx, setPlanIdx] = useState(0);
  const [watchTip, setWatchTip] = useState(null); // 观察哨悬停 tooltip(fixed 定位,逃出滚动容器裁剪)
  const plan = plans.length ? plans[Math.min(planIdx, plans.length - 1)] : null;
  // 盈亏比可由固定的入场/止损/止盈直接算出，不该恒显"—"（计划价位是下单前定死的目标，本就不随行情变动）。
  const planRR = (() => {
    if (plan?.riskReward) return plan.riskReward;
    const er = plan?.entry_range;
    const entry = Array.isArray(er) && er.length ? (Number(er[0]) + Number(er[er.length - 1])) / 2 : Number(plan?.entry?.mid ?? plan?.entryPrice ?? NaN);
    const stop = Number(plan?.stopLoss ?? plan?.stop_loss ?? NaN);
    const tps = plan?.takeProfit || plan?.take_profit || [];
    const tp = Number(Array.isArray(tps) ? tps[0] : tps);
    if (![entry, stop, tp].every(Number.isFinite) || entry === stop) return null;
    const rr = Math.abs(tp - entry) / Math.abs(entry - stop);
    return Number.isFinite(rr) && rr > 0 ? rr.toFixed(2) : null;
  })();
  const sm = data.marketRegime?.smartMoney || {};
  const latestRun = (data.agentRuns || [])[0] || {};
  const decisionPlan = plan || (data.tradePlans || [])[0] || null;
  const decisionProvenance = decisionPlan?.decisionProvenance || {};
  const primaryAttribution = decisionProvenance.primary || latestRun.primaryAttribution || null;
  const criticReview = decisionProvenance.critic || latestRun.criticReview || null;
  const decisionRisk = decisionPlan?.lastRiskCheck || (data.riskChecks || []).find((row) => row.tradePlanId === decisionPlan?.id) || null;
  const decisionAudit = decisionProvenance.auditChain || latestRun.decisionAudit || null;
  const evidenceCount = new Set((decisionPlan?.evidenceIds || []).filter(Boolean)).size;
  const knowledgeCount = new Set([...(decisionPlan?.knowledgeSkillIds || []), ...(decisionPlan?.adoptedTrustedSkillIds || [])].filter(Boolean)).size;
  const showDecisionChain = Boolean(decisionPlan || latestRun.modelArchitecture || primaryAttribution || criticReview);
  const canOpen = system.killSwitch ? false : riskWall.allowOpen === true;
  const ratio = sm.topTraderLongShortRatio;
  // 全端统一的偏向判定（smartMoneyBias，阈值一处定义）；语义用"偏多/偏空"不再冒充"趋势"。
  const bias = smartMoneyBias(ratio);
  const judge = system.killSwitch ? t("紧急停止中", "Emergency stop active") : bias.label === "待同步" ? t("观察中", "Watching") : bias.label;
  const judgePos = bias.tone === "pos";
  const judgeNeg = bias.tone === "neg";
  // 后端真实的下一步建议是 nextActions（数组）；此前读不存在的单数 nextAction 恒 undefined，
  // 永远落到"等待信号"这个与信号无关的假文案。
  const nextStep = (agentStatus.nextActions || [])[0] || (canOpen ? t("已授权开仓", "Cleared to open") : t("未授权开仓", "Not cleared to open"));
  const remaining = system.remainingDailyLossUsdt;
  const cap = mandate.maxDailyLossPct && portfolio.totalEquityUsdt ? (Number(mandate.maxDailyLossPct) / 100) * Number(portfolio.totalEquityUsdt) : null;
  const budgetPct = cap && remaining != null ? Math.max(0, Math.min(100, (Number(remaining) / cap) * 100)) : null;
  const mandateRows = hasMandate ? [
    { k: t("允许的市场", "Allowed market"), v: humanize(mandate.marketTypes?.[0] || "perpetual_usdt", "永续") },
    { k: t("交易所", "Exchange"), v: (mandate.exchanges || []).join("·") || "—" },
    { k: t("白名单", "Whitelist"), v: `${(mandate.allowedSymbols || []).length} ${t("币", "coins")}` },
    { k: t("最大杠杆", "Max leverage"), v: `${mandate.max_leverage || 1}x` },
    { k: t("单笔风险", "Per-trade risk"), v: `${mandate.maxSingleTradeRiskPct ?? "-"}%` },
    { k: t("审批阈值", "Approval threshold"), v: `≥${displayMoney(mandate.humanApprovalNotionalUsdt || mandate.manual_approval_threshold_usdt || 0, 0)}` }
  ] : [
    { k: t("允许的市场", "Allowed market"), v: t("未设置", "Not configured") }, { k: t("交易所", "Exchange"), v: "—" }, { k: t("允许的交易对", "Allowed pairs"), v: "—" },
    { k: t("最大杠杆", "Max leverage"), v: "—" }, { k: t("单笔风险", "Per-trade risk"), v: "—" }, { k: t("审批阈值", "Approval threshold"), v: "—" }
  ];

  // 轨迹用最新 run 的真实步骤与各自时间戳——旧版是写死的五步流水 + 同一个时间戳复制五遍（假轨迹）。
  const TRAJ_ICONS = { observe: Eye, regime: BrainCircuit, decision: ClipboardList, risk_check: Shield, execution: Hourglass };
  const trajSteps = (latestRun.steps || []).slice(0, 5).map((s) => ({
    Icon: TRAJ_ICONS[s.phase] || BrainCircuit,
    t: (s.title || humanize(s.phase, "步骤")).slice(0, 6),
    time: s.createdAt ? formatTime(s.createdAt) : "—"
  }));


  return (
    <div className="agRail">
      {watchTip && (
        <div className="agWatchTipFixed" style={{ left: Math.max(8, watchTip.rect.left - 312), top: Math.min(watchTip.rect.top, (typeof window !== "undefined" ? window.innerHeight : 800) - 190) }}>
          {watchTip.lines.map((ln, i) => <div key={i}>{ln}</div>)}
        </div>
      )}
      {/* 当前 Agent 状态 */}
      <div className="agCard">
        <div className="agHeadNum"><span className="agNum">2</span>{t("当前 Agent 状态", "Agent status")}</div>
        {/* 概念图对齐:当前 Agent 状态改为 label:value 行(映射真实字段),不再用四宫格 */}
        <div className="agStatusRows">
          {[
            { k: t("市场环境", "Market regime"), v: judge, tone: judgePos ? "pos" : judgeNeg ? "neg" : "" },
            { k: t("当前任务", "Current task"), v: latestRun.steps?.[0]?.title || (plan ? `${plan.symbol} ${t("策略评估", "strategy review")}` : t("等待巡检机会", "Waiting for a scan opportunity")) },
            { k: t("交易限制", "Trading limits"), v: hasMandate && mandate.maxSingleTradeRiskPct != null ? `${mandate.maxSingleTradeRiskPct}%/${t("笔", "trade")} · ${t("日亏≤", "daily loss ≤")}${mandate.maxDailyLossPct ?? "-"}% · ${t("近7日≤", "7-day loss ≤")}${mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? 5}%` : t("未设置", "Not configured") },
            { k: t("下一步", "Next step"), v: localizeText(nextStep) },
            { k: t("最近决策", "Last decision"), v: trajSteps[0] && trajSteps[0].time !== "—" ? `${trajSteps[0].time} ${trajSteps[0].t}` : "—" }
          ].map((r) => <div className="agStatusRow" key={r.k}><span>{r.k}</span><b className={`mono ${r.tone || ""}`} title={typeof r.v === "string" ? r.v : ""}>{r.v}</b></div>)}
        </div>
        <div className="agStatusFoot"><ShieldCheck size={11} /> {t("受风控中心授权约束", "Bound by Risk Center authorization")}</div>
        <div className="agPlan">
          <div className="agPlanHead">
            <span className="agPlanBtc">₿</span>
            {plan ? <AgentTradePlanButton plan={plan} ui={ui}><b className="mono">{plan.symbol}</b></AgentTradePlanButton> : <b className="mono">{t("暂无交易计划", "No trade plan")}</b>}
            {plans.length > 1 && (
              <span className="agPlanSwitch">
                <button type="button" onClick={() => setPlanIdx((i) => (i - 1 + plans.length) % plans.length)} title={t("上一个持仓/计划", "Previous position/plan")}>‹</button>
                <em className="mono">{Math.min(planIdx, plans.length - 1) + 1}/{plans.length}</em>
                <button type="button" onClick={() => setPlanIdx((i) => (i + 1) % plans.length)} title={t("下一个持仓/计划", "Next position/plan")}>›</button>
              </span>
            )}
            {plan && (() => {
              // 挂单 vs 持仓的真实状态:限价单已提交但价格没到=挂单未成交(仓位仍为0),成交后才是持仓。
              const eo = (data.executionOrders || []).find((o) => o.planId === plan.id);
              const armedSetup = (data.armedSetups || []).find((setup) => setup.id === plan.armedSetupId || setup.planId === plan.id);
              const held = (data.positions || []).some((p) => p.symbol === plan.symbol && Number(p.size ?? p.pos ?? 0) !== 0);
              const st = held || ["entry_filled", "protecting"].includes(eo?.status) ? { t: t("持仓中", "Holding"), c: "pos" }
                : eo?.status === "entry_pending" ? { t: t("⏳挂单未成交", "⏳ Pending fill"), c: "warn" }
                : eo?.status === "closed" ? { t: t("已平仓", "Closed"), c: "" }
                : armedSetup?.status === "FAST_VALIDATING" ? { t: t("复核行情与风控 · 未下单", "Refreshing facts and risk · no order"), c: "warn" }
                : armedSetup?.status === "TRIGGERED" ? { t: t("价格已到 · 执行前复核", "Price reached · pre-trade checks"), c: "warn" }
                : armedSetup?.confirmationPending ? { t: t("价格已到 · 等待K线确认", "Price reached · waiting for candle confirmation"), c: "warn" }
                : plan.status === "armed" ? (()=>{const stages=armedSetup?.scenario?.stages||[];const i=Number(armedSetup?.scenario?.currentStageIndex||0);return { t: stages.length>1?t(`等待第 ${i+1}/${stages.length} 步：${stages[i]?.label||"价格条件"} · 未下单`, `Waiting for step ${i+1}/${stages.length}: ${stages[i]?.label||"price condition"} · no order`):t("等待价格条件 · 未下单", "Waiting for price · no order"), c:"pos" };})()
                : plan.status === "awaiting_approval" ? { t: t("待确认", "Pending"), c: "warn" }
                : plan.status === "approved" ? { t: t("准备下单", "Ready to order"), c: "warn" }
                : null;
              return st ? <span className={`evBadge ${st.c}`}>{st.t}</span> : null;
            })()}
            {(() => {
              const mk = (data.markets || []).find((m) => m.symbol === (plan?.symbol || ""));
              if (!mk?.price || !plan) return null;
              const price = Number(mk.price);
              const stop = Number(plan.stopLoss ?? plan.stop_loss);
              const mid = Array.isArray(plan.entry_range) && plan.entry_range.length ? (Number(plan.entry_range[0]) + Number(plan.entry_range[plan.entry_range.length - 1])) / 2 : NaN;
              const isShort = String(plan.direction).toLowerCase() === "short";
              const stopCrossed = Number.isFinite(stop) && (isShort ? price >= stop : price <= stop);
              const devPct = Number.isFinite(mid) && mid > 0 ? Math.abs(mid - price) / price * 100 : 0;
              return (<>
                <span className="agPlanNow mono">{t("现价", "Now")} {displayPrice(price)}</span>
                {stopCrossed ? <span className="evBadge neg">{t("已失效 · 现价越过止损", "Void · price crossed stop")}</span>
                  : devPct > 8 ? <span className="evBadge warn">{t("偏离现价", "Off market")} {devPct.toFixed(0)}% · {t("陈旧", "stale")}</span> : null}
              </>);
            })()}
            {plan && <span className="agPlanTag">{plan.strategy ? humanize(plan.strategy) : t("未指定策略", "No strategy set")}</span>}
            {plan?.executionBlock && <span className="evBadge neg" title={plan.executionBlock.detail}>{t("已批准未下单", "Approved, not ordered")} · {plan.executionBlock.detail.length > 22 ? `${plan.executionBlock.detail.slice(0, 22)}…` : plan.executionBlock.detail}</span>}
            <span className="agPlanRight mono">{plan ? t("当前交易计划 · 价位为计划目标", "Current plan · prices are plan targets") : t("等巡检提出机会", "Awaiting scan opportunities")}</span>
          </div>
          {!plan && (() => {
            // 无计划时的授权白名单:计数 + 省略号截断(白名单再多也不挤爆,全量在 title 里),简写去 /USDT。
            const wl = (mandate.allowedSymbols || []).map((s) => String(s));
            return (
              <div className="agPlanWl" title={wl.join(" · ") || t("未设置授权白名单", "No whitelist set")}>
                <span className="agPlanWlLabel">{t("授权", "Authorized")} {wl.length} {t("币", "coins")}</span>
                <span className="agPlanWlList">{wl.map((s) => s.replace(/\/USDT$/i, "")).join(" · ") || t("未设置", "None set")}</span>
              </div>
            );
          })()}
          <div className="agPlanGrid">
            <div><div className="agPlanK">{t("入场区间", "Entry zone")}</div><b className="mono">{plan ? (plan.entry?.range || (plan.entry_range ? plan.entry_range.join("–") : "—")) : "—"}</b></div>
            <div><div className="agPlanK">{t("止损价", "Stop price")}</div><b className="mono neg">{plan ? displayPrice(plan.stopLoss ?? plan.stop_loss) : "—"}</b></div>
            <div><div className="agPlanK">{t("止盈目标", "Take profit")}</div><b className="mono pos">{plan && (plan.takeProfit || plan.take_profit)?.length ? (plan.takeProfit || plan.take_profit).slice(0, 2).map((tp) => displayPrice(tp)).join(" / ") : "—"}</b></div>
            <div><div className="agPlanK" title={t("打到止损这笔亏账户的百分比(≤授权单笔风险上限);不是仓位大小", "Percent of the account this trade loses if the stop is hit (≤ the authorized per-trade risk cap); not the position size")}>{t("本笔风险·杠杆", "Trade risk · leverage")}</div><b className="mono">{plan ? `${plan.max_loss_pct ?? "-"}% · ${plan.leverage || 1}x` : "—"}</b></div>
            <div><div className="agPlanK">{t("盈亏比", "R:R")}</div><b className="mono">{planRR ? `1 : ${planRR}` : "—"}</b></div>
            <div><div className="agPlanK">{t("置信度", "Confidence")}</div><b className="mono">{plan?.confidence != null ? `${plan.confidence}%` : "—"}</b></div>
          </div>
        </div>
      </div>

      {showDecisionChain && <div className="agCard agDecisionChain kEvidenceLedger">
        <div className="agHeadIcon"><Sparkles size={13}/> {t("一次决策是怎样形成的", "How a decision is formed")}</div>
        <small className="agDecisionIntro">{t("Gemini 负责收集与综合，DeepSeek 独立找漏洞；两者都不能绕过最后的确定性硬风控。", "Gemini gathers and synthesizes evidence, DeepSeek independently challenges it, and neither can bypass deterministic hard-risk controls.")}</small>
        <div className="agDecisionSteps">
          <article className={primaryAttribution?.providerAttributionVerified ? "pass" : "wait"}>
            <i><Sparkles size={13}/></i><span><small>1 · GEMINI</small><b>{t("检索、读图与形成候选判断", "Research, multimodal analysis, and candidate judgment")}</b><em title={primaryAttribution?.actualModel || latestRun.primaryModel?.model || ""}>{primaryAttribution?.actualProvider || (latestRun.primaryModel?.model ? t("等待提供商归因", "Awaiting provider attribution") : t("本轮尚未调用", "Not called in this run"))}</em></span><strong>{primaryAttribution?.providerAttributionVerified ? t("已归因", "Attributed") : t("待核验", "Unverified")}</strong>
          </article>
          <article className={evidenceCount || knowledgeCount ? "pass" : "wait"}>
            <i><Layers3 size={13}/></i><span><small>2 · EVIDENCE</small><b>{t("事实、情报、知识与策略汇合", "Facts, intel, knowledge, and strategies converge")}</b><em>{t(`实时证据 ${evidenceCount} · 知识技能 ${knowledgeCount}`, `${evidenceCount} live evidence · ${knowledgeCount} knowledge skills`)}</em></span><strong>{decisionProvenance.evidence?.bundleId || latestRun.evidenceBundleId ? t("已封存", "Sealed") : t("待生成", "Pending")}</strong>
          </article>
          <article className={criticReview ? (criticReview.approved ? "pass" : "stop") : "wait"}>
            <i><BrainCircuit size={13}/></i><span><small>3 · DEEPSEEK</small><b>{t("独立反驳与风险审查", "Independent challenge and risk review")}</b><em title={criticReview?.summary || ""}>{criticReview ? `${humanize(criticReview.verdict, criticReview.approved ? t("批准", "Approved") : t("拒绝", "Rejected"))}${criticReview.confidence != null ? ` · ${Math.round(Number(criticReview.confidence) * (Number(criticReview.confidence) <= 1 ? 100 : 1))}%` : ""}${criticReview.objections?.length ? ` · ${criticReview.objections.length} ${t("项异议", "objections")}` : ""}` : t("只有形成交易提案后才触发", "Runs only after a trade proposal exists")}</em></span><strong>{criticReview ? (criticReview.approved ? t("通过", "Pass") : t("拒绝", "Reject")) : t("未触发", "Not run")}</strong>
          </article>
          <article className={decisionRisk ? (decisionRisk.passed ? "pass" : "stop") : "wait"}>
            <i><ShieldCheck size={13}/></i><span><small>4 · HARD RISK</small><b>{t("账户事实、授权与硬风控裁决", "Account facts, permissions, and hard-risk decision")}</b><em title={decisionRisk?.summary || ""}>{decisionRisk ? localizeText(decisionRisk.summary || decisionRisk.decision || (decisionRisk.passed ? t("全部硬闸通过", "All hard gates passed") : t("存在阻断项", "Blocking checks exist"))) : t("没有计划时不会虚构风控结果", "No risk result is fabricated without a plan")}</em></span><strong>{decisionRisk ? (decisionRisk.passed ? t("允许推进", "Cleared") : t("已阻断", "Blocked")) : t("待计划", "Await plan")}</strong>
          </article>
        </div>
        <footer className={decisionAudit?.rootHash ? "pass" : "wait"}><Shield size={11}/><span>{decisionAudit?.rootHash ? t("提示词、工具、证据、模型输出和最终计划已进入可重算审计链", "Prompt, tools, evidence, model output, and the final plan are sealed in a reproducible audit chain") : t("只有形成交易计划后才封存完整决策审计链", "The full decision audit chain is sealed only after a trade plan is formed")}</span></footer>
      </div>}

      {/* 盯盘是持续服务；观察哨是其中一条结构化条件，命中才唤起新巡检。 */}
      <div className="agCard agentWatchRegistry kRegistry">
        <div className="agHeadIcon"><Eye size={13} /> {t("实时盯盘 · 观察条件", "Live watch · conditions")}</div>
        <small className="agWatchExplainer">{t("盯盘持续读取行情；观察哨只定义需要重新决策的关键价位。Telegram 仅推主条件命中与关键失效。", "Live watch continuously reads the market; each watch defines a decision-changing level. Telegram sends only primary triggers and critical invalidations.")}</small>
        {(() => {
          const all = data.watchTriggers || [];
          const board = (data.watchBoard || []).length ? data.watchBoard : [];
          const actives = board.length
            ? board.flatMap((group) => [group.primary, ...(group.secondary || [])].filter(Boolean).map((watch, index) => ({ ...watch, isPrimary: index === 0, boardAnalysisAt: group.analysisAt })))
            : all.filter((w) => w.status === "active").sort((a, b) => Number(b.priority === "primary") - Number(a.priority === "primary"));
          const recent = all.filter((w) => w.status !== "active").slice(0, 2);
          const label = { triggered: t("已触发重新分析 · 不直接下单", "Triggered re-analysis · no direct order"), expired: t("已过期", "Expired"), cancelled: t("已撤销", "Cancelled"), invalidated: t("已作废", "Void"), superseded: t("已被最新分析取代", "Superseded") };
          const purpose = (w) => w.isPrimary || w.priority === "primary" ? t("主观察哨", "Primary") : ({ confirmation: t("确认", "Confirmation"), invalidation: t("失效", "Invalidation"), alternative: t("备选", "Alternative"), decision: t("决策", "Decision") }[w.purpose] || t("辅助", "Supporting"));
          const direction = (w) => w.direction === "long" ? t("做多", "Long") : w.direction === "short" ? t("做空", "Short") : t("中性", "Neutral");
          const thesis = (w) => localizeText(w.displayThesis || w.thesis || w.analysisTitle, w.displayThesisEn || w.thesis || w.analysisTitle) || t("方向尚未确认", "Direction not confirmed");
          const meaning = (w) => localizeText(w.displayTriggerMeaning || w.triggerMeaning || w.note, w.displayTriggerMeaningEn || w.triggerMeaning || w.note) || t("命中后重新分析，不直接下单", "Re-analyze after trigger; no direct order");
          const desc = (w) => w.kind === "price_above" ? `${t("向上突破", "Breaks above")} ${displayPrice(w.level)}`
            : w.kind === "price_below" ? `${t("向下跌破", "Breaks below")} ${displayPrice(w.level)}`
              : `${t("回踩", "Pullback to")} ${displayPrice(w.levelLow)}–${displayPrice(w.levelHigh)}`;
          // 悬停显示完整信息(侧栏窄、note 被截断 → 鼠标放上去看全:条件 + 完整备注 + 状态 + 时间)。
          const fullInfo = (w) => [
            `${w.symbol} · ${direction(w)} · ${purpose(w)}`,
            `${t("原判断：", "Thesis: ")}${thesis(w)}`,
            `${t("等待条件：", "Condition: ")}${desc(w)}`,
            `${t("命中含义：", "If triggered: ")}${meaning(w)}`,
            w.status === "active"
              ? `${t("到期：", "Expires: ")}${new Date(w.expiresAt).toLocaleString("zh-CN")}`
              : `${label[w.status] || w.status}${w.status === "triggered" && w.triggerPrice ? ` @${displayPrice(w.triggerPrice)}` : ""}`,
            w.createdAt ? `${t("登记于：", "Logged: ")}${new Date(w.createdAt).toLocaleString("zh-CN")}` : ""
          ].filter(Boolean).join("\n");
          if (!all.length) return <small className="agWatchEmpty">{t("暂无观察哨。巡检得出\"若跌破/突破某价位\"的结论时，AI 会把条件登记在这里，WebSocket 实时核对真实行情，命中即刻唤起 AI 重新决策。", "No watches yet. When a scan concludes \"if price breaks below/above a level\", the AI logs the condition here; WebSocket ticks check live prices and wake the AI immediately when it hits.")}</small>;
          return (
            <div className="agWatchList">
              {actives.map((w) => {
                const remainH = Math.max(0, (new Date(w.expiresAt).getTime() - Date.now()) / 3_600_000);
                return (
                  <div className={`agWatchRow ${w.isPrimary || w.priority === "primary" ? "primary" : "supporting"}`} key={w.id} onMouseEnter={(e) => setWatchTip({ lines: fullInfo(w).split("\n"), rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setWatchTip(null)}>
                    <span className="agWatchDot" />
                    <div className="agWatchBody">
                      <b className="mono">{w.symbol}</b><em className={`agWatchDirection ${w.direction || "neutral"}`}>{direction(w)}</em><em className="agWatchRole">{purpose(w)}</em>
                      <span className="agWatchCondition">{desc(w)}</span>
                      <small>{t("原判断：", "Thesis: ")}{thesis(w)}</small>
                      <small>{t("命中：", "If hit: ")}{meaning(w)}</small>
                      {(w.isPrimary || w.priority === "primary") && w.boardAnalysisAt && <small>{t("最新市场分析", "Latest market analysis")} · {new Date(w.boardAnalysisAt).toLocaleString("zh-CN")}</small>}
                    </div>
                    <span className="agWatchMeta mono">{t("余", "Left")} {remainH >= 1 ? `${Math.round(remainH)}h` : `${Math.max(1, Math.round(remainH * 60))}m`}</span>
                    <button className="agWatchCancel" title={t("撤销观察哨", "Cancel watch")} onClick={async () => { if (await uiConfirm(`${t("撤销观察哨：", "Cancel watch: ")}${w.symbol} ${desc(w)}？`)) action(`/api/watch-triggers/${w.id}/cancel`, {}); }}><XCircle size={13} /></button>
                  </div>
                );
              })}
              {recent.map((w) => (
                <div className="agWatchRow closed" key={w.id} onMouseEnter={(e) => setWatchTip({ lines: fullInfo(w).split("\n"), rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setWatchTip(null)}>
                  <span className={`agWatchDot ${w.status}`} />
                  <div className="agWatchBody"><b className="mono">{w.symbol}</b><em className={`agWatchDirection ${w.direction || "neutral"}`}>{direction(w)}</em> {desc(w)}<small>{t("原判断：", "Thesis: ")}{thesis(w)}</small></div>
                  <span className="agWatchMeta mono">{label[w.status] || w.status}{w.status === "triggered" && w.triggerPrice ? ` @${displayPrice(w.triggerPrice)}` : ""}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* 授权与风控墙 */}
      <div className="agCard agentRiskInspector kInspector">
        <div className="agHeadIcon"><ShieldCheck size={13} /> {t("交易权限与硬风控", "Trading permissions & hard risk controls")}</div>
        <div className="agWallGrid">
          {mandateRows.map((r) => <div className="agWallRow" key={r.k}><span>{r.k}</span><b className="mono">{r.v}</b></div>)}
        </div>
        <div className="agBudget">
          <div className="agBudgetTop"><span>{t("今日亏损预算", "Today's loss budget")}</span><span>{remaining != null ? `${displayMoney(remaining, 2)} ${t("剩余", "left")}${budgetPct != null ? ` · ${budgetPct.toFixed(0)}%` : ""}` : t("未授权", "Not authorized")}</span></div>
          <div className="agBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
        </div>
        <div className="agWallBtns kActionBar">
          <button className="agBtnGhost" onClick={()=>ui.setActive("riskMandate")}>{t("查看资金与交易边界", "View capital and trading boundaries")}</button>
        </div>
      </div>

      {/* Agent 运行轨迹 */}
      <div className="agCard agentRunEvidence kEvidenceLedger">
        <div className="agTrajHead"><span className="agSecLabel"><i />{t("Agent 运行轨迹 · 最新循环", "Run trace · latest loop")}</span><button className="agLink" onClick={() => ui.setActive("auditSystem")}>{t("完整 ›", "Full ›")}</button></div>
        <div className="agTrajGrid">
          {!trajSteps.length && <div className="emptyPanel" style={{ gridColumn: "1 / -1" }}>{t("暂无运行记录；自动分析开始后会显示真实步骤轨迹", "No run records yet; the real step trace appears after automatic analysis starts")}</div>}
          {trajSteps.map(({ Icon, t, time }, i) => (
            <div className="agTrajCell" key={`${t}-${i}`}><span className="agTrajIcon"><Icon size={12} /></span><b>{t}</b><div className="agTrajTime mono">{time}</div></div>
          ))}
        </div>
      </div>

    </div>
  );
}

// 顶部 KPI 条:塞进「对话/情报」Tab 行右侧(bar=紧凑内联),填补标题区空白
export function ChatKpiStrip({ data, bar = false }) {
  const portfolio = data.portfolio || {};
  const perf = data.performance || {};
  const positions = data.positions || [];
  const btc = (data.markets || []).find((m) => /BTC/i.test(m.symbol || ""));
  const todayPnl = Number(portfolio.todayPnl || 0);
  const cumPnl = Number(perf.totalPnlUsdt ?? 0);
  const marginRate = marginUsage(portfolio).marginRatePct;
  const kpis = [
    { k: t("总资产", "Equity"), v: displayMoney(portfolio.totalEquityUsdt, 0, "—"), d: t("账户实时净值", "Live account equity"), plain: true },
    { k: t("持仓风险", "Position risk"), v: marginRate == null ? "—" : `${marginRate.toFixed(1)}%`, d: `${positions.length} ${t("个持仓", "positions")}`, plain: true },
    { k: t("今日盈亏", "Today PnL"), v: `${todayPnl >= 0 ? "+" : ""}${displayMoney(todayPnl, 0, "0")}`, d: portfolio.todayPnlPct != null ? displayPct(portfolio.todayPnlPct) : t("等待账户同步", "Awaiting account sync"), pos: todayPnl >= 0, colorVal: true },
    { k: t("累计盈亏", "Cumulative PnL"), v: `${cumPnl >= 0 ? "+" : ""}${displayMoney(cumPnl, 0, "0")}`, d: perf.trades ? `${perf.trades} ${t("笔", "trades")}` : t("尚无成交", "No fills yet"), pos: cumPnl >= 0, colorVal: true },
    { k: "BTC/USDT", v: btc ? displayMoney(btc.price, 0, "—") : "—", d: btc?.changePct != null ? displayPct(btc.changePct) : t("待同步", "Syncing"), pos: Number(btc?.changePct || 0) >= 0, colorVal: btc?.changePct != null }
  ];
  return (
    <div className={bar ? "chatKpiBar" : "chatKpiStrip"}>
      {kpis.map((kp) => (
        <div className="chatKpi" key={kp.k}>
          <div className="chatKpiK">{kp.k}</div>
          <div className="chatKpiLine"><span className={`chatKpiV mono ${kp.colorVal ? (kp.pos ? "pos" : "neg") : ""}`}>{kp.v}</span><span className={`chatKpiD mono ${kp.plain ? "" : kp.pos ? "pos" : "neg"}`}>{kp.d}</span></div>
        </div>
      ))}
    </div>
  );
}

function SetupChecklist({ onExample }) {
  const examples = [
    t("看看 BTC 现在的走势，说说你的判断", "Look at BTC's current trend and give me your read"),
    t("稳健做 BTC/ETH：单笔风险 0.3%，日亏损上限 1%，最大 3 倍杠杆，重大事件前 30 分钟停止开仓", "Trade BTC/ETH conservatively: 0.3% per-trade risk, 1% daily loss cap, max 3x leverage, stop opening 30 minutes before major events"),
    t("现在有哪些高影响事件？对我的持仓有什么风险？", "What high-impact events are there right now? What's the risk to my positions?")
  ];
  return (
    <div className="setupChecklist">
      <div className="examplePrompts">
        {examples.map((example) => <button key={example} onClick={() => onExample(example)}>{example}</button>)}
      </div>
    </div>
  );
}

// 把一条 AI 交易员分析渲染成精美海报,支持中/英切换与导出 PNG(社交分享获客)。
// 内容只用消息原文(中文)+ 后端 LLM 翻译(英文),不编造。图片在前端由 html-to-image 从模板导出。
export function PosterModal({ content, meta, onClose }) {
  const [lang, setLang] = useState("zh");
  const [enText, setEnText] = useState("");
  const [translating, setTranslating] = useState(false);
  const [transError, setTransError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const posterRef = useRef(null);
  const publishableContent = cleanPresentationText(content);

  useEffect(() => {
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function toEnglish() {
    setLang("en");
    if (enText || translating) return;
    setTranslating(true); setTransError("");
    try {
      const response = await fetch(apiUrl("/api/posters/translate"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: publishableContent })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.translated) throw new Error(json.error || `${t("翻译失败", "Translation failed")}(${response.status})`);
      setEnText(json.translated);
    } catch (error) {
      setTransError(error.message || t("翻译失败", "Translation failed")); setLang("zh");
    } finally { setTranslating(false); }
  }

  async function download() {
    if (!posterRef.current) return;
    setDownloading(true);
    try {
      // html-to-image 会按当前已加载字体生成 PNG；等待 Web 字体就绪，避免
      // Public Sans / Noto Sans SC 在导出瞬间被系统字体替代。
      if (document.fonts?.ready) await document.fonts.ready;
      const dataUrl = await toPng(posterRef.current, { pixelRatio: window.matchMedia?.("(max-width: 820px)").matches ? 3 : 2, cacheBust: true, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `ai-trader-${lang}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      setTransError(`${t("导出图片失败：", "Image export failed: ")}${error.message || error}`);
    } finally { setDownloading(false); }
  }

  const enReady = lang === "zh" || Boolean(enText);
  const body = lang === "en" ? enText : publishableContent;
  const dateStr = meta?.createdAt ? formatDateTime(meta.createdAt) : "";
  const patrol = buildPatrolView(meta);
  const posterTitle = patrol
    ? (lang === "en" ? "AUTONOMOUS PATROL" : "自主巡检记录")
    : (lang === "en" ? "MARKET FIELD NOTE" : "市场分析手记");
  const posterKind = patrol ? "PATROL / VERIFIED RECEIPTS" : "ANALYSIS / AI TRADER";

  return (
    <div className="posterOverlay" role="presentation" onClick={onClose}>
      <div className="posterModal" onClick={(e) => e.stopPropagation()}>
        <div className="posterToolbar kActionBar">
          <div className="posterToolbarContext">
            <small>{t("当前海报风格", "Current poster style")}</small>
            <b>EDITORIAL / FIELD NOTE</b>
          </div>
          <div className="posterToolbarControls">
            <div className="posterLangTabs" aria-label={t("海报语言", "Poster language")}>
              <button type="button" className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
              <button type="button" className={lang === "en" ? "active" : ""} onClick={toEnglish} disabled={translating}>
                {translating ? t("翻译中…", "Translating…") : "English"}
              </button>
            </div>
            <div className="posterActions">
              <button type="button" className="primaryButton" disabled={downloading || !enReady} onClick={download}>
                <Download size={14} /> {downloading ? t("生成中…", "Generating…") : t("下载 PNG", "Download PNG")}
              </button>
              <button type="button" className="posterClose" onClick={onClose} title={t("关闭", "Close")}><X size={16} /></button>
            </div>
          </div>
        </div>
        {transError && <div className="posterError">{transError}</div>}
        <div className="posterScroll">
          <div className="posterCanvas" ref={posterRef}>
            <div className="posterHeader">
              <div className="posterBrand">
                <span className="posterLogo"><img src="/kordyn-logo.svg" alt="KORDYN" /></span>
                <div className="posterBrandText">
                  <b>KORDYN</b>
                  <small>AI TRADING OPERATING SYSTEM</small>
                </div>
              </div>
              <span className="posterEdition">FIELD NOTE / {String(meta?.id || "LIVE").slice(-4).toUpperCase()}</span>
            </div>
            <div className="posterTitleBlock">
              <small>{posterKind}</small>
              <h1>{posterTitle}</h1>
              <div><span>{lang === "en" ? "GENERATED" : "生成时间"}</span><b>{dateStr || "—"}</b></div>
            </div>
            {patrol && <div className="posterPatrolFacts kTruthBand">
              <span><small>{lang === "en" ? "EVIDENCE" : "证据检查"}</small><b>{patrol.scope.evidence.value}/{patrol.scope.evidence.total}</b></span>
              <span><small>{lang === "en" ? "WATCHES" : "观察哨"}</small><b>{patrol.scope.watches.value}/{patrol.scope.watches.total}</b></span>
              <span><small>{lang === "en" ? "UNIVERSE" : "全市场"}</small><b>{patrol.scope.market.completed ? patrol.scope.market.universe : "—"}</b></span>
              <span><small>{lang === "en" ? "RECEIPTS" : "工具回执"}</small><b>{patrol.calls.total}</b></span>
            </div>}
            <div className="posterBody kEvidenceLedger">
              {lang === "en" && !enText
                ? <div className="posterTranslating">{translating ? "Translating…" : t("点击 English 生成英文版", "Click English to generate the English version")}</div>
                : <RichMessage text={body} poster />}
            </div>
            <div className="posterFooter">
              <div className="posterFootLeft">
                <span className="posterTag">{lang === "en" ? "SYSTEM-GENERATED / NOT FINANCIAL ADVICE" : "系统生成 / 仅供参考 / 不构成投资建议"}</span>
                <span className="posterSite">{lang === "en" ? "Audit the reasoning. Keep control." : "看见推理，保留控制。"} <b>{SITE_URL}</b></span>
              </div>
              <img className="posterQr" src={SITE_QR} alt={SITE_URL} width="72" height="72" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage({ data, action, ui, concept = false, mobile = false, surface = "dialog" }) {
  const [messages, setMessages] = useState([]);
  const [posterMsg, setPosterMsg] = useState(null); // 当前要生成海报的 AI 消息
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState("chat");
  const [provider, setProvider] = useState(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const latestMessageRef = useRef(null);
  const messageLoadVersion = useRef(0);
  const surfaceMode = ["patrol", "poster"].includes(surface) ? surface : "dialog";
  const archiveSurface = surfaceMode !== "dialog";
  // 输入框自动长高:随内容增高到 160px 上限,超过再内部滚动——不再卡在 1 行看不全打的字。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  async function loadMessages(sessionId = activeSessionId, requestedSurface = surfaceMode) {
    const requestVersion = ++messageLoadVersion.current;
    try {
      const path = agentChatRequestForSurface(requestedSurface, sessionId);
      const response = await fetch(apiUrl(path), { headers: authHeaders() });
      if (!response.ok) return;
      const json = await response.json();
      if (requestVersion !== messageLoadVersion.current) return;
      setMessages(json.messages || []);
      setSessions(json.sessions || []);
      setActiveSessionId(json.activeSessionId || json.sessions?.[0]?.id || "");
      setProvider(json.provider);
    } catch {}
  }

  useEffect(() => {
    loadMessages("", surfaceMode);
    return () => { messageLoadVersion.current += 1; };
  }, [surfaceMode]);
  useEffect(() => {
    const latest = messages[messages.length - 1];
    // 用户消息和思考态仍贴近输入框；新的 AI 长简报必须定位到卡片顶部，
    // 否则自动滚到底会直接跳过“本轮结论”和状态，用户第一眼只看到工具调用。
    if (latest && latest.role !== "user" && !pending && latestMessageRef.current) {
      const scroller = scrollRef.current;
      const target = latestMessageRef.current;
      if (scroller) {
        // Keep movement inside the message scroller. scrollIntoView also moved WebKit's outer
        // ancestors, which made the native conversation appear to float.
        const top = Math.max(0, scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8);
        scroller.scrollTo({ top, behavior: mobile ? "auto" : "smooth" });
      }
      return;
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: mobile ? "auto" : "smooth" });
  }, [messages.length, pending, mobile]);

  // 切走页面会 unmount ChatPage,发出去的问题在后端照常处理并落库,但组件本地的"思考中"状态丢了。
  // 重新进入时:若最后一条是用户消息(还没等到 AI 回复),说明有一轮在后端进行/刚完成——
  // 显示思考态并轮询,回复落库后自动补上,不再"停止思考不回答"(用户实锤)。
  const awaitingReply = messages.length > 0 && messages[messages.length - 1].role === "user";
  useEffect(() => {
    if (!awaitingReply || pending) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      loadMessages();
      if (tries >= 40) clearInterval(timer); // 最多轮询 2 分钟
    }, 3000);
    return () => clearInterval(timer);
  }, [awaitingReply, pending, activeSessionId]);

  async function send(textOverride) {
    const text = String(textOverride ?? input).trim();
    if (!text || pending) return;
    setInput("");
    setPending(true);
    setMessages((current) => [...current, { id: `tmp_${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() }]);
    try {
      const response = await fetch(apiUrl("/api/agent/chat"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: text, sessionId: activeSessionId })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `${t("请求失败", "Request failed")} ${response.status}`);
      await loadMessages(json.agentMessage?.sessionId || activeSessionId);
      await ui.refresh(false);
    } catch (error) {
      setMessages((current) => [...current, { id: `err_${Date.now()}`, role: "agent", content: `${t("请求失败：", "Request failed: ")}${error.message}`, createdAt: new Date().toISOString() }]);
    } finally {
      setPending(false);
    }
  }

  function findPlan(planId) {
    return (data.tradePlans || []).find((plan) => plan.id === planId);
  }
  function findMandate(mandateId) {
    return (data.mandates || []).find((mandate) => mandate.id === mandateId);
  }
  function findStrategyDraft(draftId) {
    return (data.strategyStudio?.drafts || []).find((draft) => draft.id === draftId);
  }
  function currentStateForMessage(message) {
    const presentation = message.presentation;
    if (!presentation?.linked) return null;
    const order = (data.executionOrders || []).find((item) => item.id === presentation.linked.executionOrderId || item.planId === presentation.linked.planId);
    if (order?.status) return order.status;
    const plan = (data.tradePlans || []).find((item) => item.id === presentation.linked.planId);
    if (plan?.status) return plan.status;
    const watch = (data.watchTriggers || []).find((item) => item.id === presentation.linked.watchId);
    if (watch?.status === "active") return "watching";
    if (watch?.status) return watch.status;
    return presentation.decision?.state || null;
  }
  function currentExecutionForMessage(message) {
    const linked = message.presentation?.linked;
    return buildCurrentExecutionSnapshot(data, linked || {});
  }
  function currentPositionForMessage(message) {
    const symbol = message.presentation?.symbol;
    if (!symbol) return null;
    const row = (data.positions || []).find((item) => item.symbol === symbol && item.source === "execution_engine" && Number(item.quantity ?? item.size ?? item.pos ?? 0) !== 0)
      || (data.positions || []).find((item) => item.symbol === symbol && Number(item.quantity ?? item.size ?? item.pos ?? 0) !== 0);
    if (!row) return null;
    const rawDirection = String(row.direction ?? row.posSide ?? "").toLowerCase();
    const direction = rawDirection.includes("short") || rawDirection.includes("空") || rawDirection === "sell" ? "short" : "long";
    return {
      direction,
      size: row.quantity ?? row.size ?? row.pos ?? null,
      entryPrice: row.entry ?? row.entryPrice ?? row.avgPx ?? null,
      markPrice: row.mark ?? row.markPrice ?? null,
      unrealizedPnl: row.pnl ?? row.unrealizedPnl ?? null,
      leverage: row.leverage ?? null
    };
  }
  const visibleMessages = surfaceMode === "patrol"
    ? messages.filter((message) => message.role !== "user" && message.sessionId === "chat_autocycle" && message.capabilityCoverage)
    : surfaceMode === "poster"
      ? messages.filter((message) => message.role !== "user" && String(message.content || "").length > 80)
      : messages;
  const latestAgentMessageId = [...visibleMessages].reverse().find((message) => message.role !== "user")?.id || null;
  // 新建对话只在本地开启一个"草稿会话"，不立刻建库；发第一条消息时后端才真正创建
  // 并用首句作为标题。这样空对话永远不会留进历史记录。
  function newSession() {
    setActiveSessionId("");
    setMessages([]);
    setShowHistory(false);
  }

  function switchSession(sessionId) {
    setActiveSessionId(sessionId);
    loadMessages(sessionId);
    setShowHistory(false);
  }

  async function deleteSession(sessionId, event) {
    event.stopPropagation();
    try {
      const response = await fetch(apiUrl(`/api/agent/chat/sessions/${sessionId}`), { method: "DELETE", headers: authHeaders() });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || t("删除失败", "Delete failed"));
      setSessions(json.sessions || []);
      if (sessionId === activeSessionId) { setActiveSessionId(""); setMessages([]); }
    } catch (error) {
      ui.notify?.(error.message || t("删除失败", "Delete failed"));
    }
  }

  // 一次性清空全部对话历史（含早期悬浮助手混入的只读问答）。计划/授权/审计/成交不受影响。
  async function resetHistory() {
    if (!await uiConfirm(t("清空全部对话历史？（含早期 AI 助手混入的问答）\n交易计划、授权、审计、成交记录不受影响，无法撤销。", "Clear all chat history? (including early Q&A mixed in from the assistant)\nTrade plans, mandates, audits, and fills are unaffected. This cannot be undone."))) return;
    try {
      const response = await fetch(apiUrl("/api/agent/chat/reset"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || t("清空失败", "Clear failed"));
      setSessions([]); setActiveSessionId(""); setMessages([]);
      ui.notify?.(json.message || t("已清空聊天历史", "Chat history cleared"));
    } catch (error) {
      ui.notify?.(error.message || t("清空失败", "Clear failed"));
    }
  }

  return (
    <div className={`chatShell ${view === "intel" ? "intel" : ""} ${concept ? "conceptChatShell" : ""} ${mobile ? "mobileChatShell" : ""} ${archiveSurface ? "aiArchiveSurface" : ""}`} data-ai-surface={surfaceMode}>
    <div className="agChat">
      <div className={mobile ? "agChatMobileBar" : "agChatHead"}>
        <div className="agChatTitle"><span className="agChatNum">1</span>{surfaceMode === "patrol" ? t("自主巡检记录", "Autonomous patrol receipts") : surfaceMode === "poster" ? t("分析海报", "Analysis posters") : view === "chat" ? t("与 AI 交易员对话", "Chat with the AI trader") : t("情报中心", "Intel Center")}</div>
        <div className="agChatHeadR">
          {!archiveSurface && <div className="agViewToggle">
            <button className={view === "chat" ? "on" : ""} title={t("对话", "Chat")} onClick={() => setView("chat")}><MessageSquare size={13} /></button>
            <button className={view === "intel" ? "on" : ""} title={t("情报", "Intel")} onClick={() => setView("intel")}><Radar size={13} /></button>
          </div>}
          {mobile && view === "chat" && !archiveSurface && <button className="agMobileIconBtn" onClick={newSession} aria-label={t("新建对话", "New chat")}><Plus size={17} /></button>}
          {mobile && view === "chat" && !archiveSurface && <button className="agMobileIconBtn" onClick={() => setShowHistory(true)} aria-label={t("对话历史", "Chat history")}><Clock3 size={17} />{sessions.length > 0 && <b>{sessions.length}</b>}</button>}
        </div>
      </div>

      {mobile && showHistory && <div className="mChatHistoryOverlay" onClick={() => setShowHistory(false)}>
        <section className="mChatHistorySheet" onClick={(event) => event.stopPropagation()}>
          <div className="mChatHistoryHead"><div><b>{t("对话历史", "Chat history")}</b><small>{t("选择一段对话继续", "Choose a conversation to continue")}</small></div><button onClick={() => setShowHistory(false)} aria-label={t("关闭", "Close")}><X size={18}/></button></div>
          <button className="mChatNewSession" onClick={newSession}><Plus size={16}/>{t("新建对话", "New conversation")}</button>
          <div className="mChatHistoryList">
            {sessions.map((session) => <button className={session.id === activeSessionId ? "active" : ""} key={session.id} onClick={() => switchSession(session.id)}><span><b>{localizeText(session.title || t("未命名对话", "Untitled"))}</b><small>{formatTime(session.updatedAt || session.createdAt)}</small></span><ChevronRight size={16}/></button>)}
            {!sessions.length && <p>{t("还没有历史对话", "No conversation history yet")}</p>}
          </div>
          {sessions.length > 0 && <button className="mChatClearHistory" onClick={resetHistory}><Trash2 size={14}/>{t("清空全部历史", "Clear all history")}</button>}
        </section>
      </div>}

      {view === "intel" ? <IntelCenter data={data} /> : (<>
      {!mobile && !archiveSurface && <div className={`agHistBar ${concept ? "conceptHistBar" : ""}`}>
        <span className="agHistLabel">{t("对话历史", "History")}</span>
        <button className="agSessChip newSess" onClick={() => newSession()}><Plus size={12} /> {t("新建", "New")}</button>
        {sessions.length > 0 && <button className="agSessChip clearAll" onClick={resetHistory} title={t("清空全部对话历史（含早期 AI 助手混入的问答）", "Clear all chat history (including early Q&A mixed in from the assistant)")}><Trash2 size={11} /> {t("清空", "Clear")}</button>}
        {sessions.map((s) => (
          <button className={`agSessChip ${s.id === activeSessionId ? "on" : ""}`} key={s.id} onClick={() => switchSession(s.id)} title={s.title}>
            {s.id === activeSessionId && <MessageSquare size={12} />}
            {localizeText(s.title || t("未命名对话", "Untitled")).slice(0, 24)} · {formatTime(s.updatedAt || s.createdAt)}
            <i className="agSessDel" title={t("删除", "Delete")} onClick={(e) => deleteSession(s.id, e)}>×</i>
          </button>
        ))}
      </div>}

      <div className="agMsgs" ref={scrollRef}>
        {archiveSurface && <header className="aiArchiveIntro"><small>{surfaceMode === "patrol" ? "AUTONOMOUS PATROL / VERIFIED" : "EDITORIAL / FIELD NOTES"}</small><b>{surfaceMode === "patrol" ? t("每轮巡检的范围、工具调用和证据覆盖都保留在这里。", "Every patrol preserves its scope, tool calls, and evidence coverage here.") : t("从真实 AI 分析生成中英文海报；文案与事实始终来自原始分析。", "Generate bilingual posters from real AI analysis; copy and facts remain tied to the source.")}</b></header>}
        {!archiveSurface && !messages.length && <SetupChecklist onExample={(example) => send(example)} />}
        {archiveSurface && !visibleMessages.length && <div className="aiArchiveEmpty"><b>{surfaceMode === "patrol" ? t("还没有可核验的自主巡检记录", "No verified autonomous patrol receipt yet") : t("还没有可转换的分析", "No analysis is ready for poster conversion")}</b><p>{surfaceMode === "patrol" ? t("系统产生新的自主巡检后，会在此显示真实检查范围与工具回执。", "New autonomous patrols will appear here with their real scope and tool receipts.") : t("返回对话完成一次较完整的分析，随后可在这里选择并生成海报。", "Complete a substantial analysis in Conversation, then choose it here to create a poster.")}</p></div>}
        {visibleMessages.map((message, messageIndex) => (message.role === "user" ? (
          <div className="agMsgUserRow" key={message.id} ref={messageIndex === visibleMessages.length - 1 ? latestMessageRef : null}>
            <div className="agBubbleUser"><RichMessage text={message.content} compact onSuggest={null} /></div>
            <small className="agMsgMeta userSide">{formatTime(message.createdAt)}</small>
          </div>
        ) : (
          <div className="agMsgAiRow" key={message.id} ref={messageIndex === visibleMessages.length - 1 ? latestMessageRef : null}>
            <span className="agAvatar"><Bot size={18} /></span>
            <div className={`agBubbleAi ${message.presentation?.layout === "decision_brief" ? "decisionMessage" : ""}`}>
              <div className="agAiLabel"><span>{t("AI 交易员", "AI Trader")}</span></div>
              {message.presentation?.layout === "decision_brief" ? (
                <DecisionBrief
                  presentation={message.presentation}
                  content={message.content}
                  currentState={currentStateForMessage(message)}
                  currentExecution={currentExecutionForMessage(message)}
                  currentPosition={message.id === latestAgentMessageId ? currentPositionForMessage(message) : undefined}
                  isLatest={message.id === latestAgentMessageId}
                  onSuggest={!pending ? (value) => send(value) : null}
                />
              ) : <RichMessage text={message.content} onSuggest={!pending ? (value) => send(value) : null} />}
              {message.mandateId && <MandateCard mandate={findMandate(message.mandateId)} action={action} />}
              {message.strategyDraftId && <StrategyDraftCard draft={findStrategyDraft(message.strategyDraftId)} ui={ui} mobile={mobile} />}
              {message.planId && (
                <PlanCard plan={findPlan(message.planId)} executionOrder={(data.executionOrders || []).find((item) => item.planId === message.planId)} action={action} ui={ui} markets={data.markets} data={data} />
              )}
              {message.sessionId === "chat_autocycle" && message.capabilityCoverage
                ? <PatrolReceipt message={message} mobile={mobile} />
                : <ToolTrace trace={message.toolTrace || []} coverage={message.capabilityCoverage} callSummary={message.toolCallSummary} />}
              <div className="agMsgFootRow">
                <small className="agMsgMeta">{formatTime(message.createdAt)}{message.model ? ` · ${message.model}` : ""}</small>
                {String(message.content || "").length > 80 && (
                  <button type="button" className="agPosterBtn" title={t("把这条分析做成海报（中/英，可导出）", "Turn this analysis into a poster (ZH/EN, exportable)")} onClick={() => setPosterMsg(message)}>
                    <ImageIcon size={13} /> {t("海报", "Poster")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )))}
        {!archiveSurface && (pending || awaitingReply) && (
          <div className="agMsgAiRow">
            <span className="agAvatar"><Bot size={18} /></span>
            <div className="agBubbleAi"><div className="thinkingDots"><span /><span /><span /></div>{awaitingReply && !pending && <small className="agThinkNote">{t("思考中·可切走稍后回来查看", "Thinking · you can switch away and check back later")}</small>}</div>
          </div>
        )}
      </div>

      {!archiveSurface && (data.pendingActions || []).length > 0 && (
        <div className="pendingActionsDock">
          {(data.pendingActions || []).map((pa) => (
            <div className={`pendingActionCard ${pa.danger ? "danger" : ""}`} key={pa.id}>
              <div className="paInfo"><span className="paBadge">{t("待确认操作", "Pending action")}</span><b>{pa.title}</b><small>{pa.detail}</small></div>
              <div className="paActions kActionBar">
                <button className="secondaryButton" onClick={() => action(`/api/agent/actions/${pa.id}/cancel`, {})}>{t("取消", "Cancel")}</button>
                <button className={pa.danger ? "dangerButton" : "primaryButton"} onClick={() => action(`/api/agent/actions/${pa.id}/confirm`, {})}>{t("确认执行", "Confirm")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {posterMsg && <PosterModal content={stripCitationMarkers(posterMsg.content)} meta={posterMsg} onClose={() => setPosterMsg(null)} />}

      {!archiveSurface && <div className="agInputBar">
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder={provider ? `${t("输入指令，与 AI 交易员对话…", "Message the AI trader…")}（${provider.name}/${provider.model}）` : t("输入指令，与 AI 交易员对话… 例如「把仓位降到 5%」", "Message the AI trader… e.g. \"Cut my position to 5%\"")}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
        />
        <button className="agSend" disabled={pending || !input.trim()} onClick={() => send()} aria-label={t("发送", "Send")}><ArrowUp size={18} /></button>
      </div>}
      </>)}
    </div>
    {view === "chat" && !archiveSurface && <AgentRail data={data} action={action} ui={ui} />}
    </div>
  );
}

// 情报中心：把新闻聚合成的"事件专题"按热点排序展示，每个专题可展开看持续跟进的时间线。
function IntelCenter({ data = {} }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState({});

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(apiUrl("/api/events/intel"), { headers: authHeaders() });
      const json = await response.json();
      setEvents(Array.isArray(json) ? json : []);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    try {
      await fetch(apiUrl("/api/event-sources/refresh"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      await load();
    } catch {} finally { setBusy(false); }
  }

  async function removeIntel(id, event) {
    event.stopPropagation();
    try {
      const response = await fetch(apiUrl(`/api/events/${id}`), { method: "DELETE", headers: authHeaders() });
      if (!response.ok) { const j = await response.json().catch(() => ({})); throw new Error(j.error || `删除失败 ${response.status}`); } // 此前 403/404 也本地删除,刷新又复活(审计 M4)
      setEvents((current) => current.filter((item) => item.id !== id));
    } catch {}
  }

  return (
    <div className="intelCenter">
      <div className="intelHead">
        <div>
          <h3>{t("情报中心", "Intel Center")}</h3>
          <span>{t("把零散新闻聚合成事件专题，按影响度、热度、时效与你的持仓相关性排序、持续跟进", "Aggregates scattered news into event threads, ranked by impact, heat, recency and relevance to your positions, and followed over time")}</span>
        </div>
        <button className="secondaryButton" onClick={refresh} disabled={busy}><RefreshCw size={14} /> {busy ? t("刷新中…", "Refreshing…") : t("刷新情报", "Refresh intel")}</button>
      </div>
      {(() => {
        // 自动刷新状态条:直接读事件源刷新定时任务的真实 上次/下次,让用户看出它在按 20 分钟节奏转,
        // 而不是"只有手动点才更新"。任务不存在(旧库未排程)时不显示。
        const lanes = [
          ["task_sys_news_flash", t("快讯", "Flash")],
          ["task_sys_event_source_refresh", "RSS"],
          ["task_sys_event_refresh", t("深层整合", "Deep")]
        ].map(([id, label]) => [(data.tasks || []).find((x) => x.id === id), label]).filter(([task]) => task);
        if (!lanes.length) return null;
        const paused = lanes.every(([task]) => task.enabled === false);
        return (
          <div className={`intelAutoBar ${paused ? "off" : "on"}`}>
            <span className="intelAutoDot" />
            <b>{paused ? t("自动刷新已暂停", "Auto-refresh paused") : t("分层新闻流运行中", "Layered news feed running")}</b>
            <small>{lanes.map(([task, label]) => `${label} ${String(task.schedule || "").replace(/^Every\s*/i, "")}`).join(" · ")}</small>
          </div>
        );
      })()}
      {(data.newsFeed || []).length > 0 && (
        <div className="missedOppCard">
          <div className="missedOppHead"><Radar size={14} /> {t("7×24 实时快讯", "24/7 Flash News")} <small>{t("重要且相关的快讯只会唤起 AI 复核，不会直接下单", "Important relevant flashes only wake AI review; never trade directly")}</small></div>
          <div className="missedOppList">
            {(data.newsFeed || []).slice(0, 10).map((item) => (
              <div className="missedOppRow" key={item.id}>
                <b>{item.values?.important ? t("重要", "Important") : t("快讯", "Flash")}</b>
                <span>{formatDateTime(item.publishedAt, "—")}</span>
                <p title={item.summary}>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(data.missedOpportunities || []).length > 0 && (
        <div className="missedOppCard">
          <div className="missedOppHead"><BookOpen size={14} /> 错过机会复盘 <small>大波动却没交易的复盘，已沉淀进 AI 记忆</small></div>
          <div className="missedOppList">
            {(data.missedOpportunities || []).slice(0, 6).map((m) => (
              <div className={`missedOppRow ${m.inWhitelist ? "wl" : ""}`} key={m.key}>
                <b>{m.symbol}</b>
                <span className={m.changePct >= 0 ? "pos" : "neg"}>{m.changePct >= 0 ? "+" : ""}{m.changePct}%</span>
                {m.inWhitelist ? <em className="tagWl">白名单内·本可做</em> : <em className="tagOff">白名单外</em>}
                {m.analyzed && <em className="tagAn">分析过没做</em>}
                {m.lesson && <p title={m.lesson}>{m.lesson}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {loading && !events.length ? (
        <div className="emptyPanel">加载中…</div>
      ) : !events.length ? (
        <div className="emptyPanel emptyPanelAction"><strong>暂无情报</strong><button className="secondaryButton" onClick={refresh}><RefreshCw size={14} /> 刷新情报</button></div>
      ) : (
        <div className="intelList">
          {events.map((ev) => {
            const open = expanded[ev.id];
            const tone = ev.impact >= 80 ? "danger" : ev.impact >= 50 ? "warning" : "neutral";
            const dirTone = /空/.test(ev.directionHint || "") ? "negative" : /多/.test(ev.directionHint || "") ? "positive" : "";
            // 25 分钟内有新报道并进来的专题 = 刚更新(一轮自动刷新的窗口),打新鲜标让归并进时间线的新新闻显出来。
            const freshMs = ev.lastUpdatedAt ? Date.now() - new Date(ev.lastUpdatedAt).getTime() : Infinity;
            const fresh = freshMs >= 0 && freshMs < 25 * 60 * 1000;
            return (
              <div className={`intelCard ${tone}`} key={ev.id}>
                <div className="intelCardTop">
                  <button className="intelCardHead" onClick={() => setExpanded((state) => ({ ...state, [ev.id]: !state[ev.id] }))}>
                    <div className="intelTitleRow">
                      <span className="intelHot">🔥 {ev.hotScore}</span>
                      <b>{ev.title}</b>
                      <StatusBadge tone={tone}>{ev.impactLabel}</StatusBadge>
                    </div>
                    <div className="intelMeta">
                      {fresh && <span className="intelFresh" title={`最近更新 ${formatDateTime(ev.lastUpdatedAt, "—")}`}>刚更新</span>}
                      <span>{ev.updateCount || 1} 条报道</span>
                      {ev.directionHint && <span className={`intelDir ${dirTone}`}>{ev.directionHint}</span>}
                      {(ev.relatedSymbols || []).slice(0, 3).map((symbol) => <span key={symbol} className="intelSym">{symbol}</span>)}
                      <ChevronDown size={14} className={open ? "intelChevron open" : "intelChevron"} />
                    </div>
                  </button>
                  <button className="intelDelete" title="删除该情报专题" onClick={(event) => removeIntel(ev.id, event)}><Trash2 size={15} /></button>
                </div>
                {ev.action && <p className="intelAssess">{ev.action}</p>}
                {open && (
                  <div className="intelTimeline">
                    {(ev.timeline || []).map((update, index) => (
                      <div className="intelUpdate" key={index}>
                        <time>{formatDateTime(update.at, "—")}</time>
                        <div className="intelUpdateBody">
                          {update.link
                            ? <a href={update.link} target="_blank" rel="noreferrer" title="打开原文">{update.title}</a>
                            : <b>{update.title}</b>}
                          {update.source && <small>{update.source}</small>}
                        </div>
                      </div>
                    ))}
                    {!(ev.timeline || []).length && <div className="intelUpdate"><span className="muted">暂无跟进记录</span></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
