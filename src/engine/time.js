// Time helpers. Instants are UTC epoch milliseconds; "days" in a rule window are calendar days in the
// market's time zone, so a daylight-saving change does not move the window by an hour.

const DAY = 24 * 60 * 60 * 1000;
const fmtCache = new Map();

function formatter(timeZone) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Local calendar parts of an instant in a time zone. */
function localParts(epochMs, timeZone) {
  const parts = {};
  for (const p of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const ms = ((epochMs % 1000) + 1000) % 1000;
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second, ms };
}

/** Offset (local minus UTC) in milliseconds at an instant. */
function offsetAt(epochMs, timeZone) {
  const p = localParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
  return asUtc - epochMs;
}

/**
 * The instant at which the wall clock in `timeZone` shows the given local time. For a local time skipped by a
 * daylight-saving jump the result is the instant just after the jump; for a repeated local time it is the first one.
 */
function zonedToEpoch({ year, month, day, hour = 0, minute = 0, second = 0, ms = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = wall - offsetAt(wall, timeZone);
  const second1 = wall - offsetAt(guess, timeZone);
  if (second1 !== guess) guess = second1;
  // Prefer the earlier instant when the local time occurs twice.
  const earlier = guess - 60 * 60 * 1000;
  if (wall - offsetAt(earlier, timeZone) === earlier) return earlier;
  return guess;
}

/** Same local wall-clock time `days` calendar days later (negative for earlier). */
function addLocalDays(epochMs, timeZone, days) {
  const p = localParts(epochMs, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToEpoch({
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
    hour: p.hour, minute: p.minute, second: p.second, ms: p.ms,
  }, timeZone);
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as local time in the zone; ISO strings with Z or an offset are absolute. */
function parseLocal(value, timeZone) {
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`Not a date: ${value}`);
    return t;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) throw new Error(`Not a date: ${value}`);
  return zonedToEpoch({
    year: +m[1], month: +m[2], day: +m[3], hour: m[4] ? +m[4] : 0, minute: m[5] ? +m[5] : 0, second: m[6] ? +m[6] : 0,
  }, timeZone);
}

/** "2026-11-27 00:00" in the zone. */
function formatLocal(epochMs, timeZone, withTime = true) {
  const p = localParts(epochMs, timeZone);
  const d = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return withTime ? `${d} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : d;
}

/**
 * The window [start, end) as people read it: "2026-10-28 to 2026-11-26" when it ends at local midnight (the end day
 * itself is not in the window); otherwise with times, "2026-10-28 14:00 to before 2026-11-27 14:00".
 */
function windowLabel(start, end, timeZone) {
  const p = localParts(end, timeZone);
  if (p.hour === 0 && p.minute === 0 && p.second === 0 && p.ms === 0) {
    return `${formatLocal(start, timeZone, false)} to ${formatLocal(addLocalDays(end, timeZone, -1), timeZone, false)}`;
  }
  return `${formatLocal(start, timeZone)} to before ${formatLocal(end, timeZone)}`;
}

export { DAY, localParts, offsetAt, zonedToEpoch, addLocalDays, parseLocal, formatLocal, windowLabel };
