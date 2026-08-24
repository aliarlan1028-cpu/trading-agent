import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "official-calendar-test-"));
const {
  getOfficialCalendar,
  getCachedOmbBlsFallback,
  mergeBlsFallbackSource,
  mergeOfficialCalendarSource,
  parseBlsIcs,
  parseFomcCalendarHtml,
  parseOmbPfeiScheduleLinks,
  parseOmbPfeiScheduleText,
  parseOfficialPolicyRss,
  selectBlsCalendarResult
} = await import("../server/officialCalendar.mjs");

test("BLS ICS 只接纳重要发布并把纽约时区精确换算为 UTC", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cpi-1
DTSTART;TZID=America/New_York:20260911T083000
SUMMARY:Consumer Price Index
END:VEVENT
BEGIN:VEVENT
UID:minor-1
DTSTART;TZID=America/New_York:20260912T100000
SUMMARY:Minor statistical table
END:VEVENT
END:VCALENDAR`;
  const events = parseBlsIcs(ics, Date.UTC(2026, 7, 1));
  assert.equal(events.length, 1);
  assert.equal(events[0].timePrecision, "minute");
  assert.equal(events[0].due, "2026-09-11T12:30:00.000Z");
  assert.equal(events[0].verified, true);
});

test("BLS 旧 US-Eastern 时区别名在精简 ICU 运行时仍可解析", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:jobs-legacy-tz
DTSTART;TZID=US-Eastern:20261002T083000
SUMMARY:Employment Situation
END:VEVENT
END:VCALENDAR`;
  const events = parseBlsIcs(ics, Date.UTC(2026, 7, 1));
  assert.equal(events.length, 1);
  assert.equal(events[0].due, "2026-10-02T12:30:00.000Z");
  assert.equal(events[0].timeZone, "America/New_York");
});

test("FOMC 官方页面只给日期时保持 date 精度，不伪造声明时刻", () => {
  const html = `<div class="panel"><div class="panel-heading"><h4>2026 FOMC Meetings</h4></div>
  <div class="row fomc-meeting"><div class="fomc-meeting__month"><strong>September</strong></div>
  <div class="fomc-meeting__date">15-16*</div></div></div>`;
  const events = parseFomcCalendarHtml(html, Date.UTC(2026, 7, 1));
  assert.equal(events.length, 1);
  assert.equal(events[0].due, "2026-09-16T00:00:00.000Z");
  assert.equal(events[0].timePrecision, "date");
  const duringMeetingDay = Date.UTC(2026, 8, 16, 12);
  assert.equal(getOfficialCalendar({ marketCalendarEvents: events }, { from: duringMeetingDay, to: duringMeetingDay + 3_600_000 }).length, 1);
});

