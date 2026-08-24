import * as cheerio from "cheerio";
import { fetchExternalText, withSafeExternalResponse } from "./externalInputSafety.mjs";
import { nowIso } from "./store.mjs";

const FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const BLS_ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
const OMB_PFEI_URL = "https://www.whitehouse.gov/omb/information-resources/guidance/us-principal-federal-economic-indicators/";
const CFTC_POLICY_RSS_URL = "https://www.cftc.gov/RSS/RSSGP/rssgp.xml";
const SEC_POLICY_RSS_URL = "https://www.sec.gov/news/pressreleases.rss";
const TIME_ZONE_ALIASES = new Map([
  // BLS 的 ICS 当前仍会返回旧 Olson 别名；部分精简 ICU 运行时不接受该别名。
  ["US-Eastern", "America/New_York"]
]);
const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12]
]);
const POLICY_RELEVANCE = /crypto|digital\s+asset|blockchain|token|stablecoin|bitcoin|ethereum|innovation\s+advisory/i;
const MONTH_DATE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:\s*,\s*(20\d{2}))?\b/gi;
const OMB_BLS_SERIES = [
  { label: "The Employment Situation", title: "Employment Situation" },
  { label: "Producer Price Indexes", title: "Producer Price Index" },
  { label: "Consumer Price Index", title: "Consumer Price Index" },
  { label: "U.S. Import and Export Price Indexes", title: "Import and Export Price Indexes" }
];

function startOfUtcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function futurePolicyDate(text, publishedAt, now) {
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return null;
  const minimum = startOfUtcDay(now);
  const maximum = minimum + 400 * 24 * 3_600_000;
  const publishedDay = startOfUtcDay(published);
  const matches = [...String(text || "").matchAll(MONTH_DATE)];
  for (const match of matches) {
    const month = MONTHS.get(match[1].toLowerCase());
    const day = Number(match[2]);
    let year = match[3] ? Number(match[3]) : published.getUTCFullYear();
    if (!month || day < 1 || day > 31) continue;
    let timestamp = Date.UTC(year, month - 1, day);
    if (!match[3] && timestamp < publishedDay) {
      year += 1;
      timestamp = Date.UTC(year, month - 1, day);
    }
    const normalized = new Date(timestamp);
    if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day) continue;
    if (timestamp >= minimum && timestamp <= maximum && timestamp >= publishedDay) return new Date(timestamp).toISOString();
  }
  return null;
}

function xmlText($, item, selector) {
  return $(item).find(selector).first().text().replace(/\s+/g, " ").trim();
}

function htmlText(value) {
  return cheerio.load(String(value || "")).text().replace(/\s+/g, " ").trim();
}

function regexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseOmbPfeiScheduleLinks(html, years = []) {
  const allowedYears = new Set(years.map(Number).filter(Number.isInteger));
  const $ = cheerio.load(String(html || ""));
  const links = new Map();
  $("a[href]").each((_index, anchor) => {
    let url;
    try { url = new URL($(anchor).attr("href"), OMB_PFEI_URL); } catch { return; }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "whitehouse.gov" && !host.endsWith(".whitehouse.gov"))) return;
    if (!url.pathname.startsWith("/wp-content/uploads/") || !url.pathname.toLowerCase().endsWith(".pdf")) return;
    const year = Number(url.pathname.match(/pfei_schedule_release_dates_cy(20\d{2})[^/]*\.pdf$/i)?.[1]);
    if (!Number.isInteger(year) || (allowedYears.size && !allowedYears.has(year)) || links.has(year)) return;
    links.set(year, { year, url: url.toString() });
  });
  return [...links.values()].sort((a, b) => a.year - b.year);
}

