const GTFS_TIME_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/**
 * GTFS times are service-day offsets, not wall-clock: a run leaving at 25:10:00
 * departs at 01:10 on the *next* calendar day but still belongs to the previous
 * service day. Seconds-since-service-midnight preserves that ordering, which plain
 * "HH:MM:SS" string comparison in a time-window query would get wrong.
 *
 * Returns null for empty or malformed values (the column is optional in GTFS).
 */
export function gtfsTimeToSeconds(value: string): number | null {
  const match = GTFS_TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * SECONDS_PER_HOUR + Number(minutes) * SECONDS_PER_MINUTE + Number(seconds);
}