test("CFTC 官方 RSS 能把提前公告的加密监管会议登记为仅日期日程", () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Chairman Selig Announces Inaugural CFTC Innovation Advisory Committee Meeting on August 20 in Washington</title>
      <link>https://www.cftc.gov/PressRoom/PressReleases/9279-26</link>
      <guid>9279-26</guid>
      <pubDate>Mon, 10 Aug 2026 16:00:00 +0000</pubDate>
      <description></description>
    </item>
    <item>
      <title>CFTC Charges Commodity Pool Operator</title>
      <link>https://www.cftc.gov/PressRoom/PressReleases/unrelated</link>
      <guid>unrelated</guid>
      <pubDate>Mon, 10 Aug 2026 17:00:00 +0000</pubDate>
    </item>
    <item>
      <title>CFTC Announces Digital Asset Meeting on August 20</title>
      <link>https://www.cftc.gov/PressRoom/PressReleases/future-publication</link>
      <guid>future-publication</guid>
      <pubDate>Thu, 13 Aug 2026 14:00:00 +0000</pubDate>
    </item>
  </channel></rss>`;
  const observedAt = "2026-08-10T16:05:00.000Z";
  const events = parseOfficialPolicyRss(rss, {
    sourceId: "official_cftc_policy_calendar",
    sourceName: "U.S. Commodity Futures Trading Commission",
    sourceUrl: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml",
    observedAt,
    now: Date.parse("2026-08-10T16:05:00.000Z")
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].due, "2026-08-20T00:00:00.000Z");
  assert.equal(events[0].timePrecision, "date");
  assert.equal(events[0].publishedAt, "2026-08-10T16:00:00.000Z");
  assert.equal(events[0].firstObservedAt, observedAt);
  assert.ok(events[0].announcementLeadHours > 200);
  assert.equal(events[0].analysisOnly, true);
  assert.equal(events[0].mayTriggerTradeDirectly, false);
  assert.equal(events[0].verifiedOrigin, true);
});

test("SEC 官方 RSS 只提取未来且与数字资产相关的明确日期", () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>SEC to Host Crypto Asset Market Structure Roundtable</title>
      <link>https://www.sec.gov/newsroom/press-releases/example</link>
      <guid>sec-example</guid>
      <pubDate>Thu, 23 Jul 2026 14:00:00 -0400</pubDate>
      <description>The Commission will host the digital asset roundtable on August 7, 2026 at its Washington headquarters.</description>
    </item>
    <item>
      <title>SEC Publishes Historical Crypto Statistics</title>
      <link>https://www.sec.gov/newsroom/press-releases/history</link>
      <guid>sec-history</guid>
      <pubDate>Thu, 23 Jul 2026 14:00:00 -0400</pubDate>
      <description>The report reviews market conditions from March 17, 2026.</description>
    </item>
  </channel></rss>`;
  const events = parseOfficialPolicyRss(rss, {
    sourceId: "official_sec_policy_calendar",
    sourceName: "U.S. Securities and Exchange Commission",
    sourceUrl: "https://www.sec.gov/news/pressreleases.rss",
    observedAt: "2026-07-23T18:03:00.000Z",
    now: Date.parse("2026-07-23T18:03:00.000Z")
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].due, "2026-08-07T00:00:00.000Z");
  assert.equal(events[0].publishedAt, "2026-07-23T18:00:00.000Z");
});

test("官方日程重复刷新保留首次发现时间，而不是把事后刷新伪装成首次发现", () => {
  const old = [{
    id: "calendar_policy_9279-26",
    sourceId: "official_cftc_policy_calendar",
    due: "2026-08-20T00:00:00.000Z",
    firstObservedAt: "2026-08-10T16:05:00.000Z",
    fetchedAt: "2026-08-10T16:05:00.000Z"
  }];
  const refreshed = [{
    id: "calendar_policy_9279-26",
    sourceId: "official_cftc_policy_calendar",
    due: "2026-08-20T00:00:00.000Z",
    firstObservedAt: "2026-08-13T14:03:00.000Z",
    fetchedAt: "2026-08-13T14:03:00.000Z"
  }];

  const merged = mergeOfficialCalendarSource(old, "official_cftc_policy_calendar", refreshed);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].firstObservedAt, "2026-08-10T16:05:00.000Z");
  assert.equal(merged[0].fetchedAt, "2026-08-13T14:03:00.000Z");
});

test("有限长度政策 RSS 滚动后，已发现但尚未到期的事件不会从日历消失", () => {
  const existing = [{
    id: "calendar_policy_future",
    sourceId: "official_cftc_policy_calendar",
    due: "2026-09-20T00:00:00.000Z",
    firstObservedAt: "2026-08-10T16:05:00.000Z",
    fetchedAt: "2026-08-10T16:05:00.000Z"
  }];

  const merged = mergeOfficialCalendarSource(existing, "official_cftc_policy_calendar", [], { preserveMissing: true });
  assert.deepEqual(merged, existing);
});

