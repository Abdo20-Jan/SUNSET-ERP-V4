"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de gestión de cuentas a
 * pagar (FIN-02 · PR-026). Espejo estructural de
 * `cuentas-a-cobrar-columns.tsx` (PR-025c): cada celda no trivial es un
 * renderer nombrado de módulo (CCN baja — gate Codacy) y el pinning va por
 * `meta.pinned` (canon OD-06: proveedor + documento + estado congelados).
 *
 * Read-only: los displays son native-first (`fmtMontoPres` sobre
 * `montoNativo` — lección #262/#263); "Estado" es DERIVADO del bucket del
 * motor (los 10 estados de la spec no tienen backing model — FIN-03/FIN-04).
 * `ORIGEN_LABEL`/`ORIGEN_BADGE` se REUSAN de `pago-por-factura.tsx` (los
 * símbolos module-scope que 025b-2 exportó para compartir). El único CTA es
 * el Link "Pagar" al flujo EXISTENTE (URL verbatim 025b — `pagarHref`).
 *
 * Deuda heredada documentada (025b/c): el sort-key de la columna monetaria es
 * el agregado ARS del servicio (`Number(monto)`, TC de emisión) mientras el
 * display es native-first al TC de cierre — en multimoneda el orden puede
 * divergir del exhibido (corregir junto con las páginas 025, no acá).
 */

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";

import { fmtMontoPres } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DateBadge } from "@/components/ui/date-badge";
import { EntityLink } from "@/components/data-grid/entity-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  ORIGEN_BADGE,
  ORIGEN_LABEL,
} from "../../tesoreria/cuentas-a-pagar/_components/pago-por-factura";
import {
  BUCKET_CLASS,
  BUCKET_LABEL,
  type FacturaPendiente,
  type FacturaPendienteFlatRow,
  pagarHref,
  type SaldoProveedorAging,
} from "./fin-cxp-presentacion";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

export type { FacturaPendienteFlatRow };

const DASH = "—";

// Orden semántico del bucket para el sort de la columna Estado (no alfabético).
const BUCKET_RANK: Record<FacturaPendiente["bucket"], number> = {
  vencida: 0,
  proxima: 1,
  al_dia: 2,
  sin_fecha: 3,
};

function ProveedorCell({ f }: { f: FacturaPendienteFlatRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <EntityLink
        label={f.proveedorNombre}
        href={`/maestros/proveedores/${f.proveedor.proveedorId}`}
        tabLabel={f.proveedorNombre}
      />
      {f.cuit && <span className="text-xs text-muted-foreground">CUIT {f.cuit}</span>}
    </div>
  );
}

/**
 * Link al documento de origen: compra/gasto tienen ficha propia; el costo de
 * embarque NO expone `embarqueId` en el DTO (sólo `referencia` textual) —
 * sin link honesto posible (FIN-02 no extiende el servicio; consume-or-omit).
 */
function DocumentoLink({ f }: { f: Pick<FacturaPendiente, "origen" | "id" | "numero"> }) {
  if (f.origen === "compra") {
    return <EntityLink label={f.numero} href={`/compras/${f.id}`} tabLabel={f.numero} />;
  }
  if (f.origen === "gasto") {
    return <EntityLink label={f.numero} href={`/gastos/${f.id}`} tabLabel={f.numero} />;
  }
  return <span className="font-mono text-xs">{f.numero}</span>;
}

function OrigenCell({ f }: { f: Pick<FacturaPendiente, "origen"> }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] uppercase tracking-wide"
      title={ORIGEN_LABEL[f.origen]}
    >
      {ORIGEN_BADGE[f.origen]}
    </Badge>
  );
}

