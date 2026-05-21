"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  contabilizarBorradorAction,
  crearBorradorAction,
  expirarBorradorAction,
} from "@/lib/actions/despachos";
import type { MatrizDespachoCruzadoDTO } from "@/lib/services/despacho-parcial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RetroactivoBadge } from "@/components/ui/retroactivo-badge";
import { fmtMoney } from "@/lib/format";

type Props = {
  matriz: MatrizDespachoCruzadoDTO;
  defaultFecha: string;
};

export function DespachoCruzadoMatriz({ matriz, defaultFecha }: Props) {
  if (matriz.borradorVigente) {
    return <BorradorVigentePanel matriz={matriz} defaultFecha={defaultFecha} />;
  }
  return <MatrizEditor matriz={matriz} />;
}

// ------------------------------------------------------------
// Editor de la matriz SKU × contenedor (sin borrador activo)
// ------------------------------------------------------------

function MatrizEditor({ matriz }: { matriz: MatrizDespachoCruzadoDTO }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // cantidad por itemContenedorId (clave de celda).
  const [cantidades, setCantidades] = useState<Record<number, string>>({});

  const tc = Number(matriz.tipoCambio) || 0;

  const setCantidad = (itemContenedorId: number, value: string) =>
    setCantidades((cur) => ({ ...cur, [itemContenedorId]: value }));

  // Lookup celda por (itemEmbarqueId, contenedorId) para render de la grilla.
  const celdaDe = (skuIndex: number, contenedorId: string) =>
    matriz.skus[skuIndex]?.celdas.find((c) => c.contenedorId === contenedorId);

  const { totalUnidades, costoEstimado, lineas } = useMemo(() => {
    let unidades = 0;
    let costo = 0;
    const ls: Array<{ itemContenedorId: number; cantidad: number }> = [];
    for (const sku of matriz.skus) {
      for (const celda of sku.celdas) {
        const n = Math.trunc(Number(cantidades[celda.itemContenedorId] ?? 0));
        if (!Number.isFinite(n) || n <= 0) continue;
        unidades += n;
        if (celda.costoFCUnitario != null) costo += n * Number(celda.costoFCUnitario) * tc;
        ls.push({ itemContenedorId: celda.itemContenedorId, cantidad: n });
      }
    }
    return { totalUnidades: unidades, costoEstimado: costo, lineas: ls };
  }, [cantidades, matriz.skus, tc]);

  const reservar = () => {
    if (lineas.length === 0) {
      toast.error("Indicá al menos una cantidad.");
      return;
    }
    // Validación de tope por celda (defensa en profundidad — el service relanza).
    for (const sku of matriz.skus) {
      for (const celda of sku.celdas) {
        const n = Math.trunc(Number(cantidades[celda.itemContenedorId] ?? 0));
        if (n > celda.cantidadDisponible) {
          toast.error(
            `${sku.productoLabel} en ${celda.numeroContenedor}: máximo ${celda.cantidadDisponible}.`,
          );
          return;
        }
      }
    }
    startTransition(async () => {
      const r = await crearBorradorAction({ embarqueId: matriz.embarqueId, lineas });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Borrador reservado — las unidades quedan trabadas mientras lo confirmás.");
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px]">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">SKU</th>
              {matriz.contenedores.map((c) => (
                <th key={c.id} className="px-2.5 py-1.5 text-center">
                  <span className="font-mono text-[11px]">{c.numeroContenedor}</span>
                  <EstadoBadge estado={c.estado} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {matriz.skus.map((sku, skuIndex) => (
              <tr key={sku.itemEmbarqueId}>
                <td className="px-2.5 py-1.5">{sku.productoLabel}</td>
                {matriz.contenedores.map((c) => {
                  const celda = celdaDe(skuIndex, c.id);
                  if (!celda) {
                    return (
                      <td key={c.id} className="px-2.5 py-1.5 text-center text-muted-foreground">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={c.id} className="px-2.5 py-1.5">
                      <Input
                        type="number"
                        min={0}
                        max={celda.cantidadDisponible}
                        value={cantidades[celda.itemContenedorId] ?? ""}
                        placeholder="0"
                        onChange={(e) => setCantidad(celda.itemContenedorId, e.target.value)}
                        className="h-7 text-right"
                      />
                      <span className="mt-0.5 block text-right text-[10px] text-muted-foreground">
                        disp. {celda.cantidadDisponible}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="flex h-fit flex-col gap-2 rounded-md border p-3 lg:sticky lg:top-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Resumen
        </p>
        <Resumen unidades={totalUnidades} costoEstimado={costoEstimado} tcConocido={tc > 0} />
        <Button type="button" onClick={reservar} disabled={pending || totalUnidades === 0}>
          {pending ? "Reservando…" : "Reservar borrador"}
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Reservar traba las unidades (cantidadEnDespacho) sin contabilizar. El borrador vence en 24
          h o lo libera el cron.
        </p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------
// Panel del borrador vigente (reservado) — confirmar / descartar
// ------------------------------------------------------------

function BorradorVigentePanel({
  matriz,
  defaultFecha,
}: {
  matriz: MatrizDespachoCruzadoDTO;
  defaultFecha: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(defaultFecha ?? today);

  const borrador = matriz.borradorVigente!;
  const tc = Number(matriz.tipoCambio) || 0;

  // Labels best-effort desde las celdas de la matriz (una celda puede haber
  // desaparecido si su disponible quedó en 0 al reservarla por completo).
  const labelPorIc = useMemo(() => {
    const m = new Map<number, { productoLabel: string; numeroContenedor: string }>();
    for (const sku of matriz.skus) {
      for (const celda of sku.celdas) {
        m.set(celda.itemContenedorId, {
          productoLabel: sku.productoLabel,
          numeroContenedor: celda.numeroContenedor,
        });
      }
    }
    return m;
  }, [matriz.skus]);

  const totalUnidades = borrador.lineas.reduce((s, l) => s + l.cantidad, 0);
  const vence = new Date(borrador.expiresAt).toLocaleString("es-AR");

  const confirmar = () =>
    startTransition(async () => {
      const r = await contabilizarBorradorAction({
        borradorId: borrador.id,
        embarqueId: matriz.embarqueId,
        fecha,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Despacho ${r.codigo} materializado — contabilizalo en la tabla de arriba.`);
      router.refresh();
    });

  const descartar = () =>
    startTransition(async () => {
      const r = await expirarBorradorAction({
        borradorId: borrador.id,
        embarqueId: matriz.embarqueId,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Borrador descartado — las unidades vuelven a estar disponibles.");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
        <p className="font-semibold">Tenés un borrador de despacho reservado.</p>
        <p className="mt-0.5">
          {borrador.lineas.length} línea{borrador.lineas.length === 1 ? "" : "s"} · {totalUnidades}{" "}
          unidades trabadas · vence {vence}.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Producto</th>
              <th className="px-2.5 py-1.5 text-left">Contenedor</th>
              <th className="px-2.5 py-1.5 text-right">Cantidad</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {borrador.lineas.map((l) => {
              const lbl = labelPorIc.get(l.itemContenedorId);
              return (
                <tr key={l.itemContenedorId}>
                  <td className="px-2.5 py-1.5">
                    {lbl?.productoLabel ?? `Línea #${l.itemContenedorId}`}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[12px]">
                    {lbl?.numeroContenedor ?? "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-semibold">{l.cantidad}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t pt-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Fecha despacho</Label>
          <div className="flex items-center gap-2">
            <DatePicker value={fecha} onChange={setFecha} />
            <RetroactivoBadge fecha={fecha} />
          </div>
        </div>
        <span className="flex-1 text-[11px] text-muted-foreground">
          Confirmar materializa el despacho (BORRADOR, sin asiento). Después contabilizalo en la
          tabla para generar el asiento + mover stock. {tc > 0 ? `TC ${tc.toFixed(2)}.` : ""}
        </span>
        <Button type="button" variant="ghost" onClick={descartar} disabled={pending}>
          {pending ? "…" : "Descartar"}
        </Button>
        <Button type="button" onClick={confirmar} disabled={pending}>
          {pending ? "Confirmando…" : "Confirmar despacho"}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Auxiliares
// ------------------------------------------------------------

function Resumen({
  unidades,
  costoEstimado,
  tcConocido,
}: {
  unidades: number;
  costoEstimado: number;
  tcConocido: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Unidades</span>
        <span className="font-semibold">{unidades}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Costo est. (ARS)</span>
        <span className="font-mono">
          {tcConocido && costoEstimado > 0 ? fmtMoney(String(costoEstimado)) : "—"}
        </span>
      </div>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const variant = estado === "PARCIALMENTE_DESPACHADO" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="mt-0.5 block text-[9px]">
      {estado === "PARCIALMENTE_DESPACHADO" ? "PARCIAL" : "DESCONS."}
    </Badge>
  );
}
