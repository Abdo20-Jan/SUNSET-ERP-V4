export const PER_PAGE_OPTIONS = [25, 50, 100, 200] as const;

export function parsePaginationParams(params: { page?: string; perPage?: string }): {
  page: number;
  perPage: number;
} {
  const rawPage = Number(params.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const rawPerPage = Number(params.perPage);
  const allowed = new Set<number>(PER_PAGE_OPTIONS as readonly number[] as number[]);
  const perPage = Number.isFinite(rawPerPage) && allowed.has(rawPerPage) ? rawPerPage : 50;
  return { page, perPage };
}