function EstadoCell({ f }: { f: Pick<FacturaPendiente, "bucket"> }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${BUCKET_CLASS[f.bucket]}`}
    >
      {BUCKET_LABEL[f.bucket]}
    </span>
  );
}

// Días de atraso (canon OD-06: ámbar 1–15, rojo > 15). Sólo presentación —
// `diasParaVencer` viene clasificado del motor (negativo = vencida hace N).
function DiasAtrasoCell({ f }: { f: Pick<FacturaPendiente, "diasParaVencer"> }) {
  if (f.diasParaVencer === null || f.diasParaVencer >= 0) {
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  }
  const atraso = -f.diasParaVencer;
  const tone =
    atraso > 15 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300";
  return (
    <span className={`block text-right font-mono tabular-nums ${tone}`}>
      {atraso} {atraso === 1 ? "día" : "días"}
    </span>
  );
}

function SaldoCell({
  f,
  moneda,
  tc,
}: {
  f: FacturaPendienteFlatRow;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <span className="block text-right font-mono font-semibold tabular-nums">
      {fmtMontoPres(f.montoNativo, f.moneda as Moneda, moneda, tc)}
    </span>
  );
}

function PagarCell({ f }: { f: FacturaPendienteFlatRow }) {
  return (
    <span className="flex justify-end">
      <Link
        href={pagarHref(f.proveedor)}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Pagar
        <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
      </Link>
    </span>
  );
}

function FacturaProveedorRowView({
  f,
  moneda,
  tc,
}: {
  f: FacturaPendiente;
  moneda: Moneda;
  tc: string | null;
}) {
  const fechaVenc = f.fechaVencimiento ? new Date(f.fechaVencimiento) : null;
  const fecha = new Date(f.fecha);
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <DocumentoLink f={f} />
      </TableCell>
      <TableCell>
        <OrigenCell f={f} />
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {f.referencia ?? DASH}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {fecha.toLocaleDateString("es-AR", { timeZone: "UTC" })}
      </TableCell>
      <TableCell>
        <DateBadge fecha={fechaVenc} />
      </TableCell>
      <TableCell>
        <EstadoCell f={f} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {fmtMontoPres(f.montoNativo, f.moneda as Moneda, moneda, tc)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Drill-down `renderExpanded` del grid: TODOS los pendientes del MISMO
 * proveedor (contexto de programación), desde el padre ya anidado en la fila
 * — cero queries nuevas. Los recibos/pagos parciales del canon NO están en el
 * DTO (el motor los reconstruye internamente) — FIN-03, no se fabrican.
 */
export function FacturasProveedorTable({
  f,
  moneda,
  tc,
}: {
  f: FacturaPendienteFlatRow;
  moneda: Moneda;
  tc: string | null;
}) {
  const p: SaldoProveedorAging = f.proveedor;
  if (p.facturas.length === 0) {
    return <span className="px-2 text-xs text-muted-foreground">Sin facturas pendientes.</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="px-2 text-xs text-muted-foreground">
        Pendientes de {p.proveedorNombre} ({p.facturas.length})
      </span>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">Documento</TableHead>
            <TableHead className="w-20">Origen</TableHead>
            <TableHead className="w-32">Referencia</TableHead>
            <TableHead className="w-28">Fecha</TableHead>
            <TableHead className="w-32">Vencimiento</TableHead>
            <TableHead className="w-24">Estado</TableHead>
            <TableHead className="text-right">Pendiente</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.facturas.map((doc) => (
            <FacturaProveedorRowView
              key={`${doc.origen}-${doc.id}`}
              f={doc}
              moneda={moneda}
              tc={tc}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function buildFinCxpColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<FacturaPendienteFlatRow, unknown>[] {
  return [
    {
      id: "proveedor",
      accessorFn: (r) => r.proveedorNombre,
      header: "Proveedor",
      meta: { pinned: "left", width: 200, label: "Proveedor" },
      cell: ({ row }) => <ProveedorCell f={row.original} />,
    },
    {
      id: "documento",
      accessorFn: (r) => r.numero,
      header: "Documento",
      meta: { pinned: "left", width: 150, label: "Documento" },
      cell: ({ row }) => <DocumentoLink f={row.original} />,
    },
    {
      id: "estado",
      accessorFn: (r) => BUCKET_RANK[r.bucket],
      header: "Estado",
      meta: { pinned: "left", width: 100, label: "Estado" },
      cell: ({ row }) => <EstadoCell f={row.original} />,
    },
    {
      id: "origen",
      accessorFn: (r) => r.origen,
      header: "Origen",
      meta: { width: 90, label: "Origen" },
      cell: ({ row }) => <OrigenCell f={row.original} />,
    },
    {
      id: "referencia",
      accessorFn: (r) => r.referencia ?? "",
      header: "Referencia",
      meta: { width: 130, label: "Referencia" },
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.referencia ?? DASH}
        </span>
      ),
    },
    {
      id: "vencimiento",
      // `undefined` + sortUndefined:"last" fija sin-fecha AL FINAL en asc y
      // desc (convención de porUrgencia; "" ordenaría antes de todo ISO).
      accessorFn: (r) => r.fechaVencimiento ?? undefined,
      sortUndefined: "last",
      header: "Vencimiento",
      meta: { width: 120, label: "Vencimiento" },
      cell: ({ row }) => (
        <DateBadge
          fecha={row.original.fechaVencimiento ? new Date(row.original.fechaVencimiento) : null}
        />
      ),
    },
    {
      id: "diasAtraso",
      accessorFn: (r) =>
        r.diasParaVencer !== null && r.diasParaVencer < 0 ? -r.diasParaVencer : 0,
      header: () => <span className="block text-right">Días atraso</span>,
      meta: { align: "right", width: 100, label: "Días atraso" },
      cell: ({ row }) => <DiasAtrasoCell f={row.original} />,
    },
    {
      id: "moneda",
      accessorFn: (r) => r.moneda,
      header: "Moneda",
      meta: { width: 80, label: "Moneda" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.moneda}</span>,
    },
    {
      id: "saldo",
      accessorFn: (r) => Number(r.monto),
      header: () => <span className="block text-right">Saldo ({moneda})</span>,
      meta: { align: "right", width: 140, label: "Saldo" },
      cell: ({ row }) => <SaldoCell f={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "acciones",
      enableSorting: false,
      header: () => <span className="sr-only">Acciones</span>,
      meta: { align: "right", width: 110, label: "Acciones" },
      cell: ({ row }) => <PagarCell f={row.original} />,
    },
  ];
}
