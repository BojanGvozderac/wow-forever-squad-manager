/** Calendar dates are wall-clock dates; move dates before resolving their timezone. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
export function localDateTime(epoch: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epoch);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
/** Return every matching instant, so callers must explicitly disambiguate a DST fold. */
export function localTimeCandidates(value: string, timezone: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const wall = Date.parse(`${value}:00Z`);
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== value
  )
    return [];
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = wall + hours * 3600000;
    offsets.add(Date.parse(`${localDateTime(probe, timezone)}:00Z`) - probe);
  }
  return [...offsets]
    .map((offset) => wall - offset)
    .filter((epoch) => localDateTime(epoch, timezone) === value)
    .sort((a, b) => a - b);
}
export function timezoneOffset(epoch: number, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(epoch)
    .find((p) => p.type === "timeZoneName")!.value;
}
export function weekRange(monday: string, timezone: string) {
  const from = localTimeCandidates(`${monday}T00:00`, timezone)[0];
  const to = localTimeCandidates(`${addDays(monday, 7)}T00:00`, timezone)[0];
  if (from === undefined || to === undefined)
    throw new Error(
      "This week has an unavailable midnight in the selected timezone.",
    );
  return { from, to };
}
export function overlapsDay(
  startsAt: number,
  endsAt: number,
  day: string,
  timezone: string,
) {
  const from = localTimeCandidates(`${day}T00:00`, timezone)[0];
  const to = localTimeCandidates(`${addDays(day, 1)}T00:00`, timezone)[0];
  return startsAt < to && endsAt > from;
}
