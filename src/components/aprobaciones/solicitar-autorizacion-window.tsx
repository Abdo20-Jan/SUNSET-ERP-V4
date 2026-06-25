"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";

import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIPO_LABEL } from "@/lib/services/aprobaciones-constants";
import type { TipoAprobacion } from "@/generated/prisma/enums";
import { crearSolicitudAction } from "@/lib/actions/aprobaciones";

type Props = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  tabla: string;
  registroId: string;
  tiposPermitidos: readonly TipoAprobacion[];
};

// Janela genérica de "Solicitar autorización" (FloatingWorkWindow · G-04).
// CREA una Solicitud vía el motor PR-012 — NO bloquea ninguna acción del
// documento (no enforcement). El wrapper monta el inner sólo cuando abre, así el
// formulario nace fresco sin resets síncronos en effects (regla React Compiler).
export function SolicitarAutorizacionWindow(props: Props) {
  if (!props.open) return null;
  return <SolicitarInner {...props} />;
}

function SolicitarInner({ onClose, onDone, tabla, registroId, tiposPermitidos }: Props) {
  const pathname = usePathname();
  const [tipo, setTipo] = useState<TipoAprobacion | "">(tiposPermitidos[0] ?? "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!tipo) {
      setError("Elegí un tipo de autorización.");
      return;
    }
    if (motivo.trim().length === 0) {
      setError("El motivo es obligatorio.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await crearSolicitudAction({
        tipo,
        tabla,
        registroId,
        motivo: motivo.trim(),
        revalidar: pathname,
      });
      if (r.ok) onDone();
      else setError(r.error);
    });
  };

  return (
    <FloatingWorkWindow
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Solicitar autorización"
      description={`${tabla} ${registroId}`}
      initialWidth={520}
      initialHeight={420}
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={submit} disabled={pending}>
            {pending ? "Enviando…" : "Solicitar"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="tipo-solicitud" className="text-xs font-medium">
            Tipo de autorización
          </label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoAprobacion)}>
            <SelectTrigger id="tipo-solicitud" size="sm" className="w-full">
              <SelectValue placeholder="Elegí un tipo" />
            </SelectTrigger>
            <SelectContent>
              {tiposPermitidos.map((t) => (
                <SelectItem key={t} value={t}>
                  {TIPO_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="motivo-solicitud" className="text-xs font-medium">
            Motivo
          </label>
          <Textarea
            id="motivo-solicitud"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Explicá el motivo de la solicitud (obligatorio)."
            rows={4}
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </FloatingWorkWindow>
  );
}
