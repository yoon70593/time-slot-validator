import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeSlotValidator } from '../src/index.js';

// Helper: build an epoch-ms from a UTC date-time string.
function utcMs(s) {
  return Date.parse(s);
}

test('constructor rejects non-array windows', () => {
  assert.throws(() => new TimeSlotValidator(null, 'UTC'), TypeError);
});

test('constructor rejects empty timezone string', () => {
  assert.throws(() => new TimeSlotValidator([], ''), TypeError);
});

test('constructor rejects invalid IANA timezone', () => {
  assert.throws(() => new TimeSlotValidator([], 'Not/A/Real/Zone'), RangeError);
});

test('constructor rejects weekday out of range', () => {
  assert.throws(
    () => new TimeSlotValidator([{ weekday: 0, startSecond: 0, endSecond: 3600 }], 'UTC'),
    RangeError
  );
});

test('constructor rejects zero-length window', () => {
  assert.throws(
    () => new TimeSlotValidator([{ weekday: 1, startSecond: 100, endSecond: 100 }], 'UTC'),
    RangeError
  );
});

test('same-day window matches inside, rejects outside', () => {
  // Monday 10:00-12:00 UTC.
  const v = new TimeSlotValidator(
    [{ weekday: 1, startSecond: 10 * 3600, endSecond: 12 * 3600 }],
    'UTC'
  );
  // 2024-01-01 is a Monday.
  assert.equal(v.isAvailable(utcMs('2024-01-01T10:30:00Z')), true);
  assert.equal(v.isAvailable(utcMs('2024-01-01T12:00:00Z')), false); // end exclusive
  assert.equal(v.isAvailable(utcMs('2024-01-01T09:59:59Z')), false);
  // Tuesday — wrong day.
  assert.equal(v.isAvailable(utcMs('2024-01-02T10:30:00Z')), false);
});

test('cross-midnight window matches on start day and next day', () => {
  // Sunday 23:00 - Monday 01:00.
  const v = new TimeSlotValidator(
    [{ weekday: 7, startSecond: 23 * 3600, endSecond: 3600 }],
    'UTC'
  );
  // 2023-12-31 is Sunday, 2024-01-01 is Monday.
  assert.equal(v.isAvailable(utcMs('2023-12-31T23:30:00Z')), true);
  assert.equal(v.isAvailable(utcMs('2024-01-01T00:30:00Z')), true);
  assert.equal(v.isAvailable(utcMs('2024-01-01T01:00:00Z')), false); // end exclusive
  assert.equal(v.isAvailable(utcMs('2024-01-01T02:00:00Z')), false);
});

test('timezone shift: window in America/New_York', () => {
  // Monday 09:00-17:00 America/New_York (EST5EDT). In January, EST = UTC-5.
  // So 09:00 EST = 14:00 UTC, 17:00 EST = 22:00 UTC.
  const v = new TimeSlotValidator(
    [{ weekday: 1, startSecond: 9 * 3600, endSecond: 17 * 3600 }],
    'America/New_York'
  );
  // 2024-01-01 Monday 15:00 UTC = 10:00 EST -> inside.
  assert.equal(v.isAvailable(utcMs('2024-01-01T15:00:00Z')), true);
  // 2024-01-01 13:00 UTC = 08:00 EST -> before window.
  assert.equal(v.isAvailable(utcMs('2024-01-01T13:00:00Z')), false);
  // 2024-01-01 22:00 UTC = 17:00 EST -> end exclusive.
  assert.equal(v.isAvailable(utcMs('2024-01-01T22:00:00Z')), false);
});

test('multiple windows: matches any', () => {
  const v = new TimeSlotValidator(
    [
      { weekday: 1, startSecond: 0, endSecond: 3600 },        // Mon 00:00-01:00
      { weekday: 3, startSecond: 12 * 3600, endSecond: 13 * 3600 }, // Wed 12:00-13:00
    ],
    'UTC'
  );
  assert.equal(v.isAvailable(utcMs('2024-01-01T00:30:00Z')), true);  // Monday
  assert.equal(v.isAvailable(utcMs('2024-01-03T12:30:00Z')), true);  // Wednesday
  assert.equal(v.isAvailable(utcMs('2024-01-02T00:30:00Z')), false); // Tuesday
});

test('full 24h window via start=0 end=86400', () => {
  const v = new TimeSlotValidator(
    [{ weekday: 2, startSecond: 0, endSecond: 86400 }],
    'UTC'
  );
  // 2024-01-02 is Tuesday.
  assert.equal(v.isAvailable(utcMs('2024-01-02T00:00:00Z')), true);
  assert.equal(v.isAvailable(utcMs('2024-01-02T23:59:59Z')), true);
  assert.equal(v.isAvailable(utcMs('2024-01-03T00:00:00Z')), false); // Wednesday
});

test('isAvailable rejects non-finite epochMs', () => {
  const v = new TimeSlotValidator([], 'UTC');
  assert.throws(() => v.isAvailable(NaN), TypeError);
  assert.throws(() => v.isAvailable(Infinity), TypeError);
});

test('empty windows list never matches', () => {
  const v = new TimeSlotValidator([], 'UTC');
  assert.equal(v.isAvailable(utcMs('2024-01-01T00:00:00Z')), false);
});