test("OMB PFEI 官方年表在 BLS 被阻断时只恢复日期，不伪造发布时间", () => {
  const text = `SCHEDULE OF RELEASE DATES FOR
PRINCIPAL FEDERAL ECONOMIC INDICATORS FOR 2026
LABOR
BUREAU OF LABOR STATISTICS
The Employment Situation
(Data are for previous month)
9 6 6 3 8 5 2 7 4 2 6 4
Producer Price Indexes
(Data are for previous month)
14 12 12 14 13 11 15 13 10 15 13 15
Consumer Price Index
(Data are for previous month)
13 11 11 10 12 10 14 12 11 14 10 10
Real Earnings
(Data are for previous month)
13 11 11 10 12 10 14 12 11 14 10 10
Productivity and Costs
(Preliminary and revised estimates are issued for each quarter)
-- 5 5 -- 7 4 -- 6 3 -- 5 8
Employment Cost Index
(Data are for previous month)
30 -- -- 30 -- -- 31 -- -- 30 -- --
U.S. Import and Export Price Indexes
(Data are for previous month)
15 18 17 15 14 16 17 18 16 16 17 17
FEDERAL RESERVE BOARD`;
  const events = parseOmbPfeiScheduleText(text, {
    year: 2026,
    sourceUrl: "https://www.whitehouse.gov/wp-content/uploads/2025/09/pfei_schedule_release_dates_cy2026.pdf",
    observedAt: "2026-08-24T00:00:00.000Z",
    now: Date.parse("2026-08-24T00:00:00.000Z")
  });

  assert.deepEqual(events.map((event) => [event.title, event.due]), [
    ["Employment Situation", "2026-09-04T00:00:00.000Z"],
    ["Producer Price Index", "2026-09-10T00:00:00.000Z"],
    ["Consumer Price Index", "2026-09-11T00:00:00.000Z"],
    ["Import and Export Price Indexes", "2026-09-16T00:00:00.000Z"],
    ["Employment Situation", "2026-10-02T00:00:00.000Z"],
    ["Consumer Price Index", "2026-10-14T00:00:00.000Z"],
    ["Producer Price Index", "2026-10-15T00:00:00.000Z"],
    ["Import and Export Price Indexes", "2026-10-16T00:00:00.000Z"],
    ["Employment Situation", "2026-11-06T00:00:00.000Z"],
    ["Consumer Price Index", "2026-11-10T00:00:00.000Z"],
    ["Producer Price Index", "2026-11-13T00:00:00.000Z"],
    ["Import and Export Price Indexes", "2026-11-17T00:00:00.000Z"],
    ["Employment Situation", "2026-12-04T00:00:00.000Z"],
    ["Consumer Price Index", "2026-12-10T00:00:00.000Z"],
    ["Producer Price Index", "2026-12-15T00:00:00.000Z"],
    ["Import and Export Price Indexes", "2026-12-17T00:00:00.000Z"]
  ]);
  assert.ok(events.every((event) => event.timePrecision === "date"));
  assert.ok(events.every((event) => event.analysisOnly === true && event.mayTriggerTradeDirectly === false));
  assert.ok(events.every((event) => event.verifiedOrigin === true && event.fallback === true));
});

test("OMB 年表索引只接纳 White House 官方 PDF", () => {
  const html = `<a href="https://attacker.example/pfei_schedule_release_dates_cy2026.pdf">fake</a>
    <a href="https://www.whitehouse.gov/wp-content/uploads/2025/09/pfei_schedule_release_dates_cy2026.pdf">2026 schedule</a>
    <a href="/wp-content/uploads/2026/09/pfei_schedule_release_dates_cy2027.pdf">2027 schedule</a>`;
  assert.deepEqual(parseOmbPfeiScheduleLinks(html, [2026, 2027]), [
    { year: 2026, url: "https://www.whitehouse.gov/wp-content/uploads/2025/09/pfei_schedule_release_dates_cy2026.pdf" },
    { year: 2027, url: "https://www.whitehouse.gov/wp-content/uploads/2026/09/pfei_schedule_release_dates_cy2027.pdf" }
  ]);
});

test("BLS ICS 失败时官方 OMB 日期作为 degraded fallback，ICS 恢复后立即优先使用精确时间", () => {
  const fallbackEvent = { id: "omb_cpi", timePrecision: "date", due: "2026-09-11T00:00:00.000Z" };
  const fallback = selectBlsCalendarResult(
    { status: "failed", events: [], error: "HTTP 403" },
    { status: "ok", events: [fallbackEvent], sourceUrl: "https://www.whitehouse.gov/example.pdf" }
  );
  assert.equal(fallback.status, "partial");
  assert.equal(fallback.error, "BLS ICS: HTTP 403");
  assert.deepEqual(fallback.events, [fallbackEvent]);

  const exactEvent = { id: "bls_cpi", timePrecision: "minute", due: "2026-09-11T12:30:00.000Z" };
  const primary = selectBlsCalendarResult(
    { status: "ok", events: [exactEvent], latencyMs: 10 },
    { status: "ok", events: [fallbackEvent] }
  );
  assert.equal(primary.status, "ok");
  assert.deepEqual(primary.events, [exactEvent]);
});

