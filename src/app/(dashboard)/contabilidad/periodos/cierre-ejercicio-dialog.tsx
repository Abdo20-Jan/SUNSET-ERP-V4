"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cerrarEjercicio } from "@/lib/actions/periodos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { esRangoEjercicioValido } from "./cierre-helpers";

export function CierreEjercicioDialog({
  defaultDesde,
  defaultHasta,
}: {
  defaultDesde: string;
  defaultHasta: string;
}) {
  const [open, setOpen] = useState(false);
  const [desde, setDesde] = useState(defaultDesde);
  const [hasta, setHasta] = useState(defaultHasta);
  const [conDestino, setConDestino] = useState(false);
  const [isSubmitting, startTransition] = useTransition();

  const valido = esRangoEjercicioValido(desde, hasta);

  const onConfirm = () => {
    if (!valido) return;
    startTransition(async () => {
      const result = await cerrarEjercicio({ fechaDesde: desde, fechaHasta: hasta, conDestino });
      if (result.ok) {
        toast.success(
          result.asientoDestinoId
            ? `Ejercicio cerrado (asiento #${result.numeroCierre}); resultado destinado (asiento #${result.numeroDestino}).`
            : `Ejercicio cerrado (asiento #${result.numeroCierre}).`,
        );
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Cerrar ejercicio
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!isSubmitting) setOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar ejercicio</DialogTitle>
            <DialogDescription>
              Salda las cuentas de resultado (clases 4 a 9) del rango contra Resultado del Ejercicio
              (3.4.01). Operación administrativa e idempotente: un solo cierre por rango.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cierre-desde">Desde</Label>
                <Input
                  id="cierre-desde"
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cierre-hasta">Hasta</Label>
                <Input
                  id="cierre-hasta"
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={conDestino}
                onCheckedChange={(v) => setConDestino(v === true)}
                disabled={isSubmitting}
              />
              También destinar el resultado a Resultados no asignados (3.4.01 → 3.3.01)
            </label>

            {!valido && (desde || hasta) ? (
              <p className="text-xs text-destructive">
                El rango es inválido: «Desde» debe ser ≤ «Hasta».
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={onConfirm} disabled={isSubmitting || !valido}>
              {isSubmitting ? "Procesando…" : "Cerrar ejercicio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
