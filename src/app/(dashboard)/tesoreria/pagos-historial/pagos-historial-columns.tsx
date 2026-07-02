"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de histórico de pagos
 * (TES-02 · PR-025b). Cada celda no trivial es un renderer nombrado de módulo
 * para mantener `buildPagosHistorialColumns` en complejidad ciclomática baja.
 *
 * NOTA de gate: los montos son datos TRANSACCIONALES de pagos ya ejecutados
 * (leídos de asientos CONTABILIZADOS por `getHistoricoPagos`, nunca
 * recomputados) — NO son "saldo" de cuenta, así que siguen el comportamiento
 * actual (visibles). El gate `VER_SALDO` (PR-025) cubre saldos/agregados.
 *
 * Las celdas replican 1:1 el rendering de `pagos-historial-table.tsx` (que
 * sigue VIVA para la pestaña Pagos de la ficha de proveedor — no tocar).
 * `facturas` de origen "embarque" sólo trae `embarqueCodigo` (sin id) → sin
 * deep-link a /comex (el servicio no se modifica).
 */

import type { ColumnDef } from "@tanstack/react-table";

import type { PagoHistorico } from "@/lib/services/historico-pagos";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/data-grid/entity-link";

const DASH = "—";

function fmtMoney(s: string | number) {
  const n = typeof s === "string" ? Number(s) : s;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function FechaCell({ row }: { row: PagoHistorico }) {
  return <span className="whitespace-nowrap text-sm tabular-nums">{fmtFecha(row.fecha)}</span>;
}

function ProveedorCell({ row }: { row: PagoHistorico }) {
  if (!row.proveedorId) return <span className="text-muted-foreground italic">{DASH}</span>;
  return (
    <EntityLink
      label={row.proveedorNombre ?? DASH}
      href={`/maestros/proveedores/${row.proveedorId}`}
      tabLabel={row.proveedorNombre ?? "Proveedor"}
    />
  );
}

function FacturasCell({ row }: { row: PagoHistorico }) {
  if (row.facturas.length === 0) {
    return <span className="text-xs text-muted-foreground">{row.descripcion ?? DASH}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {row.facturas.map((f) => (
        <Badge
          key={`${f.origen}::${f.id}`}
          variant={f.origen === "embarque" ? "secondary" : "outline"}
        >
          {f.embarqueCodigo ? `${f.embarqueCodigo} · ` : ""}
          {f.numero}
        </Badge>
      ))}
    </div>
  );
}

function DifCambioCell({ row }: { row: PagoHistorico }) {
  if (row.diferenciaCambiaria === null) {
    return <span className="block text-right text-xs text-muted-foreground">{DASH}</span>;
  }
  return (
    <span
      className={
        "block text-right font-mono text-xs tabular-nums " +
        (row.diferenciaCambiariaSigno === "gain" ? "text-emerald-700" : "text-amber-700")
      }
    >
      {row.diferenciaCambiariaSigno === "gain" ? "+" : "-"}
      {fmtMoney(row.diferenciaCambiaria)}
    </span>
  );
}

function AsientoCell({ row }: { row: PagoHistorico }) {
  if (!row.asientoNumero || !row.asientoId) {
    return <span className="block text-right text-xs text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="flex justify-end">
      <EntityLink
        label={`#${row.asientoNumero}`}
        href={`/contabilidad/asientos/${row.asientoId}`}
        tabLabel={`Asiento #${row.asientoNumero}`}
      />
    </span>
  );
}

/** Dif. de cambio con signo (para orden numérico gain/loss). */
function difCambioSigned(r: PagoHistorico): number {
  if (r.diferenciaCambiaria === null) return 0;
  const abs = Number(r.diferenciaCambiaria);
  return r.diferenciaCambiariaSigno === "loss" ? -abs : abs;
}

/** Columnas de identificación/referencia (mitad izquierda de la worklist). */
function buildColumnasIdentificacion(): ColumnDef<PagoHistorico, unknown>[] {
  return [
    {
      id: "fecha",
      accessorFn: (r) => new Date(r.fecha).getTime(),
      header: "Fecha",
      meta: { pinned: "left", width: 110, label: "Fecha" },
      cell: ({ row }) => <FechaCell row={row.original} />,
    },
    {
      id: "proveedor",
      accessorFn: (r) => r.proveedorNombre ?? "",
      header: "Proveedor",
      meta: { pinned: "left", width: 200, label: "Proveedor" },
      cell: ({ row }) => <ProveedorCell row={row.original} />,
    },
    {
      id: "facturas",
      header: "Factura / Ref",
      enableSorting: false,
      meta: { label: "Factura / Ref" },
      cell: ({ row }) => <FacturasCell row={row.original} />,
    },
    {
      accessorKey: "cuentaBancariaLabel",
      header: "Banco",
      meta: { width: 170, label: "Banco" },
      cell: ({ row }) => <span className="text-xs">{row.original.cuentaBancariaLabel}</span>,
    },
    {
      accessorKey: "metodo",
      header: "Método",
      meta: { width: 110, label: "Método" },
      cell: ({ row }) => <span className="text-xs">{row.original.metodo}</span>,
    },
  ];
}

/** Columnas monetarias/contables (mitad derecha de la worklist). */
function buildColumnasMonetarias(): ColumnDef<PagoHistorico, unknown>[] {
  return [
    {
      accessorKey: "moneda",
      header: () => <span className="block text-right">Moneda</span>,
      meta: { align: "right", width: 80, label: "Moneda" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-xs">{row.original.moneda}</span>
      ),
    },
    {
      id: "tipoCambio",
      accessorFn: (r) => Number(r.tipoCambio),
      header: () => <span className="block text-right">TC</span>,
      meta: { align: "right", width: 90, label: "TC" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-xs tabular-nums">
          {Number(row.original.tipoCambio).toFixed(2)}
        </span>
      ),
    },
    {
      id: "monto",
      accessorFn: (r) => Number(r.monto),
      header: () => <span className="block text-right">Monto</span>,
      meta: { align: "right", width: 130, label: "Monto" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMoney(row.original.monto)}
        </span>
      ),
    },
    {
      id: "montoArs",
      accessorFn: (r) => Number(r.montoArs),
      header: () => <span className="block text-right">ARS</span>,
      meta: { align: "right", width: 130, label: "ARS" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums text-muted-foreground">
          {fmtMoney(row.original.montoArs)}
        </span>
      ),
    },
    {
      id: "difCambio",
      accessorFn: (r) => difCambioSigned(r),
      header: () => <span className="block text-right">Dif. cambio</span>,
      meta: { align: "right", width: 120, label: "Dif. cambio" },
      cell: ({ row }) => <DifCambioCell row={row.original} />,
    },
    {
      id: "asiento",
      accessorFn: (r) => r.asientoNumero ?? 0,
      header: () => <span className="block text-right">Asiento</span>,
      meta: { align: "right", width: 100, label: "Asiento" },
      cell: ({ row }) => <AsientoCell row={row.original} />,
    },
  ];
}

export function buildPagosHistorialColumns(): ColumnDef<PagoHistorico, unknown>[] {
  return [...buildColumnasIdentificacion(), ...buildColumnasMonetarias()];
}
