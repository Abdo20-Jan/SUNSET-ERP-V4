"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de inventario
 * (INV-01 · PR-027). Espejo estructural de `fin-cxc-columns.tsx` (PR-026):
 * cada celda no trivial es un renderer nombrado de módulo (CCN baja — gate
 * Codacy) y el pinning va por `meta.pinned` (canon OD-04: Producto + SKU +
 * Depósito congeladas; TanStack agrupa las pinned a la izquierda, así que el
 * orden visual difiere del canon en Medida/Marca — documentado).
 *
 * Consume-or-omit (OD-04 pregunta 4): la columna "Costo prom." SÓLO se
 * construye con `verCosto` — sin permiso NO EXISTE (jamás "—"); el dato ya
 * llega `null` del servicio (el gate real es server-side, esto es reflejo).
 * Columnas del canon SIN backing model (Em conferência / Em trânsito de
 * transferencias / Bloqueado) se OMITEN — ver IMPLEMENTATION_NOTES_PR027.
 *
 * Read-only: sólo displays de la proyección; los tipos viajan `import type`
 * (el módulo server-only nunca entra al bundle client).
 */

import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { EntityLink } from "@/components/data-grid/entity-link";
import { SeverityBadge, type Severity } from "@/components/ui/severity-badge";
import { fmtDateOrDash, fmtInt, fmtMoney } from "@/lib/format";
import type { InventarioAlerta, InventarioWorklistRow } from "@/lib/services/inventario-worklist";

export type { InventarioWorklistRow };

const DASH = "—";

// Umbral del badge "sin movimiento" — espejo del server (duplicado
// deliberado, idioma BUCKET_* de la serie; el server es la fuente real).
const UMBRAL_SIN_MOVIMIENTO_UI = 90;

// Presentación de la alerta (labels duplicados deliberadamente del server —
// idioma de BUCKET_LABEL en la serie 025/026).
export const ALERTA_BADGE: Record<InventarioAlerta, { label: string; severity: Severity }> = {
  negativo: { label: "Negativo", severity: "critical" },
  bajo_minimo: { label: "Bajo mínimo", severity: "warning" },
  sin_movimiento: { label: "Sin movimiento", severity: "info" },
};

// Orden semántico de la alerta para el sort (no alfabético).
const ALERTA_RANK: Record<InventarioAlerta, number> = {
  negativo: 0,
  bajo_minimo: 1,
  sin_movimiento: 2,
};

function ProductoCell({ r }: { r: InventarioWorklistRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-xs font-medium" title={r.nombre}>
        {r.nombre}
      </span>
      {r.marca ? (
        <span className="truncate text-[11px] text-muted-foreground">{r.marca}</span>
      ) : null}
    </div>
  );
}

// Fila pipeline (sin SPD viva): "depósito" sintético, sin ficha navegable.
function DepositoCell({ r }: { r: InventarioWorklistRow }) {
  if (!r.depositoId) {
    return <span className="text-xs text-muted-foreground italic">{r.depositoNombre}</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <EntityLink
        label={r.depositoNombre}
        href={`/maestros/depositos/${r.depositoId}`}
        tabLabel={r.depositoNombre}
      />
      {r.depositoFiscal ? <SeverityBadge severity="neutral">Fiscal</SeverityBadge> : null}
    </div>
  );
}

// Cantidades: negativo = rojo (OD-04 Q&A funcional 1 — alerta máxima).
function CantidadCell({ value, muted = false }: { value: number; muted?: boolean }) {
  const tone =
    value < 0
      ? "text-red-700 dark:text-red-300 font-semibold"
      : muted
        ? "text-muted-foreground"
        : "";
  return <span className={`block text-right font-mono tabular-nums ${tone}`}>{fmtInt(value)}</span>;
}

function fiscalTooltip(r: InventarioWorklistRow): string {
  return r.fiscalBreakdown.map((b) => `${b.deposito}: ${fmtInt(b.cantidad)}`).join(" | ");
}

// "Em fiscal" separado del Disponible (OD-04 pregunta 6) — hover breakdown
// por depósito fiscal ("Fiscal TP: 200 | Fiscal X: 100").
function EnFiscalCell({ r }: { r: InventarioWorklistRow }) {
  if (r.enFiscal === 0 && r.fiscalBreakdown.length === 0) {
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  }
  return (
    <span
      className="block text-right font-mono tabular-nums underline decoration-dotted underline-offset-2"
      title={fiscalTooltip(r)}
    >
      {fmtInt(r.enFiscal)}
    </span>
  );
}

/** Unidades del pipeline fuera del corte de 90d (no entran a la columna). */
function fueraDeCorte(r: InventarioWorklistRow): number {
  const f = r.futuroComex;
  return f.enTransitoTotal + f.enProduccionTotal - f.total;
}

export function futuroComexTooltip(r: InventarioWorklistRow): string {
  const base = `En producción: ${fmtInt(r.futuroComex.enProduccion)} | En tránsito: ${fmtInt(r.futuroComex.enTransito)}`;
  const fuera = fueraDeCorte(r);
  return fuera > 0 ? `${base} | Fuera de 90d: ${fmtInt(fuera)}` : base;
}

