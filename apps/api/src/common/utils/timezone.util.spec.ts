import {
  zonedWallTimeToUtc,
  getZonedDateParts,
  isValidHhMm,
  compareHhMm,
  addMinutesToHhMm,
} from './timezone.util';
import { DayOfWeek } from '@prisma/client';

describe('timezone.util', () => {
  describe('zonedWallTimeToUtc', () => {
    it('converts Asia/Kolkata (UTC+5:30, no DST) wall time to the correct UTC instant', () => {
      const utc = zonedWallTimeToUtc('Asia/Kolkata', '2026-10-05', '09:00');
      expect(utc.toISOString()).toBe('2026-10-05T03:30:00.000Z');
    });

    it('converts a half-hour-offset zone correctly at a different time of day', () => {
      const utc = zonedWallTimeToUtc('Asia/Kolkata', '2026-10-05', '23:45');
      expect(utc.toISOString()).toBe('2026-10-05T18:15:00.000Z');
    });

    it('handles a DST-observing zone correctly on both sides of a DST transition (America/New_York)', () => {
      // EST (UTC-5) before the 2026 spring-forward transition (2026-03-08).
      const beforeDst = zonedWallTimeToUtc('America/New_York', '2026-03-01', '09:00');
      expect(beforeDst.toISOString()).toBe('2026-03-01T14:00:00.000Z');

      // EDT (UTC-4) after the transition.
      const afterDst = zonedWallTimeToUtc('America/New_York', '2026-03-15', '09:00');
      expect(afterDst.toISOString()).toBe('2026-03-15T13:00:00.000Z');
    });
  });

  describe('getZonedDateParts', () => {
    it('is the inverse of zonedWallTimeToUtc for a no-DST zone', () => {
      const utc = zonedWallTimeToUtc('Asia/Kolkata', '2026-10-05', '09:00');
      const parts = getZonedDateParts('Asia/Kolkata', utc);
      expect(parts.date).toBe('2026-10-05');
      expect(parts.time).toBe('09:00');
    });

    it('computes the correct day of week in the target zone, not the server/UTC zone', () => {
      // 2026-10-05 is a Monday.
      const utc = zonedWallTimeToUtc('Asia/Kolkata', '2026-10-05', '09:00');
      expect(getZonedDateParts('Asia/Kolkata', utc).dayOfWeek).toBe(DayOfWeek.MONDAY);
    });

    it('can disagree on calendar date with UTC near a day boundary', () => {
      // 23:45 IST on Oct 5 is still Oct 5 in Kolkata, but 18:15 UTC the same day.
      const utc = zonedWallTimeToUtc('Asia/Kolkata', '2026-10-05', '23:45');
      expect(getZonedDateParts('Asia/Kolkata', utc).date).toBe('2026-10-05');
      expect(getZonedDateParts('UTC', utc).date).toBe('2026-10-05');

      // But 00:15 IST on Oct 6 is still Oct 5 in UTC (18:45 the prior day).
      const utc2 = zonedWallTimeToUtc('Asia/Kolkata', '2026-10-06', '00:15');
      expect(getZonedDateParts('Asia/Kolkata', utc2).date).toBe('2026-10-06');
      expect(getZonedDateParts('UTC', utc2).date).toBe('2026-10-05');
    });
  });

  describe('HH:mm helpers', () => {
    it('validates strict zero-padded 24h format', () => {
      expect(isValidHhMm('09:00')).toBe(true);
      expect(isValidHhMm('23:59')).toBe(true);
      expect(isValidHhMm('9:00')).toBe(false);
      expect(isValidHhMm('24:00')).toBe(false);
      expect(isValidHhMm('12:60')).toBe(false);
    });

    it('compares HH:mm strings in chronological order', () => {
      expect(compareHhMm('09:00', '11:45')).toBeLessThan(0);
      expect(compareHhMm('11:45', '09:00')).toBeGreaterThan(0);
      expect(compareHhMm('09:00', '09:00')).toBe(0);
    });

    it('adds minutes with correct rounding and midnight wraparound', () => {
      expect(addMinutesToHhMm('09:00', 15)).toBe('09:15');
      expect(addMinutesToHhMm('11:50', 15)).toBe('12:05');
      expect(addMinutesToHhMm('23:50', 15)).toBe('00:05');
    });
  });
});
