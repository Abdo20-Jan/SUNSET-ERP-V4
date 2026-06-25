"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ESTADO_LABEL,
  ESTADO_VALUES,
  SUBVISTAS,
  TIPO_LABEL,
  TIPO_VALUES,
} from "@/lib/services/aprobaciones-constants";

const DEFAULT = "todos";
const FILTER_KEYS = ["vista", "tipo", "estado", "solicitante", "sla"];

type Opcion = { value: string; label: string };
type Patch = Record<string, string | null>;
type Props = { solicitantes: { id: string; nombre: string }[] };

// Helper PURO (de módulo) — mantiene la complejidad ciclomática del componente ≤ 8.
function construirQuery(current: URLSearchParams, patch: Patch): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  return next.toString();
}

function vistaParam(id: string): string | null {
  return id === DEFAULT ? null : id;
}

// Barra de filtros server-driven: cada control escribe en la URL → el server
// component re-consulta. Las sub-vistas oficiales son presets de `?vista=`.
export function AprobacionesFilterBar({ solicitantes }: Props) {
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

  const tipoOptions: Opcion[] = TIPO_VALUES.map((t) => ({ value: t, label: TIPO_LABEL[t] }));
  const estadoOptions: Opcion[] = ESTADO_VALUES.map((e) => ({ value: e, label: ESTADO_LABEL[e] }));
  const solicitanteOptions: Opcion[] = solicitantes.map((s) => ({ value: s.id, label: s.nombre }));
  const slaOptions: Opcion[] = [{ value: "riesgo", label: "En riesgo (≥ 50%)" }];

  return (
    <div className="flex flex-col gap-3 border-b p-4">
      <SubvistaTabs
        activa={searchParams.get("vista") ?? "pendientes"}
        onSelect={(id) => updateUrl({ vista: vistaParam(id) })}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <FiltroSelect
          label="Tipo"
          value={searchParams.get("tipo")}
          options={tipoOptions}
          onChange={(v) => updateUrl({ tipo: v })}
        />
        <FiltroSelect
          label="Estado"
          value={searchParams.get("estado")}
          options={estadoOptions}
          onChange={(v) => updateUrl({ estado: v })}
        />
        <FiltroSelect
          label="Solicitante"
          value={searchParams.get("solicitante")}
          options={solicitanteOptions}
          onChange={(v) => updateUrl({ solicitante: v })}
        />
        <FiltroSelect
          label="SLA"
          value={searchParams.get("sla")}
          options={slaOptions}
          onChange={(v) => updateUrl({ sla: v })}
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
    <Select value={value ?? DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? null : v)}>
      <SelectTrigger size="sm" className="w-auto min-w-36">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>{label}: todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
