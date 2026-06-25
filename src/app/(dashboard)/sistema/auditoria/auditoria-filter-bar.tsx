"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableSearch } from "@/components/ui/data-table-search";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCION_LABEL,
  ACCION_VALUES,
  ORIGEN_LABEL,
  ORIGEN_VALUES,
  SUBVISTAS,
  TABLA_LABEL,
} from "@/lib/services/auditoria-constants";

const TODOS = "todos";
const FILTER_KEYS = ["vista", "desde", "hasta", "usuario", "tabla", "accion", "origen", "motivo"];

type Opcion = { value: string; label: string };
type Patch = Record<string, string | null>;
type Props = { usuarios: { id: string; nombre: string }[] };

// Helpers PUROS (de módulo) — concentran las decisiones fuera del componente
// para mantener su complejidad ciclomática ≤ 8.
function construirQuery(current: URLSearchParams, patch: Patch): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  return next.toString();
}

// "todos" no es un valor de filtro: limpia el preset de la URL.
function vistaParam(id: string): string | null {
  return id === TODOS ? null : id;
}

// Barra de filtros server-driven: cada control escribe en la URL (searchParams)
// → el server component re-consulta. Las sub-vistas oficiales son presets de
// `?vista=` (server-side). Reusa `DataTableSearch` (debounce) para `motivo`.
export function AuditoriaFilterBar({ usuarios }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();

  const updateUrl = (patch: Patch) => {
    const qs = construirQuery(searchParams, patch);
    startNav(() => router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname));
  };

  const hayFiltros = FILTER_KEYS.some((k) => searchParams.get(k));
  const limpiar = () => updateUrl(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));

  const usuarioOptions: Opcion[] = usuarios.map((u) => ({ value: u.id, label: u.nombre }));
  const tablaOptions: Opcion[] = Object.entries(TABLA_LABEL).map(([v, label]) => ({
    value: v,
    label,
  }));
  const accionOptions: Opcion[] = ACCION_VALUES.map((a) => ({ value: a, label: ACCION_LABEL[a] }));
  const origenOptions: Opcion[] = ORIGEN_VALUES.map((o) => ({ value: o, label: ORIGEN_LABEL[o] }));

  return (
    <div className="flex flex-col gap-3 border-b p-4">
      <SubvistaTabs
        activa={searchParams.get("vista") ?? TODOS}
        onSelect={(id) => updateUrl({ vista: vistaParam(id) })}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <DataTableSearch
          paramName="motivo"
          initialValue={searchParams.get("motivo") ?? ""}
          placeholder="Motivo contiene…"
        />
        <FiltroSelect
          label="Usuario"
          value={searchParams.get("usuario")}
          options={usuarioOptions}
          onChange={(v) => updateUrl({ usuario: v })}
        />
        <FiltroSelect
          label="Tabla"
          value={searchParams.get("tabla")}
          options={tablaOptions}
          onChange={(v) => updateUrl({ tabla: v })}
        />
        <FiltroSelect
          label="Acción"
          value={searchParams.get("accion")}
          options={accionOptions}
          onChange={(v) => updateUrl({ accion: v })}
        />
        <FiltroSelect
          label="Origen"
          value={searchParams.get("origen")}
          options={origenOptions}
          onChange={(v) => updateUrl({ origen: v })}
        />
        <RangoFechas
          desde={searchParams.get("desde") ?? ""}
          hasta={searchParams.get("hasta") ?? ""}
          onChange={updateUrl}
        />
        {hayFiltros ? (
          <Button variant="ghost" size="sm" onClick={limpiar}>
            Limpiar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SubvistaTabs({ activa, onSelect }: { activa: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {SUBVISTAS.map((s) => (
        <Button
          key={s.id}
          variant={activa === s.id ? "default" : "outline"}
          size="sm"
          onClick={() => onSelect(s.id)}
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}

function RangoFechas({
  desde,
  hasta,
  onChange,
}: {
  desde: string;
  hasta: string;
  onChange: (patch: Patch) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        aria-label="Desde"
        className="w-auto"
        value={desde}
        onChange={(e) => onChange({ desde: e.target.value || null })}
      />
      <span className="text-xs text-muted-foreground">a</span>
      <Input
        type="date"
        aria-label="Hasta"
        className="w-auto"
        value={hasta}
        onChange={(e) => onChange({ hasta: e.target.value || null })}
      />
    </div>
  );
}

function FiltroSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: Opcion[];
  onChange: (v: string | null) => void;
}) {
  return (
    <Select value={value ?? TODOS} onValueChange={(v) => onChange(v === TODOS ? null : v)}>
      <SelectTrigger size="sm" className="w-auto min-w-36">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{label}: todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
