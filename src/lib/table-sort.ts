export type SortDir = "asc" | "desc";

export type SortState = { sort: string; dir: SortDir };

/**
 * Resuelve `sort`/`dir` de los searchParams contra una allowlist de keys
 * lógicas. NUNCA acepta una key fuera de `allowed` ni una `dir` que no sea
 * "asc"/"desc": ante cualquier valor inválido devuelve el `fallback`. Esto es
 * la primera barrera que evita que un nombre de columna crudo llegue a Prisma.
 */
export function parseSortParams(
  params: { sort?: string; dir?: string },
  allowed: readonly string[],
  fallback: SortState,
): SortState {
  const sort = params.sort && allowed.includes(params.sort) ? params.sort : fallback.sort;
  const dir: SortDir = params.dir === "asc" || params.dir === "desc" ? params.dir : fallback.dir;
  return { sort, dir };
}

/**
 * Traduce el `SortState` (key lógica) a un `orderBy` de Prisma usando el
 * `fieldMap` (key lógica → campo real del modelo). Si la key no está en el
 * mapa devuelve `{}` para que el caller caiga en su orden por defecto: jamás
 * se pasa el nombre crudo a Prisma.
 */
export function buildOrderBy(
  state: SortState,
  fieldMap: Record<string, string>,
): Record<string, SortDir> {
  const field = fieldMap[state.sort];
  if (!field) return {};
  return { [field]: state.dir };
}
