/**
 * Reading and writing the day and the hour, in the forms this country uses.
 *
 * The interface asked `<input type="time">` and `<input type="date">` to do this
 * and they refused. Their rendering follows the *browser's* language, not the
 * page's: `lang="it-IT"` on the element changes nothing, and a Chromium launched
 * with `--lang=it-IT` still draws `01:45 PM` and `08/23/2026`. It is in the
 * committed screenshots — `03:13 F`, because at 1280 px the meridiem does not
 * even fit the field it forced wider. An Italian reading a Tuscan timetable in
 * half-days is the mild version of the problem; the sharp one is that whether
 * `08/12` means 8 December or 12 August depended on a setting the page cannot
 * see.
 *
 * So the parsing lives here, away from the DOM, and the fields that use it are
 * plain text inputs. Everything is stored in the forms the rest of the app
 * already speaks: `HH:MM` for an hour, `YYYYMMDD` for a day.
 */

const MINUTES_PER_DAY = 24 * 60;

/** Anything a person might reasonably put between the numbers. */
const SEPARATORS = /[\s.,:;/\-—]+/;

/**
 * An hour of the day, from whatever was typed — or null if that was not one.
 *
 * Deliberately generous about how it is written and strict about what it means:
 * `9`, `930`, `9:30`, `9.30` and `09 30` are all half past nine, while `24:00`
 * and `23:60` are refused rather than rounded into a neighbouring day. The
 * caller is expected to put the last good value back when this returns null, so
 * a slip of the keyboard never becomes a search for a time nobody asked about.
 */
export function parseClock(text: string): string | null {
  const parts = splitNumbers(text);
  if (parts === null) return null;

  const [first, second, ...rest] = parts;
  if (first === undefined || rest.length > 0) return null;

  // With no separator the digits carry the split themselves: `930` is 9:30 and
  // `0930` is the same hour written out.
  const [hours, minutes] =
    second === undefined ? splitDigits(first) : [Number(first), Number(second)];

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return formatClock(hours * 60 + minutes);
}

/**
 * Moves an hour by minutes, stopping at the ends of the day.
 *
 * Clamped rather than wrapped: a window that ran from 23:58 to 00:03 would
 * select nothing at all, and the arrow keys are there to nudge a search, not to
 * change which day it is about.
 */
export function stepClock(clock: string, deltaMinutes: number): string {
  const minutes = clockToMinutes(clock) ?? 0;
  return formatClock(Math.max(0, Math.min(MINUTES_PER_DAY - 1, minutes + deltaMinutes)));
}

/** `"09:30"` → 570. Null when the string is not an hour this module wrote. */
export function clockToMinutes(clock: string): number | null {
  const parsed = parseClock(clock);
  if (parsed === null) return null;
  return Number(parsed.slice(0, 2)) * 60 + Number(parsed.slice(3, 5));
}

function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${pad(hours)}:${pad(minutes % 60)}`;
}

/**
 * A service date (`YYYYMMDD`) from a day written the Italian way round.
 *
 * `23/08/2026`, `23-8-26`, `23082026` and `23/08` are the same day; `31/02` is
 * not a day at all and comes back null. The year may be left off — a rider
 * searching a timetable is nearly always asking about this one — and two digits
 * mean this century.
 */
export function parseDay(text: string, today: Date = new Date()): string | null {
  const parts = splitNumbers(text);
  if (parts === null) return null;

  const [first, second, third, ...rest] = parts;
  if (first === undefined || rest.length > 0) return null;

  let day: number;
  let month: number;
  let year: number;

  if (second === undefined) {
    // One run of digits: `23082026` or `230826`, and nothing else.
    if (first.length !== 8 && first.length !== 6) return null;
    day = Number(first.slice(0, 2));
    month = Number(first.slice(2, 4));
    year = expandYear(Number(first.slice(4)));
  } else {
    day = Number(first);
    month = Number(second);
    year = third === undefined ? today.getFullYear() : expandYear(Number(third));
  }

  return isRealDay(year, month, day) ? `${year}${pad(month)}${pad(day)}` : null;
}

/** `"20260823"` → `"23/08/2026"`, which is what the field shows. */
export function formatDay(serviceDate: string): string {
  return `${serviceDate.slice(6, 8)}/${serviceDate.slice(4, 6)}/${serviceDate.slice(0, 4)}`;
}

/**
 * Moves a service date by whole days, across months and years.
 *
 * Given something that is not a service date it hands the string back rather
 * than inventing a day: `new Date("", NaN, NaN)` resolves to December 1899
 * through the two-digit-year rollover, and a field stepping from empty would
 * have landed there silently. `stepClock` has always defended itself this way;
 * this is the same defence, and the caller skips the step instead.
 */
export function stepDay(serviceDate: string, deltaDays: number): string {
  if (!/^\d{8}$/.test(serviceDate)) return serviceDate;
  const date = new Date(
    Number(serviceDate.slice(0, 4)),
    Number(serviceDate.slice(4, 6)) - 1,
    Number(serviceDate.slice(6, 8)) + deltaDays,
  );
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** The parts of a service date, as numbers. */
export function dayParts(serviceDate: string): { year: number; month: number; day: number } {
  return {
    year: Number(serviceDate.slice(0, 4)),
    month: Number(serviceDate.slice(4, 6)),
    day: Number(serviceDate.slice(6, 8)),
  };
}

/** `2026`, `8` → `"20260801"`. The month is 1-based, as everywhere else here. */
export function firstOfMonth(year: number, month: number): string {
  return `${year}${pad(month)}01`;
}

/**
 * One month as a calendar draws it: six rows of seven, Monday first, with the
 * days of the neighbouring months left out rather than greyed in.
 *
 * Monday first because that is how a calendar is printed in Italy and in the
 * UK alike — `Intl` would give Sunday for `en-US`, and this grid is read next
 * to an Italian timetable in both languages.
 *
 * Always six rows, so the popover does not change height between March and
 * August and shift whatever the reader was aiming at.
 */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(year, month, 0).getDate();

  return Array.from({ length: 42 }, (_unused, index) => {
    const day = index - lead + 1;
    return day >= 1 && day <= length ? `${year}${pad(month)}${pad(day)}` : null;
  });
}

/** The runs of digits in the text, or null if it holds anything else. */
function splitNumbers(text: string): string[] | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // A separator at either end would otherwise split off an empty token that the
  // filter below quietly drops, and `-5` would be accepted as five o'clock — the
  // one outcome this module exists to prevent, since the field commits what it
  // parsed rather than what was typed.
  if (!/^\d/.test(trimmed) || !/\d$/.test(trimmed)) return null;
  const parts = trimmed.split(SEPARATORS).filter((part) => part !== "");
  if (parts.length === 0 || parts.length > 3) return null;
  return parts.every((part) => /^\d+$/.test(part)) ? parts : null;
}

/** `"930"` → 9:30, `"0930"` → 9:30, `"9"` → 9:00. */
function splitDigits(digits: string): [number, number] {
  if (digits.length <= 2) return [Number(digits), 0];
  if (digits.length === 3) return [Number(digits.slice(0, 1)), Number(digits.slice(1))];
  if (digits.length === 4) return [Number(digits.slice(0, 2)), Number(digits.slice(2))];
  return [Number.NaN, Number.NaN];
}

/** Two digits mean this century; anything longer is taken at its word. */
function expandYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/**
 * Whether that day exists.
 *
 * Asked of the calendar rather than of a table of month lengths, so February
 * answers for itself in a leap year: a `Date` given 31 February quietly becomes
 * 3 March, and it is that silent correction — not a range check — that has to be
 * caught here.
 */
function isRealDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
