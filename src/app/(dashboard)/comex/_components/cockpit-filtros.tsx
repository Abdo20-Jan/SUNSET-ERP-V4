"use client";

/**
 * Barra de filtros + saved-views del Cockpit Operacional Comex (PR-022b / CX-01).
 *
 * 100% READ-ONLY: cada control escribe en la URL (`?vista` / `?proveedor` /
 * `?eta_desde` / `?eta_hasta` / `?estado`) → el server component (page) re-consulta
 * y re-deriva. NO muta, NO exporta, NO toca el motor. Espelha el patrón de
 * `embarques-views-bar` (PR-020). Sin estado de servidor, sin `useEffect`/refs.
 *
 * Modelo: los presets (tabs) y los filtros explícitos Status/ETA son mutuamente
 * excluyentes (elegir uno limpia el otro); Proveedor es ortogonal (se preserva).
 * El preset `Pagos próximos` sólo se ofrece con `VER_COSTO_LANDED`.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COCKPIT_VISTAS,
  type ProveedorOpcion,
  STATUS_FILTRO_OPCIONES,
} from "@/lib/services/comex-cockpit-filtros";
import type { EmbarqueEstado } from "@/generated/prisma/client";

import { CockpitBuscaRapida } from "./cockpit-busca-rapida";
import { CockpitUltimaVista } from "./cockpit-ultima-vista";

type Patch = Record<string, string | null>;
const TODOS = "all";

const ESTADO_LABEL: Record<EmbarqueEstado, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  EN_PUERTO: "En puerto",
  EN_ZONA_PRIMARIA: "Zona primaria",
  EN_ADUANA: "En aduana",
  DESPACHADO: "Despachado",
  EN_DEPOSITO: "En depósito",
  CERRADO: "Cerrado",
};

const FILTRO_KEYS = ["vista", "proveedor", "eta_desde", "eta_hasta", "estado"] as const;

// Helper PURO de módulo — mantiene baja la complejidad del componente.
function construirQuery(current: URLSearchParams, patch: Patch): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next.toString();
}

export function CockpitFiltros({
  proveedorOpciones,
  verCosto,
}: {
  proveedorOpciones: ProveedorOpcion[];
  verCosto: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();

  const vistaActiva = searchParams.get("vista") ?? "todos";
  const proveedorActivo = searchParams.get("proveedor") ?? TODOS;
  const estadoActivo = searchParams.get("estado") ?? TODOS;
  const etaDesde = searchParams.get("eta_desde") ?? "";
  const etaHasta = searchParams.get("eta_hasta") ?? "";

  const updateUrl = (patch: Patch) => {
    const qs = construirQuery(searchParams, patch);
    startNav(() => router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname));
  };

  // Preset define el slice operativo → limpia Status/ETA explícitos; preserva Proveedor.
  const aplicarVista = (id: string) =>
    updateUrl({
      vista: id === "todos" ? null : id,
      estado: null,
      eta_desde: null,
      eta_hasta: null,
    });

  // Status/ETA explícitos → limpian el preset (vista=todos); Proveedor es ortogonal.
  const aplicarEstado = (v: string | null) =>
    updateUrl({ estado: v && v !== TODOS ? v : null, vista: null });
  const aplicarEta = (patch: Patch) => updateUrl({ ...patch, vista: null });
  const limpiar = () =>
    updateUrl({ vista: null, proveedor: null, eta_desde: null, eta_hasta: null, estado: null });

  const vistas = COCKPIT_VISTAS.filter((v) => !v.requierePermiso || verCosto);
  const hayFiltros = FILTRO_KEYS.some((k) => searchParams.get(k) != null);

  return (
    <div className="flex flex-col gap-2.5 rounded-md border bg-card p-3">
      <CockpitUltimaVista />
      <div className="flex flex-wrap items-center gap-1">
        {vistas.map((v) => (
          <Button
            key={v.id}
            variant={vistaActiva === v.id ? "default" : "outline"}
            size="sm"
            onClick={() => aplicarVista(v.id)}
          >
            {v.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CockpitBuscaRapida />
        <Select
          value={proveedorActivo}
          onValueChange={(v) => updateUrl({ proveedor: v === TODOS ? null : v })}
        >
          <SelectTrigger size="sm" className="w-auto min-w-44">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Proveedor: todos</SelectItem>
            {proveedorOpciones.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">ETA</span>
          <Input
            type="date"
            aria-label="ETA desde"
            value={etaDesde}
            onChange={(e) => aplicarEta({ eta_desde: e.target.value || null })}
            className="h-8 w-auto"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="ETA hasta"
            value={etaHasta}
            onChange={(e) => aplicarEta({ eta_hasta: e.target.value || null })}
            className="h-8 w-auto"
          />
        </div>

        <Select value={estadoActivo} onValueChange={aplicarEstado}>
          <SelectTrigger size="sm" className="w-auto min-w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Status: todos</SelectItem>
            {STATUS_FILTRO_OPCIONES.map((e) => (
              <SelectItem key={e} value={e}>
                {ESTADO_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hayFiltros ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={limpiar}>
            Limpiar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
