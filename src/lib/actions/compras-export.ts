"use server";

/**
 * Exportación AUDITADA de la worklist de compras. Mirror de
 * `fin-cxc-export.ts` (PR-026): re-lee server-side la MISMA página visible —
 * `listarCompras` con los MISMOS `page`/`perPage` de la URL (el export
 * respeta la paginación server activa: exporta la página que el usuario está
 * viendo, no el histórico completo) — más el MISMO vínculo OC↔factura de la
 * page (2 queries acotadas a las filas cargadas), aplana con el helper puro
 * compartido (`flattenCompras`), serializa CSV/XLSX y registra un evento
 * EXPORTACION (meta-auditoría; si falla, propaga — no se entrega el archivo
 * sin registrar).
 *
 * Montos native-first: el "Total" del archivo es el NATIVO de cada factura
 * (columna "Moneda" al lado); acá no se convierte nada — `?moneda` de la URL
 * sólo viaja en `filtros` para el rastro de auditoría (es presentación del
 * grid, no filtro de datos).
 *
 * Superficie de import DELIBERADAMENTE restringida a lectura + presentación +
 * serialización + auditoría: NUNCA importa el motor de asientos ni actions de
 * mutación.
 */

import {
  flattenCompras,
  type PedidoVinculo,
} from "@/app/(dashboard)/compras/_components/compras-presentacion";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import { listarCompras } from "@/lib/actions/compras";
import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";

type Formato = "csv" | "xlsx";

export type ExportarComprasResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fila proyectada para el archivo: una compra, total NATIVO. */
type FilaExport = {
  numero: string;
  proveedor: string;
  estado: string;
  fecha: string;
  vencimiento: string;
  pedido: string;
  moneda: string;
  total: string;
};

/** Fecha ISO → YYYY-MM-DD ("" cuando falta). */
function isoDia(fecha: string | null): string {
  if (!fecha) return "";
  return fecha.slice(0, 10);
}

/** Número de la OC de origen ("" cuando la factura no nació de una OC). */
function pedidoExport(pedido: PedidoVinculo | null): string {
  if (!pedido) return "";
  return pedido.numero;
}

// MISMO vínculo OC↔factura que la page de compras (2 queries acotadas a las
// filas de la página; la 2ª depende de los ids de la 1ª). No se toca
// `listarCompras` (action protegida) — el join va aparte, espejo exacto de
// `cargarPedidoPorCompra` en `compras/page.tsx`.
async function cargarPedidoPorCompra(compraIds: string[]): Promise<Map<string, PedidoVinculo>> {
  const vinculos = await db.compra.findMany({
    where: { id: { in: compraIds }, pedidoCompraId: { not: null } },
    select: { id: true, pedidoCompraId: true },
  });
  const pedidoIds = vinculos.map((v) => v.pedidoCompraId).filter((id): id is number => id !== null);
  const pedidos = await db.pedidoCompra.findMany({
    where: { id: { in: pedidoIds } },
    select: { id: true, numero: true },
  });
  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const map = new Map<string, PedidoVinculo>();
  for (const v of vinculos) {
    if (v.pedidoCompraId === null) continue;
    const pedido = pedidoPorId.get(v.pedidoCompraId);
    if (pedido) map.set(v.id, pedido);
  }
  return map;
}

function buildColumnas(): ExportColumn<FilaExport>[] {
  return [
    { header: "Número", value: (r) => r.numero },
    { header: "Proveedor", value: (r) => r.proveedor },
    { header: "Estado", value: (r) => r.estado },
    { header: "Fecha", value: (r) => r.fecha },
    { header: "Vencimiento", value: (r) => r.vencimiento },
    { header: "Pedido (OC)", value: (r) => r.pedido },
    { header: "Moneda", value: (r) => r.moneda },
    { header: "Total", value: (r) => r.total },
  ];
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  columnas: ExportColumn<FilaExport>[],
  rows: FilaExport[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(columnas, rows, "Compras");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `compras-${sello}.xlsx`,
    };
  }
  const csv = toCsv(columnas, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `compras-${sello}.csv`,
  };
}

export async function exportarCompras(input: {
  params: { page?: string; perPage?: string; moneda?: string };
  formato: Formato;
}): Promise<ExportarComprasResult> {
  // Autenticado (FK-safe para el evento de auditoría).
  await requireSessionUser();

  // MISMO parser de paginación que la page → misma página visible.
  const { page, perPage } = parsePaginationParams(input.params);
  const { rows: compras } = await listarCompras({ page, perPage });

  const pedidoPorCompra = await cargarPedidoPorCompra(compras.map((c) => c.id));
  const filas = flattenCompras(compras, pedidoPorCompra);

  const rows: FilaExport[] = filas.map((f) => ({
    numero: f.numero,
    proveedor: f.proveedorNombre,
    estado: f.estado,
    fecha: isoDia(f.fecha),
    vencimiento: isoDia(f.fechaVencimiento),
    pedido: pedidoExport(f.pedido),
    moneda: f.moneda,
    total: f.total,
  }));
  const columnas = buildColumnas();
  const { base64, mime, filename } = await serializarExport(input.formato, columnas, rows);

  // Meta-auditoría: si falla, propaga → no se entrega el archivo sin registrar.
  await auditarExportacion({
    recurso: "compras",
    filtros: input.params,
    columnas: columnas.map((c) => c.header),
    nFilas: rows.length,
    formato: input.formato,
  });

  return { ok: true, filename, mime, base64 };
}
