export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function nextDayUTC(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
}
