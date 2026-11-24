export const ADMIN_PAGE_SIZE = 12;

export function cmp(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), 'fr', { sensitivity: 'base', numeric: true });
}

export function slicePage<T>(items: T[], page: number, size = ADMIN_PAGE_SIZE) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const safe = Math.min(Math.max(page, 1), pages);
  const start = (safe - 1) * size;
  return { rows: items.slice(start, start + size), page: safe, pages, total };
}