export function parseOmbPfeiScheduleText(text, options = {}) {
  const year = Number(options.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return [];
  const observedAt = options.observedAt || nowIso();
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : new Date(observedAt).getTime();
  const minimum = startOfUtcDay(now) - 24 * 3_600_000;
  const maximum = startOfUtcDay(now) + 400 * 24 * 3_600_000;
  const sourceUrl = String(options.sourceUrl || OMB_PFEI_URL);
  const normalized = String(text || "").replace(/\r/g, "");
  const blsAt = normalized.indexOf("BUREAU OF LABOR STATISTICS");
  if (blsAt < 0) return [];
  const section = normalized.slice(blsAt, normalized.indexOf("FEDERAL RESERVE BOARD", blsAt) > blsAt
    ? normalized.indexOf("FEDERAL RESERVE BOARD", blsAt)
    : blsAt + 8_000);
  const events = [];
  for (const series of OMB_BLS_SERIES) {
    const pattern = new RegExp(`${regexLiteral(series.label)}[\\s\\S]{0,260}?\\)\\s*([\\d-]+(?:\\s+[\\d-]+){11})`);
    const values = section.match(pattern)?.[1]?.trim().split(/\s+/);
    if (!values || values.length !== 12) continue;
    for (let month = 0; month < values.length; month += 1) {
      if (values[month] === "--") continue;
      const day = Number(values[month]);
      const timestamp = Date.UTC(year, month, day);
      const date = new Date(timestamp);
      if (!Number.isInteger(day) || day < 1 || day > 31 || date.getUTCMonth() !== month || timestamp < minimum || timestamp > maximum) continue;
      events.push({
        id: `calendar_bls_omb_${year}${String(month + 1).padStart(2, "0")}${String(day).padStart(2, "0")}_${series.title}`.replace(/[^a-zA-Z0-9_-]+/g, "_"),
        sourceId: "official_bls_calendar",
        sourceName: "White House OMB PFEI Schedule (BLS)",
        sourceUrl,
        category: "macro",
        title: series.title,
        due: date.toISOString(),
        timePrecision: "date",
        timeZone: "America/New_York",
        importance: "high",
        symbols: ["BTC/USDT", "ETH/USDT"],
        verified: true,
        verifiedOrigin: true,
        analysisOnly: true,
        mayTriggerTradeDirectly: false,
        fallback: true,
        firstObservedAt: observedAt,
        fetchedAt: observedAt
      });
    }
  }
  return events.sort((a, b) => new Date(a.due) - new Date(b.due));
}

export function selectBlsCalendarResult(primary, fallback) {
  if (primary?.status === "ok") return primary;
  const primaryError = String(primary?.error || primary?.status || "unavailable");
  if (fallback?.status === "ok" && fallback.events?.length) {
    return {
      ...fallback,
      status: "partial",
      error: `BLS ICS: ${primaryError}`,
      latencyMs: Number(primary?.latencyMs || 0) + Number(fallback.latencyMs || 0)
    };
  }
  return {
    ...(primary || { status: "failed", events: [] }),
    error: `BLS ICS: ${primaryError}; OMB fallback: ${String(fallback?.error || fallback?.status || "unavailable")}`
  };
}

export function getCachedOmbBlsFallback(db, now = Date.now()) {
  const events = (db.marketCalendarEvents || []).filter((event) => {
    if (event.sourceId !== "official_bls_calendar" || event.fallback !== true) return false;
    const fetchedAt = new Date(event.fetchedAt || 0).getTime();
    const due = new Date(event.due || 0).getTime();
    const age = now - fetchedAt;
    return Number.isFinite(fetchedAt) && age >= 0 && age < 24 * 3_600_000
      && Number.isFinite(due) && due >= now - 24 * 3_600_000;
  });
  if (!events.length) return null;
  return { status: "ok", events, sourceUrl: events[0].sourceUrl || OMB_PFEI_URL, cached: true, latencyMs: 0 };
}

async function fetchExternalBuffer(url, options = {}) {
  const maxBytes = Math.max(1024, Number(options.maxBytes ?? 3 * 1024 * 1024));
  return withSafeExternalResponse(url, options, async (response, context) => {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`外部内容超过 ${maxBytes} 字节限制`);
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body || []) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error(`外部内容超过 ${maxBytes} 字节限制`);
      chunks.push(Buffer.from(chunk));
    }
    return { response, buffer: Buffer.concat(chunks), finalUrl: context.finalUrl };
  });
}

