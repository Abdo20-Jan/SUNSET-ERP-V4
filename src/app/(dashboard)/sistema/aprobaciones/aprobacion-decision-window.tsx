"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";

import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { PermissionGate } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { EntityLink } from "@/components/data-grid/entity-link";
import { MoneyAmount } from "@/components/ui/money-amount";
import { cn } from "@/lib/utils";
import { ESTADOS_ABIERTOS, SLA_BANDA_CLASS } from "@/lib/services/aprobaciones-constants";
import type { AprobacionRow, SolicitudDetalle } from "@/lib/services/aprobaciones-query";
import {
  type AprobacionActionResult,
  aprobarAction,
  cancelarAction,
  cargarDetalleAprobacionAction,
  rechazarAction,
  solicitarInfoAction,
} from "@/lib/actions/aprobaciones";

type Props = {
  row: AprobacionRow | null;
  approvalsEnabled: boolean;
  esAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
};

// Janela de decisão (FloatingWorkWindow · G-04). El wrapper sólo decide montar
// el inner cuando hay fila seleccionada; el inner se keyea por `row.id`, así su
// estado (comentario/detalle/error) nace fresco en cada selección sin resets
// síncronos en effects (regla React Compiler `set-state-in-effect`).
export function AprobacionDecisionWindow({
  row,
  approvalsEnabled,
  esAdmin,
  onClose,
  onDone,
}: Props) {
  if (!row) return null;
  return (
    <DecisionWindowInner
      key={row.id}
      row={row}
      approvalsEnabled={approvalsEnabled}
      esAdmin={esAdmin}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function DecisionWindowInner({
  row,
  approvalsEnabled,
  esAdmin,
  onClose,
  onDone,
}: {
  row: AprobacionRow;
  approvalsEnabled: boolean;
  esAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [detalle, setDetalle] = useState<SolicitudDetalle | null>(null);
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Carga del detalle (historial + otras del documento) — setState sólo en el
  // callback async, nunca síncrono en el cuerpo del effect.
  useEffect(() => {
    let cancelado = false;
    void cargarDetalleAprobacionAction(row.id).then((d) => {
      if (!cancelado) setDetalle(d);
    });
    return () => {
      cancelado = true;
    };
  }, [row.id]);

  const ejecutar = (fn: () => Promise<AprobacionActionResult>, requiereMotivo: boolean) => {
    if (requiereMotivo && comentario.trim().length === 0) {
      setError("El motivo es obligatorio.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) onDone();
      else setError(r.error);
    });
  };

  const puedeAccionar = ESTADOS_ABIERTOS.includes(row.estado) && approvalsEnabled;

  return (
    <FloatingWorkWindow
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Aprobación · ${row.tipoLabel}`}
      description={`${row.tabla} ${row.registroId}`}
      initialWidth={680}
      initialHeight={640}
      footer={
        <DecisionFooter
          row={row}
          puedeAccionar={puedeAccionar}
          esAdmin={esAdmin}
          pending={pending}
          comentario={comentario}
          onAprobar={() =>
            ejecutar(
              () =>
                aprobarAction({ solicitudId: row.id, comentario: comentario.trim() || undefined }),
              false,
            )
          }
          onRechazar={() =>
            ejecutar(() => rechazarAction({ solicitudId: row.id, motivo: comentario.trim() }), true)
          }
          onSolicitar={() =>
            ejecutar(
              () => solicitarInfoAction({ solicitudId: row.id, comentario: comentario.trim() }),
              true,
            )
          }
          onCancelar={() =>
            ejecutar(() => cancelarAction({ solicitudId: row.id, motivo: comentario.trim() }), true)
          }
          onCerrar={onClose}
        />
      }
    >
      <DecisionBody
        row={row}
        detalle={detalle}
        comentario={comentario}
        setComentario={setComentario}
        error={error}
        mostrarComentario={puedeAccionar}
      />
    </FloatingWorkWindow>
  );
}

function DecisionBody({
  row,
  detalle,
  comentario,
  setComentario,
  error,
  mostrarComentario,
}: {
  row: AprobacionRow;
  detalle: SolicitudDetalle | null;
  comentario: string;
  setComentario: (v: string) => void;
  error: string | null;
  mostrarComentario: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <DatosSolicitud row={row} />

      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Motivo del solicitante
        </h3>
        <p className="text-sm">{detalle?.motivo ?? "—"}</p>
      </section>

      <HistorialLiberaciones detalle={detalle} />

      {detalle?.anexos ? (
        <p className="text-xs text-muted-foreground">
          Esta solicitud tiene anexos adjuntos (visibles en el documento de origen).
        </p>
      ) : null}

      {mostrarComentario ? (
        <section className="flex flex-col gap-1">
          <label htmlFor="comentario-decision" className="text-xs font-medium">
            Comentario / motivo
          </label>
          <Textarea
            id="comentario-decision"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Opcional para aprobar; obligatorio para rechazar, solicitar info o cancelar."
            rows={3}
          />
        </section>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function DatosSolicitud({ row }: { row: AprobacionRow }) {
  return (
    <section className="grid grid-cols-2 gap-x-4 gap-y-2">
      <Dato label="Solicitante" valor={row.solicitanteNombre} />
      <Dato
        label="Documento"
        valor={
          row.documentoHref ? (
            <EntityLink
              label={row.registroId}
              href={row.documentoHref}
              tabLabel={`${row.tabla} ${row.registroId}`}
            />
          ) : (
            <span className="font-mono text-xs">{row.registroId}</span>
          )
        }
      />
      <Dato
        label="Valor"
        valor={
          row.valor == null ? (
            "—"
          ) : (
            <MoneyAmount
              value={row.valor}
              mode="plain"
              symbol={row.moneda ? `${row.moneda} ` : ""}
            />
          )
        }
      />
      <Dato label="Estado" valor={<StatusBadge estado={row.estado} label={row.estadoLabel} />} />
      <Dato
        label="SLA"
        valor={
          <span className={cn("text-sm", SLA_BANDA_CLASS[row.slaBanda])}>
            {row.venceEnLabel} · {row.slaLabel}
          </span>
        }
      />
      <Dato label="Aprobador" valor={row.aprobadorNombre} />
    </section>
  );
}

function Dato({ label, valor }: { label: string; valor: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{valor}</span>
    </div>
  );
}

function HistorialLiberaciones({ detalle }: { detalle: SolicitudDetalle | null }) {
  if (!detalle) return <p className="text-xs text-muted-foreground">Cargando historial…</p>;
  const { historial, otrasDelDocumento } = detalle;
  if (historial.length === 0 && otrasDelDocumento.length === 0) {
    return <p className="text-xs text-muted-foreground">Sin historial de liberaciones.</p>;
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Historial de liberaciones
      </h3>
      <ul className="flex flex-col gap-1.5">
        {historial.map((h) => (
          <li key={h.id} className="flex flex-col rounded border border-border/60 px-2 py-1.5">
            <span className="text-xs">
              <span className="font-medium">{h.aprobadorNombre}</span> · {h.decisionLabel}
              {h.esMasterOverride ? " (Master override)" : ""} · {h.fechaLabel}
            </span>
            {h.comentario ? (
              <span className="text-xs text-muted-foreground">{h.comentario}</span>
            ) : null}
          </li>
        ))}
        {otrasDelDocumento.map((o) => (
          <li key={o.id} className="text-xs text-muted-foreground">
            Otra solicitud del documento: {o.tipoLabel} · {o.estadoLabel}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DecisionFooter({
  row,
  puedeAccionar,
  esAdmin,
  pending,
  comentario,
  onAprobar,
  onRechazar,
  onSolicitar,
  onCancelar,
  onCerrar,
}: {
  row: AprobacionRow;
  puedeAccionar: boolean;
  esAdmin: boolean;
  pending: boolean;
  comentario: string;
  onAprobar: () => void;
  onRechazar: () => void;
  onSolicitar: () => void;
  onCancelar: () => void;
  onCerrar: () => void;
}) {
  const puedeCancelar = row.esSolicitante || esAdmin;
  if (!puedeAccionar) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2.5">
        <span className="text-xs text-muted-foreground">Solicitud resuelta · sólo lectura.</span>
        <Button type="button" variant="outline" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-2.5">
      {puedeCancelar ? (
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={pending}>
          Cancelar solicitud
        </Button>
      ) : null}
      <PermissionGate
        permission={row.permisoAprobacion}
        variant="button"
        tooltip="Sin permiso para este tipo"
      >
        <Button type="button" variant="outline" size="sm" onClick={onSolicitar} disabled={pending}>
          Solicitar información
        </Button>
      </PermissionGate>
      <PermissionGate
        permission={row.permisoAprobacion}
        variant="button"
        tooltip="Sin permiso para este tipo"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRechazar}
          disabled={pending}
          className="text-destructive"
        >
          Rechazar
        </Button>
      </PermissionGate>
      <PermissionGate
        permission={row.permisoAprobacion}
        variant="button"
        tooltip="Sin permiso para este tipo"
      >
        <Button type="button" size="sm" onClick={onAprobar} disabled={pending}>
          {pending ? "Procesando…" : "Aprobar"}
        </Button>
      </PermissionGate>
      {comentario.length > 500 ? (
        <span className="basis-full text-right text-xs text-destructive">
          El motivo no puede superar 500 caracteres.
        </span>
      ) : null}
    </div>
  );
}
