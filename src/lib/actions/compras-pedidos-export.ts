"use server";

/**
 * Exportación AUDITADA de la worklist de pedidos de compra (COMP-01 · PR-029).
 * Mirror de `fin-cxc-export.ts` (PR-026): re-lee server-side la MISMA vista de
 * la URL vía `listarPedidosCompra` + el MISMO groupBy de compras vinculadas de
 * la page, aplana/filtra con los MISMOS helpers puros (nunca se serializa lo
 * que el client ya tiene), serializa CSV/XLSX y registra un evento EXPORTACION
 * ANTES de entregar (meta-auditoría; si falla, no se entrega el archivo).
 *
 * Montos native-first: el archivo lleva el total NATIVO + la columna Moneda —
 * sin conversión (el TC de cierre es presentación del grid, no del archivo).
 * Sin gate de permiso: la página de compras es abierta hoy (no se inventa
 * chave); `requireSessionUser()` garantiza sesión FK-safe para la auditoría.
 */

import {
  filtrarPorVista,
  flattenPedidos,
  type PedidoCompraWorklistRow,
  resolverVista,
} from "@/app/(dashboard)/compras/pedidos/_components/pedidos-compra-presentacion";
import { CompraEstado } from "@/generated/prisma/client";
import { listarPedidosCompra } from "@/lib/actions/pedidos-compra";
import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";
import { toXlsx } from "@/lib/export/xlsx";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";

type Formato = "csv" | "xlsx";

export type ExportarPedidosCompraResult =
  | { ok: true; filename: string; mime: string; base64: string }
  | { ok: false; error: string };

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fecha ISO → YYYY-MM-DD ("" cuando falta). */
function isoDia(fecha: string | null): string {
  if (!fecha) return "";
  return fecha.slice(0, 10);
}

/** Compras vinculadas para el archivo ("" cuando 0 — espejo del "—" del grid). */
function comprasExport(n: number): number | "" {
  if (n === 0) return "";
  return n;
}

const COLUMNAS: ExportColumn<PedidoCompraWorklistRow>[] = [
  { header: "OC", value: (r) => r.numero },
  { header: "Proveedor", value: (r) => r.proveedorNombre },
  { header: "Estado", value: (r) => r.estado },
  { header: "Fecha", value: (r) => isoDia(r.fecha) },
  { header: "Prevista", value: (r) => isoDia(r.fechaPrevista) },
  { header: "Moneda", value: (r) => r.moneda },
  { header: "Total estimado", value: (r) => r.total },
  { header: "Ítems", value: (r) => r.itemsCount },
  { header: "Compras", value: (r) => comprasExport(r.comprasCount) },
];

/**
 * MISMO groupBy que la page: compras reales (EMITIDA/RECIBIDA) por pedido.
 * BORRADOR/CANCELADA no cuentan como vinculación efectiva.
 */
async function contarComprasVinculadas(): Promise<Map<number, number>> {
  const grupos = await db.compra.groupBy({
    by: ["pedidoCompraId"],
    where: {
      pedidoCompraId: { not: null },
      estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] },
    },
    _count: { _all: true },
  });
  const map = new Map<number, number>();
  for (const g of grupos) {
    if (g.pedidoCompraId != null) map.set(g.pedidoCompraId, g._count._all);
  }
  return map;
}

function selloFecha(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function serializarExport(
  formato: Formato,
  rows: PedidoCompraWorklistRow[],
): Promise<{ base64: string; mime: string; filename: string }> {
  const sello = selloFecha();
  if (formato === "xlsx") {
    const bytes = await toXlsx(COLUMNAS, rows, "Pedidos de compra");
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mime: XLSX_MIME,
      filename: `compras-pedidos-${sello}.xlsx`,
    };
  }
  const csv = toCsv(COLUMNAS, rows);
  return {
    base64: Buffer.from(csv, "utf8").toString("base64"),
    mime: CSV_MIME,
    filename: `compras-pedidos-${sello}.csv`,
  };
}

export async function exportarPedidosCompra(input: {
  params: { vista?: string; moneda?: string };
  formato: Formato;
}): Promise<ExportarPedidosCompraResult> {
  try {
    // Autenticado (FK-safe para el evento de auditoría).
    await requireSessionUser();

    const [pedidos, comprasPorPedido] = await Promise.all([
      listarPedidosCompra(),
      contarComprasVinculadas(),
    ]);

    // Mismo preset (`?vista=`) que la page — server-side, helpers puros.
    const vista = resolverVista(input.params.vista);
    const filas = filtrarPorVista(flattenPedidos(pedidos, comprasPorPedido), vista);

    const { base64, mime, filename } = await serializarExport(input.formato, filas);

    // Meta-auditoría ANTES de retornar: si falla, no se entrega el archivo.
    await auditarExportacion({
      recurso: "compras-pedidos",
      filtros: input.params,
      columnas: COLUMNAS.map((c) => c.header),
      nFilas: filas.length,
      formato: input.formato,
    });

    return { ok: true, filename, mime, base64 };
  } catch (err) {
    if (err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: "Error al exportar los pedidos de compra." };
  }
}