async function fetchOmbBlsCalendar(now = Date.now()) {
  const startedAt = Date.now();
  try {
    const index = await fetchExternalText(OMB_PFEI_URL, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
    if (!index.response.ok) throw new Error(`OMB index HTTP ${index.response.status}`);
    const currentYear = new Date(now).getUTCFullYear();
    const links = parseOmbPfeiScheduleLinks(index.text, [currentYear, currentYear + 1]);
    if (!links.length) throw new Error("OMB PFEI index has no current schedule PDF");
    const { PDFParse } = await import("pdf-parse");
    const eventGroups = await Promise.all(links.map(async (link) => {
      const pdf = await fetchExternalBuffer(link.url, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
      if (!pdf.response.ok) throw new Error(`OMB PFEI PDF HTTP ${pdf.response.status}`);
      if (!pdf.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("OMB PFEI response is not a PDF");
      const parser = new PDFParse({ data: pdf.buffer });
      try {
        const parsed = await parser.getText();
        return parseOmbPfeiScheduleText(parsed.text, { year: link.year, sourceUrl: link.url, now });
      } finally {
        await parser.destroy();
      }
    }));
    const events = eventGroups.flat().sort((a, b) => new Date(a.due) - new Date(b.due));
    if (!events.length) throw new Error("OMB PFEI PDF has no usable future BLS dates");
    return { status: "ok", events, sourceUrl: OMB_PFEI_URL, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "failed", events: [], sourceUrl: OMB_PFEI_URL, error: String(error.message || error).slice(0, 180), latencyMs: Date.now() - startedAt };
  }
}

export function parseOfficialPolicyRss(xml, options = {}) {
  const sourceId = String(options.sourceId || "official_policy_calendar");
  const sourceName = String(options.sourceName || sourceId);
  const feedUrl = String(options.sourceUrl || "");
  const observedAt = options.observedAt || nowIso();
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : new Date(observedAt).getTime();
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  const events = [];
  $("item").each((_index, item) => {
    const title = xmlText($, item, "title");
    const description = htmlText(xmlText($, item, "description, content\\:encoded"));
    const combined = `${title} ${description}`;
    if (!POLICY_RELEVANCE.test(combined)) return;
    const rawPublishedAt = xmlText($, item, "pubDate, dc\\:date");
    const publishedDate = new Date(rawPublishedAt);
    if (Number.isNaN(publishedDate.getTime())) return;
    if (publishedDate.getTime() > now + 5 * 60_000) return;
    const publishedAt = publishedDate.toISOString();
    const due = futurePolicyDate(combined, publishedAt, now);
    if (!due) return;
    const link = xmlText($, item, "link") || feedUrl;
    const externalId = xmlText($, item, "guid") || link || `${publishedAt}:${title}`;
    const stableId = `calendar_${sourceId}_${externalId}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 180);
    events.push({
      id: stableId,
      sourceId,
      sourceName,
      sourceUrl: link,
      category: "regulation",
      title: title.slice(0, 240),
      due,
      timePrecision: "date",
      timeZone: "America/New_York",
      importance: "high",
      symbols: ["BTC/USDT", "ETH/USDT"],
      verified: true,
      verifiedOrigin: true,
      analysisOnly: true,
      mayTriggerTradeDirectly: false,
      publishedAt,
      firstObservedAt: observedAt,
      announcementLeadHours: Number(((new Date(due).getTime() - publishedDate.getTime()) / 3_600_000).toFixed(2)),
      fetchedAt: observedAt
    });
  });
  return events.sort((a, b) => new Date(a.due) - new Date(b.due));
}

export function mergeOfficialCalendarSource(existing = [], sourceId, incoming = [], options = {}) {
  const sourceItems = existing.filter((item) => item.sourceId === sourceId);
  const previous = new Map(sourceItems.map((item) => [item.id, item]));
  const preserved = existing.filter((item) => item.sourceId !== sourceId);
  const incomingIds = new Set(incoming.map((item) => item.id));
  const missing = options.preserveMissing ? sourceItems.filter((item) => !incomingIds.has(item.id)) : [];
  const merged = incoming.map((item) => ({
    ...item,
    firstObservedAt: previous.get(item.id)?.firstObservedAt || item.firstObservedAt || item.fetchedAt || nowIso()
  }));
  return [...preserved, ...missing, ...merged];
}

function blsEventKey(event) {
  const title = String(event.title || "").toLowerCase();
  const series = title.includes("employment situation") ? "employment"
    : title.includes("consumer price index") ? "cpi"
      : title.includes("producer price index") ? "ppi"
        : title.includes("import and export price") ? "import_export"
          : title.replace(/[^a-z0-9]+/g, "_").slice(0, 80);
  const due = new Date(event.due || 0);
  return Number.isFinite(due.getTime()) ? `${series}:${due.toISOString().slice(0, 10)}` : null;
}

export function mergeBlsFallbackSource(existing = [], incoming = []) {
  const exactKeys = new Set(existing
    .filter((event) => event.sourceId === "official_bls_calendar" && event.timePrecision === "minute")
    .map(blsEventKey).filter(Boolean));
  const previousFallback = new Map(existing
    .filter((event) => event.sourceId === "official_bls_calendar" && event.fallback === true)
    .map((event) => [event.id, event]));
  const preserved = existing.filter((event) => event.sourceId !== "official_bls_calendar" || event.fallback !== true);
  const refreshedFallback = incoming
    .filter((event) => !exactKeys.has(blsEventKey(event)))
    .map((event) => ({
      ...event,
      firstObservedAt: previousFallback.get(event.id)?.firstObservedAt
        || event.firstObservedAt || event.fetchedAt || nowIso()
    }));
  return [...preserved, ...refreshedFallback];
}

function zonedDateTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}

function parseIcsDate(line) {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1).trim();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;
  const [, y, m, d, hh = "00", mm = "00", ss = "00", z] = match;
  const rawTz = key.match(/TZID=([^;:]+)/)?.[1];
  const tz = TIME_ZONE_ALIASES.get(rawTz) || rawTz;
  const exactTime = value.includes("T");
  const due = z
    ? new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)).toISOString()
    : tz
      ? zonedDateTimeToUtc(+y, +m, +d, +hh, +mm, +ss, tz)
      : new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)).toISOString();
  return { due, timePrecision: exactTime ? "minute" : "date", timeZone: tz || (z ? "UTC" : null) };
}

export function parseBlsIcs(text, now = Date.now()) {
  const unfolded = String(text || "").replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1).map((part) => part.split("END:VEVENT")[0]);
  const relevant = /(Consumer Price Index|Employment Situation|Producer Price Index|Import and Export Price Index)/i;
  const min = now - 24 * 3_600_000;
  const max = now + 400 * 24 * 3_600_000;
  return blocks.flatMap((block) => {
    const lines = block.split(/\r?\n/);
    const summary = lines.find((line) => line.startsWith("SUMMARY"))?.split(":").slice(1).join(":").replace(/\\,/g, ",").trim();
    const start = lines.find((line) => line.startsWith("DTSTART"));
    const parsed = start ? parseIcsDate(start) : null;
    if (!summary || !relevant.test(summary) || !parsed) return [];
    const timestamp = new Date(parsed.due).getTime();
    if (timestamp < min || timestamp > max) return [];
    const uid = lines.find((line) => line.startsWith("UID"))?.split(":").slice(1).join(":").trim();
    return [{
      id: `calendar_bls_${uid || parsed.due}_${summary}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 180),
      sourceId: "official_bls_calendar", sourceName: "U.S. Bureau of Labor Statistics",
      sourceUrl: BLS_ICS_URL, category: "macro", title: summary, due: parsed.due,
      timePrecision: parsed.timePrecision, timeZone: parsed.timeZone, importance: "high",
      symbols: ["BTC/USDT", "ETH/USDT"], verified: true, fetchedAt: nowIso()
    }];
  });
}

