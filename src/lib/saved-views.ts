// Helpers puros para las vistas guardadas (SavedView). Sin dependencias de
// React/Prisma: serializan la "vista" (filtros de la URL + columnas visibles)
// hacia/desde un JSON estable. Probados en test/saved-views.test.ts.

// Params de la URL que NO forman parte de una vista (paginación y formato de
// export). Una vista guarda filtros/búsqueda/orden, no la página actual.
const PARAMS_EXCLUIDOS = new Set(["page", "perPage", "formato"]);

export type SavedViewConfig = {
  params: Record<string, string>;
  columns: Record<string, boolean>;
};

// Captura la vista actual: los search params relevantes (sin paginación ni
// valores vacíos) + el estado de visibilidad de columnas de la tabla.
export function buildViewConfig(
  searchParams: URLSearchParams,
  columnVisibility: Record<string, boolean>,
): SavedViewConfig {
  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!PARAMS_EXCLUIDOS.has(key) && value !== "") params[key] = value;
  }
  const columns: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(columnVisibility)) columns[key] = value;
  return { params, columns };
}

// Reconstruye los search params de una vista (paginación excluida → al aplicar
// una vista se vuelve a la página 1).
export function viewConfigToSearchParams(config: SavedViewConfig): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(config.params)) {
    if (!PARAMS_EXCLUIDOS.has(key) && value !== "") sp.set(key, value);
  }
  return sp;
}

// ¿La URL actual ya trae algún filtro/orden de vista? Decide si la vista
// predeterminada debe auto-aplicarse (sólo cuando la ruta se abre "limpia").
export function hayParamsDeVista(searchParams: URLSearchParams): boolean {
  for (const key of searchParams.keys()) {
    if (!PARAMS_EXCLUIDOS.has(key)) return true;
  }
  return false;
}

// Normaliza un `config` leído de la base (Json) hacia SavedViewConfig,
// descartando cualquier forma inválida (defensa ante JSON malformado).
export function coerceViewConfig(value: unknown): SavedViewConfig {
  const root = (value ?? {}) as Record<string, unknown>;
  const params: Record<string, string> = {};
  if (root.params && typeof root.params === "object") {
    for (const [key, val] of Object.entries(root.params as Record<string, unknown>)) {
      if (typeof val === "string") params[key] = val;
    }
  }
  const columns: Record<string, boolean> = {};
  if (root.columns && typeof root.columns === "object") {
    for (const [key, val] of Object.entries(root.columns as Record<string, unknown>)) {
      if (typeof val === "boolean") columns[key] = val;
    }
  }
  return { params, columns };
}
