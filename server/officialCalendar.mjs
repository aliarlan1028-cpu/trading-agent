import * as cheerio from "cheerio";
import { fetchExternalText } from "./externalInputSafety.mjs";
import { nowIso } from "./store.mjs";

const FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const BLS_ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
const TIME_ZONE_ALIASES = new Map([
  // BLS 的 ICS 当前仍会返回旧 Olson 别名；部分精简 ICU 运行时不接受该别名。
  ["US-Eastern", "America/New_York"]
]);
const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12]
]);

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

async function fetchCalendar(url, parser) {
  const startedAt = Date.now();
  try {
    const { response, text } = await fetchExternalText(url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const events = parser(text);
    if (!events.length) throw new Error("官方日历响应中没有可用的未来事件");
    return { status: "ok", events, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "failed", events: [], error: String(error.message || error).slice(0, 180), latencyMs: Date.now() - startedAt };
  }
}

export async function refreshOfficialCalendar(db) {
  db.marketCalendarEvents ||= [];
  const [fomc, bls] = await Promise.all([
    fetchCalendar(FOMC_URL, parseFomcCalendarHtml),
    fetchCalendar(BLS_ICS_URL, parseBlsIcs)
  ]);
  const results = [
    { sourceId: "official_fomc_calendar", sourceName: "Federal Reserve FOMC Calendar", sourceUrl: FOMC_URL, ...fomc },
    { sourceId: "official_bls_calendar", sourceName: "U.S. BLS Release Calendar", sourceUrl: BLS_ICS_URL, ...bls }
  ];
  for (const result of results) {
    if (result.status !== "ok") continue;
    db.marketCalendarEvents = db.marketCalendarEvents.filter((item) => item.sourceId !== result.sourceId);
    db.marketCalendarEvents.push(...result.events);
  }
  db.marketCalendarEvents = db.marketCalendarEvents
    .filter((item) => new Date(item.due).getTime() >= Date.now() - 24 * 3_600_000)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 500);
  return { status: results.some((item) => item.status === "ok") ? "ok" : "failed", results, events: db.marketCalendarEvents };
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
