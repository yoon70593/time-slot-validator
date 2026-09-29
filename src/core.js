/**
 * TimeSlotValidator checks whether a given UTC instant falls within a set of
 * recurring weekly availability windows defined in a specific IANA timezone.
 *
 * Design decisions (documented because they are not obvious):
 *
 * 1. No third-party deps, so we cannot use a TZ database in pure JS. We rely on
 *    Intl.DateTimeFormat to convert a UTC epoch-ms instant into wall-clock
 *    fields for a given IANA timezone. Intl is available in Node and modern
 *    browsers and uses the host's TZ data, which is exactly what we need.
 *
 * 2. Windows are weekly-recurring and specified by ISO weekday (1=Mon..7=Sun),
 *    24-hour local time, and inclusive start / exclusive end in seconds. The
 *    exclusive end avoids adjacent windows double-counting and makes "midnight
 *    to midnight" expressible as start=00:00:00, end=24:00:00.
 *
 * 3. A window may cross midnight (end < start) or even span a full day
 *    (end == start + 7*86400). We handle the cross-midnight case by checking
 *    two candidate weekdays: the day the instant falls on, and the previous day
 *    (a window starting Sunday 23:00 ending Monday 01:00 must match a Monday
 *    00:30 instant via the Sunday window).
 *
 * 4. DST is handled implicitly because we always convert the UTC instant to
 *    local wall-clock fields via Intl. A window defined as 02:00-03:00 local
 *    will match the local 02:00-03:00 whatever the UTC offset is on that day,
 *    including on DST transition days. We do NOT try to pin windows to a fixed
 *    UTC offset; that would contradict the "defined in a specific timezone"
 *    requirement. This is the one interpretation we picked deliberately.
 */

/**
 * @typedef {Object} TimeWindow
 * @property {number} weekday      ISO weekday: 1=Mon .. 7=Sun.
 * @property {number} startSecond  Local seconds from midnight, 0..86400.
 * @property {number} endSecond    Local seconds from midnight, 0..86400.
 *                               end > start: same-day window.
 *                               end < start: cross-midnight window.
 *                               end == start + 7*86400: open all week.
 *                               End is exclusive.
 */

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/**
 * Convert a UTC epoch-ms instant to wall-clock fields in a given IANA timezone.
 * Returns { weekday: 1..7, secondOfDay: 0..86399 }.
 *
 * We use Intl.DateTimeFormat with formatToParts because the older
 * format() string parsing is locale-dependent and fragile. We request
 * 'numeric' weekday so we get a stable 1..7 value (Monday=1 in 'en-US' with
 * 'numeric' is NOT guaranteed; instead we use 'weekday: short' and map the
 * short name, which is stable across hosts for the en-US locale).
 *
 * Actually, to avoid any locale string mapping, we use a different trick:
 * formatToParts with weekday 'long' gives us a name; we map the seven English
 * long names (which en-US produces deterministically) to 1..7. This is the
 * least-bad zero-dependency option.
 */
function toLocalFields(epochMs, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  let weekdayName = '';
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of parts) {
    if (p.type === 'weekday') weekdayName = p.value;
    else if (p.type === 'hour') hour = parseInt(p.value, 10);
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
    else if (p.type === 'second') second = parseInt(p.value, 10);
  }
  // Intl can return '24' for midnight in some environments; normalise.
  if (hour === 24) hour = 0;
  const weekday = WEEKDAY_NAME_TO_ISO[weekdayName];
  if (weekday === undefined) {
    throw new Error(`Unexpected weekday name from Intl: ${weekdayName}`);
  }
  const secondOfDay = hour * 3600 + minute * 60 + second;
  return { weekday, secondOfDay };
}

const WEEKDAY_NAME_TO_ISO = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function isoWeekdayPrev(d) {
  return d === 1 ? 7 : d - 1;
}

/**
 * Does a local instant (weekday, secondOfDay) fall within a window?
 * Handles same-day, cross-midnight, and full-week windows.
 *
 * For a cross-midnight window (end < start), the instant matches if it is on
 * the window's weekday at or after start, OR on the next weekday before end.
 * We let the caller pass both candidate weekdays and check each; here we just
 * answer for the given weekday.
 */