export function parseFomcCalendarHtml(html, now = Date.now()) {
  const $ = cheerio.load(html || "");
  const out = [];
  const min = now - 24 * 3_600_000;
  const max = now + 500 * 24 * 3_600_000;
  $(".panel").each((_index, panel) => {
    const year = Number($(panel).find(".panel-heading").first().text().match(/(20\d{2})\s+FOMC Meetings/i)?.[1]);
    if (!year) return;
    $(panel).find(".fomc-meeting").each((_row, element) => {
      const monthName = $(element).find(".fomc-meeting__month").first().text().trim().toLowerCase();
      const month = MONTHS.get(monthName);
      const rawDate = $(element).find(".fomc-meeting__date").first().text().trim();
      const days = rawDate.match(/\d+/g)?.map(Number) || [];
      const day = days.at(-1);
      if (!month || !day) return;
      // 官方页面只公布会议日期，不公布声明的精确 UTC 时刻。保留 date 精度，禁止据此触发分钟级静默窗口。
      const due = new Date(Date.UTC(year, month - 1, day)).toISOString();
      const timestamp = new Date(due).getTime();
      if (timestamp < min || timestamp > max) return;
      out.push({
        id: `calendar_fomc_${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`,
        sourceId: "official_fomc_calendar", sourceName: "Federal Reserve",
        sourceUrl: FOMC_URL, category: "macro", title: `FOMC 会议（${monthName} ${rawDate}）`, due,
        timePrecision: "date", timeZone: "America/New_York", importance: "high",
        symbols: ["BTC/USDT", "ETH/USDT"], verified: true, fetchedAt: nowIso()
      });
    });
  });
  return out;
}

