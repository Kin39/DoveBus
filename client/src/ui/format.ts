import type { FreshnessBucket } from "../api/types.js";

/**
 * Freshness thresholds, in seconds — the same numbers `server/src/config.ts`
 * bucket by. Duplicated rather than fetched because the client re-derives the
 * bucket continuously between snapshots: a bus's fix keeps ageing while the
 * screen is open, and a label frozen at the value the server computed on
 * delivery would quietly become a lie.
 */
export const FRESHNESS_LIVE_S = 90;
export const FRESHNESS_RECENT_S = 180;
export const FRESHNESS_DELAYED_S = 300;

/** Where the ageing bar is considered full. Past this the data is simply old. */
export const FRESHNESS_FULL_S = FRESHNESS_DELAYED_S;

/**
 * Past this age a bus is dropped from the map rather than drawn faded.
 *
 * Derived from this feed, not borrowed: busbus.it hides at three minutes, but a
 * fix here is already ~116 s old when it arrives and the next one is ~120 s
 * behind it, so a three-minute rule empties the whole map twice every cycle —
 * measured at 0% / 83% / 82% / 74% / 26% / 0% of 1,092 vehicles over two and a
 * half minutes. Five minutes is where that flicker stops: a steady 84–85% of the
 * fleet stays drawn, and the ~15% left out are genuinely no longer reporting.
 *
 * Re-derive this if the publisher's cadence ever changes.
 */
export const MAX_VISIBLE_AGE_S = 300;

export function bucketOf(ageSeconds: number | null): FreshnessBucket {
  if (ageSeconds === null) return "stale";
  if (ageSeconds <= FRESHNESS_LIVE_S) return "live";
  if (ageSeconds <= FRESHNESS_RECENT_S) return "recent";
  if (ageSeconds <= FRESHNESS_DELAYED_S) return "delayed";
  return "stale";
}

/**
 * What each bucket is called on screen.
 *
 * "silenzioso" rather than a translation of "stale": the honest statement about
 * an old fix is that the bus has stopped reporting, not that its position is
 * wrong. The exact age in seconds is always printed next to this word, so the
 * label never has to carry precision it does not have.
 */
const FRESHNESS_LABEL: Record<FreshnessBucket, string> = {
  live: "in diretta",
  recent: "recente",
  delayed: "attenuato",
  stale: "silenzioso",
};

export function freshnessLabel(bucket: FreshnessBucket): string {
  return FRESHNESS_LABEL[bucket];
}

/**
 * Age as the plan requires it: the unrounded number of seconds, spoken plainly.
 * Minutes take over past two, because "412 s fa" stops being a quantity a person
 * can feel.
 */
export function ageLabel(ageSeconds: number | null): string {
  if (ageSeconds === null) return "orario sconosciuto";
  if (ageSeconds < 0) return "adesso";
  if (ageSeconds < 120) return `${ageSeconds} s fa`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 90) return `${minutes} min fa`;
  return `${Math.floor(minutes / 60)} h fa`;
}

/** Live age recomputed from the bus's own clock, never from a local stopwatch. */
export function ageFromTimestamp(
  timestamp: number | null,
  nowMs: number = Date.now(),
): number | null {
  if (timestamp === null) return null;
  return Math.max(0, Math.round(nowMs / 1000 - timestamp));
}

export interface DelayView {
  readonly label: string;
  readonly tone: "early" | "ontime" | "late" | "heavy" | "cancelled";
}

/** Late by under this is indistinguishable from on time at a bus stop. */
const ON_TIME_TOLERANCE_S = 60;
/** Past this a delay stops being a delay and becomes a different plan. */
const HEAVY_DELAY_S = 15 * 60;

export function delayView(delaySeconds: number | null, cancelled: boolean): DelayView | null {
  if (cancelled) return { label: "soppressa", tone: "cancelled" };
  if (delaySeconds === null) return null;
  if (Math.abs(delaySeconds) < ON_TIME_TOLERANCE_S) return { label: "in orario", tone: "ontime" };

  const minutes = Math.round(Math.abs(delaySeconds) / 60);
  if (delaySeconds < 0) return { label: `${minutes} min in anticipo`, tone: "early" };
  return {
    label: `+${minutes} min`,
    tone: delaySeconds >= HEAVY_DELAY_S ? "heavy" : "late",
  };
}

/** `06:47:00` → `06:47`. GTFS hours run past 24 and are kept as written. */
export function clockTime(gtfsTime: string | null): string {
  if (!gtfsTime) return "—";
  const [hours, minutes] = gtfsTime.split(":");
  return hours && minutes ? `${hours}:${minutes}` : gtfsTime;
}

export function secondsToClock(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Journey length between two service-day times, tolerant of the 24:00 rollover. */
export function durationLabel(fromSeconds: number | null, toSeconds: number | null): string | null {
  if (fromSeconds === null || toSeconds === null) return null;
  const total = Math.round((toSeconds - fromSeconds) / 60);
  if (total <= 0) return null;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes).padStart(2, "0")}`;
}

/**
 * GTFS stop names arrive in shouting caps ("AREZZO TERMINAL (INTERNO)").
 * Title case makes a list of them readable without hiding what they say; the
 * articles and prepositions that pepper Tuscan place names stay lowercase.
 *
 * Deliberately excluded from that list: `val`, `il`, `la`, `lo`. They look like
 * articles but they are parts of names here — "Val di Cecina", "La Rotta" — and
 * lowercasing them mangles the place rather than tidying it.
 */
const LOWERCASE_PARTICLES = new Set([
  "di",
  "del",
  "dello",
  "della",
  "dei",
  "degli",
  "delle",
  "da",
  "dal",
  "dalla",
  "al",
  "alla",
  "ai",
  "agli",
  "alle",
  "in",
  "su",
  "sul",
  "sulla",
  "con",
  "per",
  "a",
  "e",
  "ed",
]);

export function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("it-IT")
    .split(/(\s+|\(|\)|\/|-)/)
    .map((part, index) => {
      if (!/\p{L}/u.test(part)) return part;
      if (index > 0 && LOWERCASE_PARTICLES.has(part)) return part;
      return part.charAt(0).toLocaleUpperCase("it-IT") + part.slice(1);
    })
    .join("");
}

/** GTFS service date (`YYYYMMDD`) for a local calendar day. */
export function toServiceDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function serviceDateToInput(serviceDate: string): string {
  return `${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}`;
}

export function inputToServiceDate(value: string): string {
  return value.replaceAll("-", "");
}

/** `1115` → `1.115`, the Italian thousands separator. */
export function count(value: number): string {
  return new Intl.NumberFormat("it-IT").format(value);
}
