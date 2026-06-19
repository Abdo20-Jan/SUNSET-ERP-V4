"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { desconsolidarAction } from "@/lib/actions/desconsolidacion";
import type { ContenedorDesconsolidacionDTO } from "@/lib/services/contenedor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { RetroactivoBadge } from "@/components/ui/retroactivo-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// PR 3.4 — Form de conferencia física + disparo de la desconsolidación.
// Opera sobre un contenedor ya EN_DEPOSITO_FISCAL con FC cerrado; si no, los
// gates muestran un banner y el botón queda deshabilitado (defensa en
// profundidad: el service relanza los mismos errores).

interface Props {
  contenedor: ContenedorDesconsolidacionDTO;
  defaultFecha: string;
}

export function DesconsolidacionForm({ contenedor, defaultFecha }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fecha, setFecha] = useState(defaultFecha);
  const [fisicas, setFisicas] = useState<Record<number, number>>(() =>
    Object.fromEntries(contenedor.items.map((it) => [it.id, it.cantidadDeclarada])),
  );

  const bloqueo = useMemo(() => {
    if (!contenedor.puedeDesconsolidar)
      return `El contenedor está en ${contenedor.estado}: sólo se desconsolida desde EN_DEPOSITO_FISCAL.`;
    if (!contenedor.fcCerrado)
      return "Hay items sin costo FC unitario. Cerrá los costos antes de desconsolidar.";
    if (!contenedor.depositoFiscalAsignado)
      return "El contenedor no tiene depósito fiscal asignado.";
    if (!contenedor.tipoCambioValido) return "El embarque no tiene un tipo de cambio válido.";
    return null;
  }, [contenedor]);

  const filas = contenedor.items.map((it) => {
    const fisica = fisicas[it.id] ?? it.cantidadDeclarada;
    return { ...it, fisica, diferencia: fisica - it.cantidadDeclarada };
  });
  const hayDivergencia = filas.some((f) => f.diferencia !== 0);
  const habilitado = bloqueo == null && !pending;

  const onConfirmar = () => {
    if (!fecha) {
      toast.error("Seleccioná la fecha contable.");
      return;
    }
    const conferencia = contenedor.items.map((it) => ({
      itemContenedorId: it.id,
      cantidadFisica: Math.trunc(fisicas[it.id] ?? it.cantidadDeclarada),
    }));
    startTransition(async () => {
      const r = await desconsolidarAction({ contenedorId: contenedor.id, fecha, conferencia });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setConfirmOpen(false);
      if (r.divergencia) {
        toast.warning(
          `Desconsolidación con divergencia: ${contenedor.numeroContenedor} pasó a AGUARDANDO_INVESTIGACAO (asiento bloqueado).`,
        );
      } else {
        toast.success(
          `Contenedor ${contenedor.numeroContenedor} desconsolidado${r.asientoId ? " (asiento generado)" : ""}.`,
        );
      }
      router.push(`/comex/embarques/${contenedor.embarqueId}`);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Conferencia física por SKU</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              hayDivergencia
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            }`}
          >
            {hayDivergencia ? "Con divergencia" : "Sin divergencia"}
          </span>
        </div>

        {bloqueo && (
          <p className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            {bloqueo}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Fecha contable</span>
            <div className="flex items-center gap-2">
              <DatePicker value={fecha} onChange={setFecha} />
              <RetroactivoBadge fecha={fecha} />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Producto</th>
                <th className="px-3 py-2 text-right font-medium">Declarada</th>
                <th className="px-3 py-2 text-right font-medium">Física</th>
                <th className="px-3 py-2 text-right font-medium">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="px-3 py-1.5">{f.productoLabel}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{f.cantidadDeclarada}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      disabled={!habilitado}
                      value={f.fisica}
                      onChange={(e) =>
                        setFisicas((prev) => ({ ...prev, [f.id]: Number(e.target.value) }))
                      }
                      className="ml-auto w-28 text-right tabular-nums"
                    />
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      f.diferencia === 0 ? "text-muted-foreground" : "font-medium text-amber-600"
                    }`}
                  >
                    {f.diferencia > 0 ? `+${f.diferencia}` : f.diferencia}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-xs text-muted-foreground">
                    El contenedor no tiene packing list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          Sin divergencia: se genera el asiento de traslado a depósito fiscal (DEBE 1.1.7.03 / HABER
          1.1.7.04) e ingresa el stock al DF. Con divergencia: el asiento queda bloqueado y el
          contenedor pasa a investigación (AGUARDANDO_INVESTIGACAO).
        </p>

        <div className="flex justify-end">
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger
              render={
                <Button type="button" disabled={!habilitado || filas.length === 0}>
                  Desconsolidar
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Desconsolidar {contenedor.numeroContenedor}</DialogTitle>
                <DialogDescription>
                  {hayDivergencia
                    ? "Hay diferencias entre físico y declarado: el contenedor pasará a investigación (AGUARDANDO_INVESTIGACAO) y el asiento quedará bloqueado hasta concluirla."
                    : "Se moverá el stock al depósito fiscal y se generará el asiento de traslado. Esta acción confirma la conferencia física."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={onConfirmar} disabled={pending}>
                  {pending ? "Procesando…" : "Confirmar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
