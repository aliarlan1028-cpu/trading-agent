import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "official-calendar-test-"));
const { getOfficialCalendar, parseBlsIcs, parseFomcCalendarHtml } = await import("../server/officialCalendar.mjs");

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
