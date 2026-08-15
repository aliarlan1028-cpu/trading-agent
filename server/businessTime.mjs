export const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Shanghai";

function zonedParts(at, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedMidnightUtc(year, month, day, timeZone) {
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(guess, timeZone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess -= represented - Date.UTC(year, month - 1, day, 0, 0, 0);
  }
  return guess;
}

export function businessDayStartMs(at = Date.now(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const parts = zonedParts(at, timeZone);
  return zonedMidnightUtc(Number(parts.year), Number(parts.month), Number(parts.day), timeZone);
}

export function businessDateKey(at = Date.now(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const parts = zonedParts(at, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