async function fetchCalendar(url, parser, options = {}) {
  const startedAt = Date.now();
  try {
    const { response, text } = await fetchExternalText(url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const events = parser(text);
    if (!events.length && !options.allowEmpty) throw new Error("官方日历响应中没有可用的未来事件");
    return { status: "ok", events, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "failed", events: [], error: String(error.message || error).slice(0, 180), latencyMs: Date.now() - startedAt };
  }
}

export async function refreshOfficialCalendar(db) {
  db.marketCalendarEvents ||= [];
  const observedAt = nowIso();
  const [fomc, blsPrimary, cftcPolicy, secPolicy] = await Promise.all([
    fetchCalendar(FOMC_URL, parseFomcCalendarHtml),
    fetchCalendar(BLS_ICS_URL, parseBlsIcs),
    fetchCalendar(CFTC_POLICY_RSS_URL, (xml) => parseOfficialPolicyRss(xml, {
      sourceId: "official_cftc_policy_calendar",
      sourceName: "U.S. Commodity Futures Trading Commission",
      sourceUrl: CFTC_POLICY_RSS_URL,
      observedAt
    }), { allowEmpty: true }),
    fetchCalendar(SEC_POLICY_RSS_URL, (xml) => parseOfficialPolicyRss(xml, {
      sourceId: "official_sec_policy_calendar",
      sourceName: "U.S. Securities and Exchange Commission",
      sourceUrl: SEC_POLICY_RSS_URL,
      observedAt
    }), { allowEmpty: true })
  ]);
  const bls = blsPrimary.status === "ok"
    ? blsPrimary
    : selectBlsCalendarResult(blsPrimary, getCachedOmbBlsFallback(db) || await fetchOmbBlsCalendar());
  const results = [
    { sourceId: "official_fomc_calendar", sourceName: "Federal Reserve FOMC Calendar", sourceUrl: FOMC_URL, ...fomc },
    { sourceId: "official_bls_calendar", sourceName: "U.S. BLS Release Calendar", sourceUrl: BLS_ICS_URL, ...bls },
    { sourceId: "official_cftc_policy_calendar", sourceName: "U.S. CFTC Policy Calendar", sourceUrl: CFTC_POLICY_RSS_URL, ...cftcPolicy },
    { sourceId: "official_sec_policy_calendar", sourceName: "U.S. SEC Policy Calendar", sourceUrl: SEC_POLICY_RSS_URL, ...secPolicy }
  ];
  for (const result of results) {
    if (!["ok", "partial"].includes(result.status)) continue;
    if (result.sourceId === "official_bls_calendar" && result.status === "partial") {
      db.marketCalendarEvents = mergeBlsFallbackSource(db.marketCalendarEvents, result.events);
    } else {
      db.marketCalendarEvents = mergeOfficialCalendarSource(db.marketCalendarEvents, result.sourceId, result.events, {
        preserveMissing: result.sourceId === "official_cftc_policy_calendar" || result.sourceId === "official_sec_policy_calendar"
      });
    }
  }
  db.marketCalendarEvents = db.marketCalendarEvents
    .filter((item) => new Date(item.due).getTime() >= Date.now() - 24 * 3_600_000)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 500);
  return { status: results.some((item) => ["ok", "partial"].includes(item.status)) ? "ok" : "failed", results, events: db.marketCalendarEvents };
}

export function getOfficialCalendar(db, { from = Date.now(), to = Date.now() + 7 * 86_400_000, importance } = {}) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return (db.marketCalendarEvents || []).filter((event) => {
    const time = new Date(event.due).getTime();
    const effectiveEnd = event.timePrecision === "date" ? time + 24 * 3_600_000 - 1 : time;
    return effectiveEnd >= start && time <= end && (!importance || event.importance === importance);
  });
}
