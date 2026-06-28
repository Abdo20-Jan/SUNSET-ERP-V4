import Link from "next/link";

import type { DespachoListRow } from "@/lib/actions/despachos";
import { fmtDateOrDash, fmtMoney } from "@/lib/format";
import { RecordSection } from "@/components/record/record-section";

import type {
  ContenedorVista,
  EmbarqueFinanciero,
  EmbarqueVista,
  FiscalCounters,
} from "./embarque-vista";

/*
 * EmbarqueResumenView (PR-021, CX-03 §9.1) — aba "Resumen" (primeira, PAGE-STD-02):
 * a "fotografia" do processo. Layout §9.1: timeline à esquerda + resumo financeiro
 * à direita (alturas equivalentes), demais blocos abaixo. APRESENTACIONAL: a página
 * resolve a projeção (vista/financiero gated), os mapas e a próxima ação; aqui só
 * exibimos. Zero recálculo (CRIT-04/05): tudo vem de `obtenerEmbarquePorId`.
 *
 * Os 7 blocos (§9.1): (121) Timeline · (122) Resumo financeiro [gated] ·
 * (123) Containers · (124) Despachos + contadores fiscais · (125) Documentos
 * pendentes · (126) Alertas [= banda no topo da página] · (127) Próxima acción.
 */
export type ProximaAccion = {
  titulo: string;
  descripcion: string;
  href?: string;
  hrefLabel?: string;
} | null;

type Props = {
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
  contenedores: ContenedorVista[];
  despachos: DespachoListRow[];
  fiscal: FiscalCounters;
  proximaAccion: ProximaAccion;
};

// ---------- Timeline (121) ----------

type Marco = { label: string; detalle: string; done: boolean };

function construirTimeline(vista: EmbarqueVista): Marco[] {
  const marcos: Marco[] = [
    { label: "Registro", detalle: "Embarque creado", done: true },
    { label: "Empaque", detalle: fmtDateOrDash(vista.fechaEmpaque), done: !!vista.fechaEmpaque },
    { label: "Salida", detalle: fmtDateOrDash(vista.fechaSalida), done: !!vista.fechaSalida },
  ];
  if (vista.fechaTransbordo || vista.lugarTransbordo) {
    marcos.push({
      label: "Transbordo",
      detalle: vista.lugarTransbordo
        ? `${vista.lugarTransbordo} · ${fmtDateOrDash(vista.fechaTransbordo)}`
        : fmtDateOrDash(vista.fechaTransbordo),
      done: !!vista.fechaTransbordo,
    });
  }
  marcos.push(
    {
      label: "Llegada (ETA)",
      detalle: fmtDateOrDash(vista.fechaLlegada),
      done: !!vista.fechaLlegada,
    },
    {
      label: "Zona primaria",
      detalle: vista.asientoZonaPrimaria
        ? `Confirmada · asiento #${vista.asientoZonaPrimaria.numero}`
        : "Pendiente",
      done: !!vista.asientoZonaPrimaria,
    },
    {
      label: "Despachos",
      detalle:
        vista.despachosActivosCount > 0
          ? `${vista.despachosActivosCount} activo(s)`
          : "Sin despachos",
      done: vista.despachosActivosCount > 0,
    },
    {
      label: "Cierre / Nacionalización",
      detalle: vista.asiento ? `Cerrado · asiento #${vista.asiento.numero}` : "Pendiente",
      done: !!vista.asiento,
    },
  );
  return marcos;
}

function TimelineBlock({ vista }: { vista: EmbarqueVista }) {
  const marcos = construirTimeline(vista);
  return (
    <RecordSection title="Timeline">
      <ol className="flex flex-col">
        {marcos.map((m) => (
          <li key={m.label} className="flex items-start gap-3 py-1">
            <span
              aria-hidden
              className={`mt-1 size-2 shrink-0 rounded-full ${m.done ? "bg-success" : "border border-border bg-muted"}`}
            />
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.detalle}</span>
            </div>
          </li>
        ))}
      </ol>
    </RecordSection>
  );
}

// ---------- Próxima acción (127) ----------