// Futuro Comex ETA≤90d con badge "F" + breakdown en hover (OD-04 pregunta 5;
// "Embarcado" no es separable del modelo → 2 buckets). Pipeline íntegramente
// más allá de 90d: se señala en gris (la fila puede existir sólo por él).
function FuturoComexCell({ r }: { r: InventarioWorklistRow }) {
  if (r.futuroComex.total === 0 && fueraDeCorte(r) > 0) {
    return (
      <span
        className="block text-right text-xs text-muted-foreground"
        title={futuroComexTooltip(r)}
      >
        +{fmtInt(fueraDeCorte(r))} &gt;90d
      </span>
    );
  }
  if (r.futuroComex.total === 0) {
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="flex items-center justify-end gap-1" title={futuroComexTooltip(r)}>
      <SeverityBadge severity="info">F</SeverityBadge>
      <span className="font-mono tabular-nums">{fmtInt(r.futuroComex.total)}</span>
    </span>
  );
}

function DespachosCell({ r }: { r: InventarioWorklistRow }) {
  if (r.despachosActivos === 0) {
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="block text-right font-mono tabular-nums">{fmtInt(r.despachosActivos)}</span>
  );
}

function AlertaCell({ r }: { r: InventarioWorklistRow }) {
  if (!r.alerta) return null;
  const badge = ALERTA_BADGE[r.alerta];
  return <SeverityBadge severity={badge.severity}>{badge.label}</SeverityBadge>;
}

function CostoCell({ r }: { r: InventarioWorklistRow }) {
  if (r.costoPromedio === null) {
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="block text-right font-mono tabular-nums">{fmtMoney(r.costoPromedio)}</span>
  );
}

/**
 * TODAS las alertas activas de la fila (no sólo la de mayor severidad que
 * guarda `r.alerta`): la mini-ficha promete "alertas activas", así que
 * "sin movimiento" se re-deriva de los días crudos y no del ladder.
 */
function alertasActivas(r: InventarioWorklistRow): InventarioAlerta[] {
  return [
    ...(r.fisico < 0 || r.disponible < 0 ? (["negativo"] as const) : []),
    ...(r.bajoMinimo ? (["bajo_minimo"] as const) : []),
    ...(r.sinMovimientoDias >= UMBRAL_SIN_MOVIMIENTO_UI ? (["sin_movimiento"] as const) : []),
  ];
}

function AlertasBloque({ r }: { r: InventarioWorklistRow }) {
  const alertas = alertasActivas(r);
  if (alertas.length === 0) {
    return <span className="text-muted-foreground">Sin alertas</span>;
  }
  return (
    <span className="flex gap-1">
      {alertas.map((a) => (
        <SeverityBadge key={a} severity={ALERTA_BADGE[a].severity}>
          {ALERTA_BADGE[a].label}
        </SeverityBadge>
      ))}
    </span>
  );
}

function FiscalBloque({ r }: { r: InventarioWorklistRow }) {
  if (r.fiscalBreakdown.length === 0) return null;
  return (
    <ExpandBloque titulo="En fiscal">
      <span className="font-mono tabular-nums">{fiscalTooltip(r)}</span>
    </ExpandBloque>
  );
}

function FuturoBloque({ r }: { r: InventarioWorklistRow }) {
  if (r.futuroComex.total === 0 && fueraDeCorte(r) === 0) return null;
  return (
    <ExpandBloque titulo="Futuro Comex (ETA ≤ 90d)">
      <span className="font-mono tabular-nums">{futuroComexTooltip(r)}</span>
    </ExpandBloque>
  );
}

function CostoBloque({ r, verCosto }: { r: InventarioWorklistRow; verCosto: boolean }) {
  if (!verCosto || r.costoPromedio === null) return null;
  return (
    <ExpandBloque titulo="Costo promedio (almacenado)">
      <span className="font-mono font-semibold tabular-nums">{fmtMoney(r.costoPromedio)}</span>
    </ExpandBloque>
  );
}

function UltimoMovimientoBloque({ r }: { r: InventarioWorklistRow }) {
  if (r.ultimoMovimiento === null) return null;
  return (
    <ExpandBloque titulo="Último movimiento">
      <span className="font-mono tabular-nums">
        {r.ultimoMovimiento.slice(0, 10)} ({fmtInt(r.sinMovimientoDias)}d)
      </span>
    </ExpandBloque>
  );
}

/**
 * Mini-ficha del drill-down (`renderExpanded`): alertas activas, breakdowns
 * fiscal / futuro comex y — SÓLO con permiso — el costo promedio almacenado.
 * "Último despacho consumido" del canon no tiene modelo vivo (D1-bis) → omitido.
 * Compuesta de sub-bloques nombrados (gate Codacy CCN ≤ 8).
 */
