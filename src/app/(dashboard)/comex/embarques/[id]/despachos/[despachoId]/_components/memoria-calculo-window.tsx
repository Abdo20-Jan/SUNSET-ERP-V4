"use client";

/**
 * PR-023c (CX-06) — MemoriaCalculoWindow (read-only). Gatillo [Ver memoria de
 * cálculo] dentro de la pestaña Costos (ya gateada server-side por
 * `VER_COSTO_LANDED`) que abre una FloatingWorkWindow con la memoria de rateio:
 * badge de función, base usada, TCs, tabla por SKU (participación / base /
 * capitalizables alocados / costo unit. landed / total), línea de ajuste de
 * redondeo y total. Footer: [Simular] (re-preview) + export CSV/XLSX auditado.
 *
 * DISPLAY-only: los datos vienen del servidor (`verMemoriaAction` /
 * `simularMemoriaAction` / `exportarMemoriaDespacho`), que gatean y proyectan la
 * salida del motor SIN escribir. La ventana no recomputa nada. El export baja
 * los bytes construidos por el servidor (sin scrapear el DOM).
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { type VerMemoriaResult, verMemoriaAction } from "@/lib/actions/comex-despacho-memoria";
import { exportarMemoriaDespacho } from "@/lib/actions/comex-despacho-memoria-export";
import type { DespachoEstado } from "@/generated/prisma/client";

import { MemoriaSimular } from "./memoria-simular";

type Detalle = Extract<VerMemoriaResult, { ok: true }>["detalle"];
type Cruzado = Extract<Detalle, { tipo: "CRUZADO" }>;

const MENSAJE: Record<"SIN_PERMISO" | "SIN_MEMORIA" | "COSTOS_ABIERTOS", string> = {
  SIN_PERMISO: "Valores de costo ocultos — requiere el permiso «Ver costo landed».",
  SIN_MEMORIA: "Este despacho no tiene memoria de rateio.",
  COSTOS_ABIERTOS: "Cerrá los costos del contenedor para ver la memoria de costo landed.",
};

/** Descarga los bytes construidos por el servidor (sin DOM-scraping). */
function descargarBase64(base64: string, mime: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CabeceraMemoria({ d }: { d: Cruzado }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
          {d.funcionBadge}
        </span>
        <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {d.baseLabel}
        </span>
        <StatusBadge estado={d.estado} />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
        <Campo label="Valor a ratear (capitalizables)" valor={fmtMoney(d.valorAtatear)} />
        <Campo label="FOB nacionalizado (ARS)" valor={fmtMoney(d.nacionalizado)} />
        <Campo label="Costo total landed (ARS)" valor={fmtMoney(d.totalLanded)} />
        <Campo label="TC embarque / despacho" valor={`${d.tcEmbarque} / ${d.tcDespacho}`} />
      </div>
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

function TablaMemoria({ d }: { d: Cruzado }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2.5 py-1.5 text-left">Código</th>
            <th className="px-2.5 py-1.5 text-left">Producto</th>
            <th className="px-2.5 py-1.5 text-right">Cantidad</th>
            <th className="px-2.5 py-1.5 text-right">Participación</th>
            <th className="px-2.5 py-1.5 text-right">Base</th>
            <th className="px-2.5 py-1.5 text-right">Capitalizables</th>
            <th className="px-2.5 py-1.5 text-right">Costo unit. landed</th>
            <th className="px-2.5 py-1.5 text-right">Costo total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {d.lineas.map((l) => (
            <tr key={l.itemDespachoId}>
              <td className="px-2.5 py-1.5 font-mono text-[11px]">{l.codigo}</td>
              <td className="px-2.5 py-1.5">{l.nombre}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{l.cantidad}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{l.participacionPct}%</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(l.base)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">
                {fmtMoney(l.capitalizablesAlocado)}
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">
                {fmtMoney(l.costoUnitarioLanded)}
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(l.costoTotal)}</td>
            </tr>
          ))}
          <tr className="bg-muted/20 text-muted-foreground">
            <td className="px-2.5 py-1.5">—</td>
            <td className="px-2.5 py-1.5" colSpan={4}>
              Ajuste de redondeo (absorbido en el último ítem)
            </td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(d.ajusteRedondeo)}</td>
            <td className="px-2.5 py-1.5" colSpan={2} />
          </tr>
          <tr className="bg-muted/40 font-medium">
            <td className="px-2.5 py-1.5">—</td>
            <td className="px-2.5 py-1.5">TOTAL</td>
            <td className="px-2.5 py-1.5" />
            <td className="px-2.5 py-1.5 text-right tabular-nums">100,00%</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(d.nacionalizado)}</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(d.capitalizables)}</td>
            <td className="px-2.5 py-1.5" />
            <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(d.totalLanded)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CuerpoMemoria({ loading, result }: { loading: boolean; result: VerMemoriaResult | null }) {
  if (loading || result === null) {
    return <p className="text-[12px] text-muted-foreground">Cargando memoria…</p>;
  }
  if (!result.ok) {
    return <p className="text-[12px] text-muted-foreground">{MENSAJE[result.reason]}</p>;
  }
  if (result.detalle.tipo === "LEGACY") {
    return (
      <p className="text-[12px] text-muted-foreground">
        Despacho legacy — sin memoria de rateio (costo preservado por línea).
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <CabeceraMemoria d={result.detalle} />
      <TablaMemoria d={result.detalle} />
    </div>
  );
}

export function MemoriaCalculoWindow({
  despachoId,
  estado,
}: {
  despachoId: string;
  estado: DespachoEstado;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<VerMemoriaResult | null>(null);
  const [loading, start] = useTransition();
  const [exporting, startExport] = useTransition();

  const abrir = () => {
    setResult(null);
    setOpen(true);
    start(async () => setResult(await verMemoriaAction(despachoId)));
  };

  const runExport = (formato: "csv" | "xlsx") =>
    startExport(async () => {
      try {
        const res = await exportarMemoriaDespacho({ despachoId, formato });
        if (res.ok) {
          descargarBase64(res.base64, res.mime, res.filename);
          toast.success("Memoria exportada.");
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("No se pudo exportar la memoria.");
      }
    });

  const esCruzado = result?.ok === true && result.detalle.tipo === "CRUZADO";
  const codigo = result?.ok ? result.detalle.codigo : undefined;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[12px] font-medium">Memoria de cálculo</span>
          <span className="text-[11px] text-muted-foreground">
            Participación por SKU, base, ajuste de redondeo y export auditado — read-only.
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={abrir}>
          Ver memoria de cálculo
        </Button>
      </div>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title={`Memoria de cálculo${codigo ? ` · Despacho ${codigo}` : ""}`}
        description={
          estado === "BORRADOR"
            ? "Simulación (preview) — aún no contabilizado. Read-only, no graba nada."
            : "Read-only — valores del motor de rateio (sin recálculo)."
        }
        initialWidth={1040}
        initialHeight={620}
        defaultMaximized
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/60 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">
              Simulación read-only — no graba nada. Export auditado (CSV/XLSX).
            </span>
            <div className="flex items-center gap-2">
              <MemoriaSimular despachoId={despachoId} onResult={setResult} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!esCruzado || exporting}
                onClick={() => runExport("csv")}
              >
                Exportar CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!esCruzado || exporting}
                onClick={() => runExport("xlsx")}
              >
                Exportar Excel
              </Button>
            </div>
          </div>
        }
      >
        <CuerpoMemoria loading={loading} result={result} />
      </FloatingWorkWindow>
    </div>
  );
}
