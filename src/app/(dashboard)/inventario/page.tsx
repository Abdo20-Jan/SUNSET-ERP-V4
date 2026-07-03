import Link from "next/link";
import { Alert02Icon, Building03Icon, PackageIcon } from "@hugeicons/core-free-icons";

import { buttonVariants } from "@/components/ui/button";
import { fmtInt } from "@/lib/format";
import { puedeVerCostoStock } from "@/lib/permisos-masking";
import {
  DIAS_SIN_MOVIMIENTO,
  filtrarPorVista,
  type InventarioVista,
  type InventarioWorklistRow,
  listarInventarioWorklist,
  ordenarPorDeposito,
  resolverDias,
  resolverVista,
} from "@/lib/services/inventario-worklist";

import { KpiCard } from "../dashboard/_components/kpi-card";
import { InventarioWorklist } from "./_components/inventario-worklist";

type SearchParams = Promise<{ vista?: string; agrupar?: string; dias?: string }>;

export const dynamic = "force-dynamic";

const BASE_HREF = "/inventario";

// Sub-vistas oficiales data-backed (presets de URL server-side — lección
// PR-010). [Divergencias]/[Bloqueado]/[Reservado] del OD-04 no tienen backing
// model → omitidas (IMPLEMENTATION_NOTES_PR027).
const VISTAS: Array<{ id: InventarioVista; label: string }> = [
  { id: "todas", label: "Todas" },
  { id: "bajo-minimo", label: "Bajo mínimo" },
  { id: "negativos", label: "Negativos" },
  { id: "en-transito", label: "En tránsito" },
  { id: "en-fiscal", label: "En fiscal" },
  { id: "futuro-comex", label: "Futuro Comex" },
  { id: "sin-movimiento", label: "Sin movimiento" },
];

function buildHref(vista: InventarioVista, agrupar: boolean, dias: number): string {
  const qp = new URLSearchParams();
  if (vista !== "todas") qp.set("vista", vista);
  if (agrupar) qp.set("agrupar", "deposito");
  if (vista === "sin-movimiento" && dias !== 90) qp.set("dias", String(dias));
  const qs = qp.toString();
  return qs ? `${BASE_HREF}?${qs}` : BASE_HREF;
}

// KPIs mínimos del módulo operativo (G-08): conteos/sumas sobre TODAS las
// filas (la vista filtra sólo el grid, espejo fin-cxc). Sin `stockActual`:
// el Σ físico es la suma de TODOS los depósitos (semántica documentada).
function kpisInventario(rows: InventarioWorklistRow[]) {
  const productos = new Set(rows.map((r) => r.productoId));
  const bajoMinimo = new Set(rows.flatMap((r) => (r.bajoMinimo ? [r.productoId] : [])));
  return {
    fisicoTotal: rows.reduce((acc, r) => acc + r.fisico, 0),
    productos: productos.size,
    negativos: rows.filter((r) => r.fisico < 0 || r.disponible < 0).length,
    bajoMinimo: bajoMinimo.size,
  };
}

export default async function InventarioPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // Gate de costo PRE-resuelto (PR-011): la proyección excluye la query de
  // valorización sin la clave — el número no sale del SQL y la columna del
  // grid ni se construye. Cantidades/alertas visibles a toda sesión (espejo
  // de la página actual — sin permiso de acceso propio).
  const verCosto = await puedeVerCostoStock();
  const { rows } = await listarInventarioWorklist(verCosto);

  const vista = resolverVista(params.vista);
  const dias = resolverDias(params.dias);
  const agrupar = params.agrupar === "deposito";

  // `?agrupar=deposito` es SÓLO presentación (el grid no tiene grouping):
  // mismas filas contiguas por depósito — mismo multiset, mismos totales
  // (trabado por test). Default: producto-céntrico (codigo, depósito).
  const base = agrupar ? ordenarPorDeposito(rows) : rows;
  const rowsVista = filtrarPorVista(base, vista, dias);

  const kpis = kpisInventario(rows);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Inventario · Stock general</h1>
          <p className="text-sm text-muted-foreground">
            Una fila por producto × depósito (fuente: stock por depósito). Los movimientos entre
            depósitos viven en{" "}
            <Link href="/inventario/transferencias" className="underline underline-offset-2">
              Transferencias
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {VISTAS.map((v) => (
            <Link
              key={v.id}
              href={buildHref(v.id, agrupar, dias)}
              className={buttonVariants({
                variant: vista === v.id ? "default" : "outline",
                size: "sm",
              })}
            >
              {v.label}
            </Link>
          ))}
          <Link
            href={buildHref(vista, !agrupar, dias)}
            className={buttonVariants({ variant: agrupar ? "default" : "outline", size: "sm" })}
          >
            Por depósito
          </Link>
          <Link
            href="/inventario/transferencias"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Transferencias
          </Link>
        </div>
      </div>

      {vista === "sin-movimiento" ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Sin movimiento hace</span>
          {DIAS_SIN_MOVIMIENTO.map((d) => (
            <Link
              key={d}
              href={buildHrefDias(agrupar, d)}
              className={buttonVariants({
                variant: dias === d ? "default" : "outline",
                size: "sm",
              })}
            >
              {d}d
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Σ físico"
          value={fmtInt(kpis.fisicoTotal)}
          icon={PackageIcon}
          accent="info"
          hint="Unidades en todos los depósitos"
        />
        <KpiCard
          label="Productos"
          value={fmtInt(kpis.productos)}
          icon={Building03Icon}
          accent="neutral"
          hint="SKUs con stock o pipeline comex"
        />
        <KpiCard
          label="Negativos"
          value={fmtInt(kpis.negativos)}
          icon={Alert02Icon}
          accent={kpis.negativos > 0 ? "negative" : "neutral"}
          hint="Posiciones con físico o disponible < 0"
        />
        <KpiCard
          label="Bajo mínimo"
          value={fmtInt(kpis.bajoMinimo)}
          icon={Alert02Icon}
          accent={kpis.bajoMinimo > 0 ? "warning" : "neutral"}
          hint="Productos bajo su stock mínimo"
        />
      </div>

      <InventarioWorklist
        rows={rowsVista}
        verCosto={verCosto}
        emptyMessage={
          vista === "todas"
            ? "Sin posiciones de stock."
            : "Ninguna posición para la vista seleccionada."
        }
      />
    </div>
  );
}

function buildHrefDias(agrupar: boolean, dias: number): string {
  return buildHref("sin-movimiento", agrupar, dias);
}
