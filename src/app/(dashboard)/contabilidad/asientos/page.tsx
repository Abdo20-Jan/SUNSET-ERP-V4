import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listarAsientosWorklist } from "@/lib/services/asientos-worklist";

import {
  ASIENTOS_VISTAS,
  type AsientosVista,
  type PeriodoOption,
  resolverAsientosVista,
  resolverPeriodoDefault,
} from "./asientos-presentacion";
import { AsientosWorklist } from "./asientos-worklist";
import { MoverPeriodoLink, PeriodoCuentaFilters } from "./periodo-cuenta-filters";

/*
 * Worklist canónica de asientos (CONT-01 · PR-028, OD-07). Sustituye la tabla
 * legada (`asientos-table.tsx` + `asiento-detalle-sheet.tsx`, conservadas en
 * árbol NO importadas = rollback) por EnterpriseDataGrid + FloatingWorkWindow.
 *
 * Filtrado server-driven por URL (lección PR-010): `?vista=` (presets
 * oficiales) · `?periodo=<id>|todos` (filtro principal — default: el período
 * que contiene hoy) · `?cuentaId=` (asientos que tocan la cuenta) ·
 * `?desde/?hasta` (refinamiento opcional por fecha). Migración de params
 * legados: `estado`→vista `anulados`/chip client · `q`→quickSearch client ·
 * `page/perPage`→paginación del grid (sin deep-links externos — degradan a
 * "todos").
 */

const ESTADO_LEGADO_A_VISTA: Record<string, AsientosVista> = {
  ANULADO: "anulados",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type SearchParams = Promise<{
  vista?: string;
  periodo?: string;
  cuentaId?: string;
  desde?: string;
  hasta?: string;
  /** Param legado (pre-PR-028) — degrada a la vista equivalente. */
  estado?: string;
}>;

export const dynamic = "force-dynamic";

const BASE_HREF = "/contabilidad/asientos";

function buildHref(
  vista: AsientosVista,
  params: { periodo?: string; cuentaId?: string; desde?: string; hasta?: string },
): string {
  const qp = new URLSearchParams();
  if (vista !== "todos") qp.set("vista", vista);
  if (params.periodo) qp.set("periodo", params.periodo);
  if (params.cuentaId) qp.set("cuentaId", params.cuentaId);
  if (params.desde) qp.set("desde", params.desde);
  if (params.hasta) qp.set("hasta", params.hasta);
  const qs = qp.toString();
  return qs ? `${BASE_HREF}?${qs}` : BASE_HREF;
}

function resolverVistaConLegado(params: { vista?: string; estado?: string }): AsientosVista {
  const vista = resolverAsientosVista(params.vista);
  if (vista !== "todos") return vista;
  if (params.estado && ESTADO_LEGADO_A_VISTA[params.estado]) {
    return ESTADO_LEGADO_A_VISTA[params.estado];
  }
  return vista;
}

export default async function AsientosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const [periodosDb, cuentas] = await Promise.all([
    db.periodoContable.findMany({
      orderBy: { fechaInicio: "desc" },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        estado: true,
        fechaInicio: true,
        fechaFin: true,
      },
    }),
    db.cuentaContable.findMany({
      where: { tipo: "ANALITICA", activa: true },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
  ]);

  const periodos: PeriodoOption[] = periodosDb.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    estado: p.estado,
    fechaInicio: p.fechaInicio.toISOString(),
    fechaFin: p.fechaFin.toISOString(),
  }));

  const vista = resolverVistaConLegado(params);

  // Período: `todos` explícito → sin filtro; id válido → ese; ausente/ inválido
  // → default (el período que contiene hoy — el contador trabaja mes a mes).
  let periodoSel: number | "todos";
  const periodoParam = parseId(params.periodo);
  if (params.periodo === "todos") {
    periodoSel = "todos";
  } else if (periodoParam !== undefined && periodos.some((p) => p.id === periodoParam)) {
    periodoSel = periodoParam;
  } else {
    periodoSel = resolverPeriodoDefault(periodos, todayIso())?.id ?? "todos";
  }

  const cuentaId = parseId(params.cuentaId);
  const fechaDesde = parseDate(params.desde);
  const fechaHasta = endOfDay(params.hasta);

  const { rows, total, truncado, kpis } = await listarAsientosWorklist({
    vista,
    periodoId: periodoSel === "todos" ? undefined : periodoSel,
    cuentaId,
    fechaDesde,
    fechaHasta,
  });

  const periodoActivo = periodoSel === "todos" ? null : periodos.find((p) => p.id === periodoSel);
  const rangoLabel = periodoActivo ? `período ${periodoActivo.codigo}` : "todos los períodos";

  const hrefParams = {
    periodo: params.periodo,
    cuentaId: params.cuentaId,
    desde: params.desde,
    hasta: params.hasta,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Asientos</h1>
          <p className="text-sm text-muted-foreground">
            {total} asiento{total === 1 ? "" : "s"} · {rangoLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ASIENTOS_VISTAS.map((v) => (
            <Link
              key={v.id}
              href={buildHref(v.id, hrefParams)}
              className={buttonVariants({
                variant: vista === v.id ? "default" : "outline",
                size: "sm",
              })}
            >
              {v.label}
            </Link>
          ))}
          <MoverPeriodoLink />
          <Link
            href="/contabilidad/asientos/nuevo"
            className={buttonVariants({ variant: "default" })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo asiento
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Borradores" value={kpis.borradores} />
        <KpiCard label="Contabilizados" value={kpis.contabilizados} />
        <KpiCard label="Anulados" value={kpis.anulados} />
      </div>

      <PeriodoCuentaFilters
        periodos={periodos}
        selectedPeriodoId={periodoSel}
        cuentas={cuentas}
        selectedCuentaId={cuentaId ?? null}
      />

      {truncado && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Mostrando los primeros {rows.length} asientos de {total} — refiná el período o los filtros
          para ver el resto. La exportación espeja este mismo corte.
        </p>
      )}

      <AsientosWorklist
        rows={rows}
        emptyMessage={
          vista === "todos"
            ? "No hay asientos para el período seleccionado."
            : "No hay asientos para la vista seleccionada."
        }
      />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