function ProximaAccionBlock({ accion }: { accion: ProximaAccion }) {
  if (!accion) {
    return (
      <RecordSection title="Próxima acción">
        <p className="text-sm text-warning">Sin próxima acción — definir.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Próxima acción">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{accion.titulo}</p>
        <p className="text-xs text-muted-foreground">{accion.descripcion}</p>
        {accion.href && (
          <Link
            href={accion.href}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {accion.hrefLabel ?? "Ejecutar"} →
          </Link>
        )}
      </div>
    </RecordSection>
  );
}

// ---------- Resumen financiero (122) — gated ----------

function FinRow({ label, value, tone }: { label: string; value: string; tone?: "muted" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={
          tone === "muted"
            ? "font-mono text-sm tabular-nums text-muted-foreground"
            : "font-mono text-sm tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function FinancieroBlock({ financiero }: { financiero: EmbarqueFinanciero | null }) {
  if (!financiero) {
    return (
      <RecordSection title="Resumen financiero">
        <p className="text-sm text-muted-foreground">
          — · requiere permiso de costo landed (<code className="text-xs">costos.verLanded</code>).
        </p>
      </RecordSection>
    );
  }
  const m = financiero.moneda;
  const tieneFlete = Number(financiero.valorFleteOrigen ?? 0) > 0;
  const tieneSeguro = Number(financiero.valorSeguroOrigen ?? 0) > 0;
  return (
    <RecordSection title="Resumen financiero autorizado">
      <div className="flex flex-col gap-1.5">
        <FinRow label="FOB" value={`${m} ${fmtMoney(financiero.fobTotal)}`} />
        {tieneFlete && (
          <FinRow
            label="Flete origen"
            value={`${m} ${fmtMoney(financiero.valorFleteOrigen ?? "0")}`}
          />
        )}
        {tieneSeguro && (
          <FinRow
            label="Seguro origen"
            value={`${m} ${fmtMoney(financiero.valorSeguroOrigen ?? "0")}`}
          />
        )}
        <FinRow label="CIF" value={`${m} ${fmtMoney(financiero.cifTotal)}`} />

        <div className="mt-1 border-t border-border pt-1.5" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tributos capitalizables
        </p>
        <FinRow label="DIE" value={`${m} ${fmtMoney(financiero.die)}`} />
        <FinRow label="Tasa estadística" value={`${m} ${fmtMoney(financiero.tasaEstadistica)}`} />
        <FinRow label="Arancel SIM" value={`${m} ${fmtMoney(financiero.arancelSim)}`} />

        <div className="mt-1 border-t border-border pt-1.5" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Cash-out / créditos — no costo
        </p>
        <FinRow label="IVA" value={`${m} ${fmtMoney(financiero.iva)}`} tone="muted" />
        <FinRow
          label="IVA adicional"
          value={`${m} ${fmtMoney(financiero.ivaAdicional)}`}
          tone="muted"
        />
        <FinRow label="IIBB" value={`${m} ${fmtMoney(financiero.iibb)}`} tone="muted" />
        <FinRow label="Ganancias" value={`${m} ${fmtMoney(financiero.ganancias)}`} tone="muted" />

        <div className="my-1 border-t border-border" />
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Costo total (ARS)
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            ARS {fmtMoney(financiero.costoTotal)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          IVA, IVA adicional, IIBB y Ganancias son cash-out / crédito recuperable, no costo del
          producto (CRIT-09).
        </p>
      </div>
    </RecordSection>
  );
}

// ---------- Containers (123) ----------

function ContainersBlock({
  contenedores,
  embarqueId,
}: {
  contenedores: ContenedorVista[];
  embarqueId: string;
}) {
  if (contenedores.length === 0) {
    return (
      <RecordSection title="Containers">
        <p className="text-sm text-muted-foreground">Sin contenedores desconsolidados.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection
      title="Containers"
      actions={
        <Link
          href={`/comex/embarques/${embarqueId}?tab=operacion`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver todos ({contenedores.length})
        </Link>
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {contenedores.slice(0, 5).map((c) => {
          const unidades = c.items.reduce((acc, it) => acc + it.cantidadDeclarada, 0);
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate font-mono text-xs">{c.numeroContenedor}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.estado.replace(/_/g, " ")}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {unidades} u.
              </span>
            </li>
          );
        })}
      </ul>
    </RecordSection>
  );
}

// ---------- Despachos + contadores fiscales (124, §9.8-9.10) ----------

function FiscalChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function DespachosBlock({
  fiscal,
  despachos,
  embarqueId,
}: {
  fiscal: FiscalCounters;
  despachos: DespachoListRow[];
  embarqueId: string;
}) {
  return (
    <RecordSection
      title="Despachos"
      actions={
        <Link
          href={`/comex/embarques/${embarqueId}/despachos`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Gestionar →
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FiscalChip label="Total" value={fiscal.totalDeclarado} />
        <FiscalChip label="Nacionalizado" value={fiscal.nacionalizado} />
        <FiscalChip label="En fiscal" value={fiscal.enFiscal} />
        <FiscalChip label="En despacho" value={fiscal.enDespacho} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {despachos.length === 0
          ? "Sin despachos generados."
          : `${despachos.length} despacho(s) · ${despachos.filter((d) => d.estado === "CONTABILIZADO").length} contabilizado(s).`}
      </p>
    </RecordSection>
  );
}

// ---------- Documentos pendientes (125) — derivado ----------

function docsPendientes(vista: EmbarqueVista, financiero: EmbarqueFinanciero | null): string[] {
  const pend: string[] = [];
  if (!vista.asientoZonaPrimaria && !vista.asiento) pend.push("Zona primaria sin confirmar.");
  if (vista.asientoZonaPrimaria && !vista.asiento) pend.push("Cierre / nacionalización pendiente.");
  if (financiero) {
    const sinFactura = financiero.costos.filter((c) => !c.facturaNumero).length;
    if (sinFactura > 0) pend.push(`${sinFactura} costo(s) sin número de factura.`);
  }
  return pend;
}

function DocsPendientesBlock({
  vista,
  financiero,
}: {
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
}) {
  const pend = docsPendientes(vista, financiero);
  return (
    <RecordSection title="Documentos / pendencias">
      {pend.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin pendencias derivables.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {pend.map((p) => (
            <li key={p} className="text-amber-700 dark:text-amber-300">
              • {p}
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );
}

// ---------- Composição ----------

export function EmbarqueResumenView({
  vista,
  financiero,
  contenedores,
  despachos,
  fiscal,
  proximaAccion,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <ProximaAccionBlock accion={proximaAccion} />
          <TimelineBlock vista={vista} />
        </div>
        <FinancieroBlock financiero={financiero} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ContainersBlock contenedores={contenedores} embarqueId={vista.id} />
        <DespachosBlock fiscal={fiscal} despachos={despachos} embarqueId={vista.id} />
        <DocsPendientesBlock vista={vista} financiero={financiero} />
      </div>
    </div>
  );
}