test("OMB fallback 在 24 小时内复用，过期后必须重新抓取", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  const fresh = {
    id: "omb_cpi_fresh",
    sourceId: "official_bls_calendar",
    fallback: true,
    due: "2026-09-11T00:00:00.000Z",
    fetchedAt: "2026-08-24T00:00:01.000Z"
  };
  const stale = { ...fresh, id: "omb_cpi_stale", fetchedAt: "2026-08-23T11:59:59.000Z" };

  assert.deepEqual(getCachedOmbBlsFallback({ marketCalendarEvents: [fresh] }, now)?.events, [fresh]);
  assert.equal(getCachedOmbBlsFallback({ marketCalendarEvents: [stale] }, now), null);
});

test("临时 403 的 date-only fallback 不删除已有精确 BLS 时刻，也不制造同日重复项", () => {
  const exact = [{
    id: "calendar_bls_exact_cpi",
    sourceId: "official_bls_calendar",
    title: "Consumer Price Index",
    due: "2026-09-11T12:30:00.000Z",
    timePrecision: "minute"
  }];
  const fallback = [{
    id: "calendar_bls_omb_cpi",
    sourceId: "official_bls_calendar",
    title: "Consumer Price Index",
    due: "2026-09-11T00:00:00.000Z",
    timePrecision: "date",
    fallback: true
  }, {
    id: "calendar_bls_omb_ppi",
    sourceId: "official_bls_calendar",
    title: "Producer Price Index",
    due: "2026-09-10T00:00:00.000Z",
    timePrecision: "date",
    fallback: true
  }];

  const merged = mergeBlsFallbackSource(exact, fallback);
  assert.deepEqual(merged.map((event) => event.id).sort(), ["calendar_bls_exact_cpi", "calendar_bls_omb_ppi"]);
});

test("OMB 调整发布日期后用新 fallback 替换旧日期，同时保留已有精确 BLS 时刻", () => {
  const existing = [{
    id: "calendar_fomc_20260916",
    sourceId: "official_fomc_calendar",
    due: "2026-09-16T00:00:00.000Z",
    timePrecision: "date"
  }, {
    id: "calendar_bls_exact_employment",
    sourceId: "official_bls_calendar",
    title: "Employment Situation",
    due: "2026-09-04T12:30:00.000Z",
    timePrecision: "minute"
  }, {
    id: "calendar_bls_omb_old_cpi",
    sourceId: "official_bls_calendar",
    title: "Consumer Price Index",
    due: "2026-09-11T00:00:00.000Z",
    timePrecision: "date",
    fallback: true,
    firstObservedAt: "2026-08-20T00:00:00.000Z",
    fetchedAt: "2026-08-20T00:00:00.000Z"
  }, {
    id: "calendar_bls_omb_20260910_Producer_Price_Index",
    sourceId: "official_bls_calendar",
    title: "Producer Price Index",
    due: "2026-09-10T00:00:00.000Z",
    timePrecision: "date",
    fallback: true,
    firstObservedAt: "2026-08-20T00:00:00.000Z",
    fetchedAt: "2026-08-20T00:00:00.000Z"
  }];
  const revised = [{
    id: "calendar_bls_omb_new_cpi",
    sourceId: "official_bls_calendar",
    title: "Consumer Price Index",
    due: "2026-09-12T00:00:00.000Z",
    timePrecision: "date",
    fallback: true,
    firstObservedAt: "2026-08-24T00:00:00.000Z",
    fetchedAt: "2026-08-24T00:00:00.000Z"
  }, {
    id: "calendar_bls_omb_20260910_Producer_Price_Index",
    sourceId: "official_bls_calendar",
    title: "Producer Price Index",
    due: "2026-09-10T00:00:00.000Z",
    timePrecision: "date",
    fallback: true,
    firstObservedAt: "2026-08-24T00:00:00.000Z",
    fetchedAt: "2026-08-24T00:00:00.000Z"
  }];

  const merged = mergeBlsFallbackSource(existing, revised);
  assert.deepEqual(merged.map((event) => event.id).sort(), [
    "calendar_bls_exact_employment",
    "calendar_bls_omb_20260910_Producer_Price_Index",
    "calendar_bls_omb_new_cpi",
    "calendar_fomc_20260916"
  ]);
  assert.equal(merged.find((event) => event.id.includes("Producer_Price"))?.firstObservedAt, "2026-08-20T00:00:00.000Z");
});
