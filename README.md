# Time Slot Validator

Checks whether a given UTC instant falls within a set of recurring weekly availability windows defined in a specific IANA timezone.

```js
import { TimeSlotValidator } from 'time-slot-validator';

const v = new TimeSlotValidator(
  [
    { weekday: 1, startSecond: 9 * 3600, endSecond: 17 * 3600 }, // Mon 09:00-17:00
    { weekday: 3, startSecond: 12 * 3600, endSecond: 13 * 3600 }, // Wed 12:00-13:00
  ],
  'America/New_York'
);

v.isAvailable(Date.parse('2024-01-15T14:30:00Z')); // true (Mon 09:30 EST)
```

## Why

Scheduling code often needs to answer "is this UTC instant inside business hours in some local timezone?" without pulling in a full date library. This library does exactly that, using only the host's `Intl` API for timezone conversion. The trade-off: it depends on the runtime's TZ data being present and current, which is true for Node and modern browsers but not guaranteed on every embedded engine.

## Edge cases

Windows are weekly-recurring with inclusive start and exclusive end, both in local seconds from midnight. A window with `endSecond < startSecond` crosses midnight into the next day. The end instant is never counted as available, so two adjacent windows do not overlap. DST transitions are handled implicitly: a window of 09:00-17:00 local always means 09:00-17:00 local on the day in question, whatever the UTC offset is. Zero-length windows (`startSecond === endSecond`) are rejected at construction; use `startSecond: 0, endSecond: 86400` for a full 24-hour day.

## Exports

- `TimeSlotValidator` (class)
  - `constructor(windows: Array<{weekday: number, startSecond: number, endSecond: number}>, timeZone: string)`
  - `isAvailable(epochMs: number): boolean`

`weekday` is ISO 1=Mon..7=Sun. `startSecond` and `endSecond` are local seconds from midnight in `[0, 86400]`.
