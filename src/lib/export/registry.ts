import { listarClientesParaExport, type ClienteRow } from "@/lib/actions/clientes";
import { listarProductosParaExport, type ProductoRow } from "@/lib/actions/productos";
import { listarProveedoresParaExport, type ProveedorRow } from "@/lib/actions/proveedores";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import type { SortDir } from "@/lib/table-sort";

// Cada recurso es homogéneo en su propio `Row`, pero el registry es heterogéneo.
// En vez de exponer `columns`/`fetchRows` con el tipo borrado (que obligaría a
// `any`), cada recurso encapsula su `Row` detrás de `buildCsv`: el genérico vive
// dentro de `makeResource`, así el registry queda 100% tipado.
export type ExportResource = {
  filename: string;
  buildCsv: (sp: URLSearchParams) => Promise<string>;
};

function makeResource<T>(opts: {
  filename: string;
  columns: ExportColumn<T>[];
  fetchRows: (sp: URLSearchParams) => Promise<T[]>;
}): ExportResource {
  return {
    filename: opts.filename,
    buildCsv: async (sp) => toCsv(opts.columns, await opts.fetchRows(sp)),
  };
}

// `dir` cruda de los searchParams → SortDir solo si es "asc"/"desc"; el resto
// lo normaliza `parseSortParams` aguas abajo (cae al default del action).
function parseDir(sp: URLSearchParams): SortDir | undefined {
  const dir = sp.get("dir");
  return dir === "asc" || dir === "desc" ? dir : undefined;
}

const PRODUCTOS_COLUMNS: ExportColumn<ProductoRow>[] = [
  { header: "Código", value: (r) => r.codigo },
  { header: "Nombre", value: (r) => r.nombre },
  { header: "Marca", value: (r) => r.marca ?? "" },
  { header: "Medida", value: (r) => r.medida ?? "" },
  { header: "NCM", value: (r) => r.ncm ?? "" },
  { header: "Stock", value: (r) => r.stockActual },
  { header: "Precio venta", value: (r) => r.precioVenta },
  { header: "Estado", value: (r) => (r.activo ? "Activo" : "Inactivo") },
];

const CLIENTES_COLUMNS: ExportColumn<ClienteRow>[] = [
  { header: "Nombre", value: (r) => r.nombre },
  { header: "CUIT", value: (r) => r.cuit ?? "" },
  { header: "Condición IVA", value: (r) => r.condicionIva },
  { header: "Teléfono", value: (r) => r.telefono ?? "" },
  { header: "Email", value: (r) => r.email ?? "" },
  { header: "Estado", value: (r) => r.estado },
  { header: "Cuenta", value: (r) => r.cuentaContableCodigo ?? "" },
];

const PROVEEDORES_COLUMNS: ExportColumn<ProveedorRow>[] = [
  { header: "Nombre", value: (r) => r.nombre },
  { header: "CUIT", value: (r) => r.cuit ?? "" },
  { header: "País", value: (r) => r.pais },
  { header: "Tipo", value: (r) => r.tipoProveedor },
  { header: "Estado", value: (r) => r.estado },
  { header: "Cuenta", value: (r) => r.cuentaContableCodigo ?? "" },
];

// Registry de recursos exportables. Cada `fetchRows` lee q/filtro/sort/dir de
// los searchParams (IGNORA page/perPage) y delega en `listarXxxParaExport`,
// que aplica el MISMO where/orderBy que la lista pero trae TODAS las filas.
export const EXPORT_REGISTRY: Record<string, ExportResource> = {
  productos: makeResource<ProductoRow>({
    filename: "productos",
    columns: PRODUCTOS_COLUMNS,
    fetchRows: (sp) =>
      listarProductosParaExport({
        q: sp.get("q") ?? undefined,
        marca: sp.get("marca") ?? undefined,
        sort: sp.get("sort") ?? undefined,
        dir: parseDir(sp),
      }),
  }),
  clientes: makeResource<ClienteRow>({
    filename: "clientes",
    columns: CLIENTES_COLUMNS,
    fetchRows: (sp) =>
      listarClientesParaExport({
        q: sp.get("q") ?? undefined,
        estado: sp.get("estado") ?? undefined,
        sort: sp.get("sort") ?? undefined,
        dir: parseDir(sp),
      }),
  }),
  proveedores: makeResource<ProveedorRow>({
    filename: "proveedores",
    columns: PROVEEDORES_COLUMNS,
    fetchRows: (sp) =>
      listarProveedoresParaExport({
        q: sp.get("q") ?? undefined,
        pais: sp.get("pais") ?? undefined,
        sort: sp.get("sort") ?? undefined,
        dir: parseDir(sp),
      }),
  }),
};
