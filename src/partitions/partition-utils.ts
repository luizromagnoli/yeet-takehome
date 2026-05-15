export interface MonthBoundary {
  yyyy: string;
  mm: string;
  iso: string;
}

export function monthBoundary(reference: Date, offsetMonths: number): MonthBoundary {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const d = new Date(Date.UTC(year, month + offsetMonths, 1));
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return { yyyy, mm, iso: `${yyyy}-${mm}-01` };
}

export function partitionName(boundary: MonthBoundary): string {
  return `actions_${boundary.yyyy}_${boundary.mm}`;
}
