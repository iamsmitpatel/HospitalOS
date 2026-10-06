import { DayOfWeek } from '@prisma/client';

const DAY_OF_WEEK_BY_JS_INDEX: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

/**
 * IANA-timezone-aware date math using only Intl.DateTimeFormat (no
 * dependency — master doc §34 requires getting this right, not avoiding it;
 * this is the standard "double formatToParts" technique, correct across DST
 * transitions because Intl resolves the real offset for the given instant
 * from the ICU tz database bundled with Node). See timezone.util.spec.ts for
 * worked examples, including a DST-observing zone.
 */

function offsetMinutesAt(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});

  // The zone's wall-clock reading for `instant`, re-interpreted as if it
  // were itself a UTC instant — the gap between this and the real `instant`
  // IS the zone's offset at that moment (local = utc + offset).
  const wallClockAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (wallClockAsUtcMs - instant.getTime()) / 60_000;
}

/** Converts a hospital-local wall-clock date+time into the UTC instant it represents. */
export function zonedWallTimeToUtc(timeZone: string, isoDate: string, hhmm: string): Date {
  const seed = new Date(`${isoDate}T${hhmm}:00.000Z`);
  const offsetMinutes = offsetMinutesAt(timeZone, seed);
  return new Date(seed.getTime() - offsetMinutes * 60_000);
}

export interface ZonedDateParts {
  /** "YYYY-MM-DD" in the given timezone. */
  date: string;
  /** "HH:mm" (24h) in the given timezone. */
  time: string;
  dayOfWeek: DayOfWeek;
}

/** The inverse: what a UTC instant reads as on the wall clock in a given timezone. */
export function getZonedDateParts(timeZone: string, instant: Date): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});

  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    dayOfWeek: DAY_OF_WEEK_BY_JS_INDEX[weekdayIndex],
  };
}

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHhMm(value: string): boolean {
  return HH_MM_PATTERN.test(value);
}

/** Lexicographic comparison is correct for zero-padded "HH:mm" strings. */
export function compareHhMm(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addMinutesToHhMm(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