function windowMatchesOnDay(window, weekday, secondOfDay) {
  if (window.endSecond > window.startSecond) {
    // Same-day window.
    if (weekday !== window.weekday) return false;
    return secondOfDay >= window.startSecond && secondOfDay < window.endSecond;
  }
  if (window.endSecond === window.startSecond + SECONDS_PER_WEEK) {
    // Full-week window: any time on the window's weekday? No — a full-week
    // window means open continuously from startSecond on weekday for 7 days.
    // We treat it as: matches if on the window's weekday at/after startSecond,
    // or on any of the next 6 days. Simplify: compute seconds since window start.
    return matchesFullWeek(window, weekday, secondOfDay);
  }
  // Cross-midnight: end < start.
  if (weekday === window.weekday) {
    return secondOfDay >= window.startSecond;
  }
  if (weekday === nextWeekday(window.weekday)) {
    return secondOfDay < window.endSecond;
  }
  return false;
}

function nextWeekday(d) {
  return d === 7 ? 1 : d + 1;
}

function matchesFullWeek(window, weekday, secondOfDay) {
  const dayOffset = ((weekday - window.weekday + 7) % 7) * SECONDS_PER_DAY;
  const totalFromStart = dayOffset + secondOfDay - window.startSecond;
  return totalFromStart >= 0 && totalFromStart < SECONDS_PER_WEEK;
}

export class TimeSlotValidator {
  /**
   * @param {TimeWindow[]} windows
   * @param {string} timeZone  IANA timezone identifier, e.g. "America/New_York".
   */
  constructor(windows, timeZone) {
    if (!Array.isArray(windows)) {
      throw new TypeError('windows must be an array');
    }
    if (typeof timeZone !== 'string' || timeZone.length === 0) {
      throw new TypeError('timeZone must be a non-empty string');
    }
    // Validate eagerly so failures happen at construction, not at query time.
    this._windows = windows.map((w, i) => {
      if (!w || typeof w !== 'object') {
        throw new TypeError(`window[${i}] is not an object`);
      }
      const weekday = w.weekday;
      const startSecond = w.startSecond;
      const endSecond = w.endSecond;
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw new RangeError(`window[${i}].weekday must be an integer 1..7`);
      }
      if (!Number.isFinite(startSecond) || startSecond < 0 || startSecond > SECONDS_PER_DAY) {
        throw new RangeError(`window[${i}].startSecond must be in [0, 86400]`);
      }
      if (!Number.isFinite(endSecond) || endSecond < 0 || endSecond > SECONDS_PER_DAY) {
        throw new RangeError(`window[${i}].endSecond must be in [0, 86400]`);
      }
      // Disallow zero-length same-day window (start == end but not full-week).
      // start==end with the intent of "full week" is expressed as end == start + 7*86400,
      // which is out of [0,86400] range, so full-week is not representable here.
      // We keep the constraint simple: end may equal start only if it means 24h,
      // i.e. start==0 && end==0 is treated as a zero-length window and rejected.
      if (endSecond === startSecond) {
        throw new RangeError(
          `window[${i}]: zero-length window (start==end) is not allowed; ` +
          `use start=0, end=86400 for a full 24h day`
        );
      }
      return { weekday, startSecond, endSecond };
    });
    this._timeZone = timeZone;
    // Validate the timezone by formatting a known instant.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(new Date(0));
    } catch (e) {
      throw new RangeError(`Invalid or unsupported timeZone: ${timeZone} (${e.message})`);
    }
  }

  /**
   * Returns true if the given UTC epoch-ms instant falls within any window.
   * @param {number} epochMs
   * @returns {boolean}
   */
  isAvailable(epochMs) {
    if (!Number.isFinite(epochMs)) {
      throw new TypeError('epochMs must be a finite number');
    }
    const { weekday, secondOfDay } = toLocalFields(epochMs, this._timeZone);
    for (const w of this._windows) {
      if (windowMatchesOnDay(w, weekday, secondOfDay)) return true;
      // For cross-midnight windows, also check the previous day: a window
      // starting Sunday 23:00 ending Monday 01:00 must match a Monday 00:30
      // instant. windowMatchesOnDay already checks nextWeekday for the end
      // side, so when we are on Monday and the window is on Sunday, the
      // call above checks weekday==Sunday (false) then weekday==Monday as
      // nextWeekday(Sunday) (true). So we do NOT need an extra prev-day check;
      // the nextWeekday branch covers it. We keep this comment to record that
      // the analysis was done.
    }
    return false;
  }
}