export function InventarioFilaExpand({
  r,
  verCosto,
}: {
  r: InventarioWorklistRow;
  verCosto: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-xs">
      <ExpandBloque titulo="Alertas">
        <AlertasBloque r={r} />
      </ExpandBloque>
      <ExpandBloque titulo="Producto (todos los depósitos)">
        <span className="font-mono tabular-nums">
          Nacional: {fmtInt(r.totalFisicoNacional)}
          {r.stockMinimo > 0 ? ` · Mínimo: ${fmtInt(r.stockMinimo)}` : ""}
        </span>
      </ExpandBloque>
      <FiscalBloque r={r} />
      <FuturoBloque r={r} />
      <CostoBloque r={r} verCosto={verCosto} />
      <UltimoMovimientoBloque r={r} />
    </div>
  );
}

function ExpandBloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{titulo}</span>
      {children}
    </div>
  );
}

export function buildInventarioColumns({
  verCosto,
}: {
  verCosto: boolean;
}): ColumnDef<InventarioWorklistRow, unknown>[] {
  const base: ColumnDef<InventarioWorklistRow, unknown>[] = [
    {
      id: "producto",
      accessorFn: (r) => r.nombre,
      header: "Producto",
      meta: { pinned: "left", width: 210, label: "Producto" },
      cell: ({ row }) => <ProductoCell r={row.original} />,
    },
    {
      id: "sku",
      accessorFn: (r) => r.codigo,
      header: "SKU",
      meta: { pinned: "left", width: 110, label: "SKU" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.codigo}</span>,
    },
    {
      id: "deposito",
      accessorFn: (r) => r.depositoNombre,
      header: "Depósito",
      meta: { pinned: "left", width: 170, label: "Depósito" },
      cell: ({ row }) => <DepositoCell r={row.original} />,
    },
    {
      id: "medida",
      accessorFn: (r) => r.medida ?? "",
      header: "Medida",
      meta: { width: 110, label: "Medida" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.medida ?? DASH}</span>,
    },
    {
      id: "marca",
      accessorFn: (r) => r.marca ?? "",
      header: "Marca",
      meta: { width: 100, label: "Marca" },
      cell: ({ row }) => <span className="text-xs">{row.original.marca ?? DASH}</span>,
    },
    {
      id: "fisico",
      accessorFn: (r) => r.fisico,
      header: () => <span className="block text-right">Físico</span>,
      meta: { align: "right", width: 90, label: "Físico" },
      cell: ({ row }) => <CantidadCell value={row.original.fisico} />,
    },
    {
      id: "disponible",
      accessorFn: (r) => r.disponible,
      header: () => <span className="block text-right">Disponible</span>,
      meta: { align: "right", width: 100, label: "Disponible" },
      cell: ({ row }) => <CantidadCell value={row.original.disponible} />,
    },
    {
      id: "reservado",
      accessorFn: (r) => r.reservado,
      header: () => <span className="block text-right">Reservado</span>,
      meta: { align: "right", width: 95, label: "Reservado" },
      cell: ({ row }) => <CantidadCell value={row.original.reservado} muted />,
    },
    {
      id: "enFiscal",
      accessorFn: (r) => r.enFiscal,
      header: () => <span className="block text-right">En fiscal</span>,
      meta: { align: "right", width: 95, label: "En fiscal" },
      cell: ({ row }) => <EnFiscalCell r={row.original} />,
    },
    {
      id: "futuroComex",
      accessorFn: (r) => r.futuroComex.total,
      header: () => <span className="block text-right">Futuro Comex</span>,
      meta: { align: "right", width: 120, label: "Futuro Comex" },
      cell: ({ row }) => <FuturoComexCell r={row.original} />,
    },
    {
      id: "despachos",
      accessorFn: (r) => r.despachosActivos,
      header: () => <span className="block text-right">Despachos act.</span>,
      meta: { align: "right", width: 105, label: "Despachos activos" },
      cell: ({ row }) => <DespachosCell r={row.original} />,
    },
    {
      id: "ultimoMovimiento",
      // `undefined` + sortUndefined:"last" fija las filas pipeline (sin
      // movimiento propio) al final en asc y desc.
      accessorFn: (r) => r.ultimoMovimiento ?? undefined,
      sortUndefined: "last",
      header: "Últ. movimiento",
      meta: { width: 120, label: "Último movimiento" },
      // Fecha NEUTRA (no DateBadge: su semántica de vencimiento pintaría toda
      // fecha pasada de rojo "overdue"); la señal de inactividad es el badge
      // de alerta "Sin movimiento" (≥ 90d).
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">
          {fmtDateOrDash(row.original.ultimoMovimiento)}
        </span>
      ),
    },
    {
      id: "alerta",
      accessorFn: (r) => (r.alerta ? ALERTA_RANK[r.alerta] : 3),
      header: "Alerta",
      meta: { width: 120, label: "Alerta" },
      cell: ({ row }) => <AlertaCell r={row.original} />,
    },
  ];
  if (!verCosto) return base;
  return [
    ...base,
    {
      id: "costo",
      accessorFn: (r) => Number(r.costoPromedio ?? 0),
      header: () => <span className="block text-right">Costo prom.</span>,
      meta: { align: "right", width: 115, label: "Costo promedio" },
      cell: ({ row }) => <CostoCell r={row.original} />,
    },
  ];
}
