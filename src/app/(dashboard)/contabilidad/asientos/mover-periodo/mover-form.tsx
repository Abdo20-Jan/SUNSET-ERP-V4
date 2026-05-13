"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";

import type {
  AsientoEstado,
  AsientoOrigen,
  Moneda,
  PeriodoEstado,
} from "@/generated/prisma/client";
import {
  autoCorrigirFechaAsientosAction,
  cambiarFechaAsientosAction,
  moverAsientosDePeriodoAction,
} from "@/lib/actions/asientos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AsientoRow = {
  id: string;
  numero: number;
  fecha: Date;
  descripcion: string;
  estado: AsientoEstado;
  origen: AsientoOrigen;
  moneda: Moneda;
  totalDebe: string;
  periodoCodigo: string;
  contexto: { etiqueta: string; lineas: string[] };
};

export type PeriodoOption = {
  id: number;
  codigo: string;
  nombre: string;
  estado: PeriodoEstado;
};

function formatDate(d: Date) {
  return format(d, "dd/MM/yyyy");
}

function estadoVariant(estado: AsientoEstado): "default" | "outline" | "secondary" {
  switch (estado) {
    case "CONTABILIZADO":
      return "default";
    case "BORRADOR":
      return "outline";
    default:
      return "secondary";
  }
}

type Props = {
  asientos: AsientoRow[];
  periodos: PeriodoOption[];
  periodoOrigenId: number;
};

type DialogKind = "mover" | "cambiar-fecha" | "auto-corregir";

export function MoverPeriodoForm({ asientos, periodos, periodoOrigenId }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [periodoDestinoId, setPeriodoDestinoId] = useState<number | null>(null);
  const [nuevaFecha, setNuevaFecha] = useState<string>("");
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [pending, startTransition] = useTransition();

  const destinoOptions = useMemo(
    () => periodos.filter((p) => p.estado === "ABIERTO" && p.id !== periodoOrigenId),
    [periodos, periodoOrigenId],
  );

  const destinoSeleccionado = useMemo(
    () => destinoOptions.find((p) => p.id === periodoDestinoId) ?? null,
    [destinoOptions, periodoDestinoId],
  );

  const allChecked = asientos.length > 0 && selectedIds.size === asientos.length;
  const someChecked = selectedIds.size > 0 && !allChecked;

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(asientos.map((a) => a.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const hasSeleccion = selectedIds.size > 0;
  const canMover =
    !pending && hasSeleccion && periodoDestinoId !== null && destinoSeleccionado !== null;
  const canCambiarFecha = !pending && hasSeleccion && nuevaFecha.length === 10;
  const canAutoCorregir = !pending && hasSeleccion;

  const closeDialog = () => {
    if (!pending) setDialog(null);
  };

  const sumarizar = (oks: number, errs: number, verbo: string, verboPlural: string) => {
    if (errs === 0) {
      toast.success(`${oks} asiento${oks === 1 ? "" : "s"} ${oks === 1 ? verbo : verboPlural}.`);
    } else if (oks === 0) {
      toast.error(`Ningún asiento procesado (${errs} con error).`);
    } else {
      toast.warning(`${oks} ${oks === 1 ? verbo : verboPlural}, ${errs} con error.`);
    }
  };

  const onConfirmMover = () => {
    if (!canMover || periodoDestinoId === null) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const result = await moverAsientosDePeriodoAction({ asientoIds: ids, periodoDestinoId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const oks = result.resultados.filter((r) => r.ok).length;
      sumarizar(oks, result.resultados.length - oks, "movido", "movidos");
      const errores = result.resultados.filter((r) => !r.ok);
      if (errores.length > 0) console.warn("mover errores", errores);
      setSelectedIds(new Set());
      setDialog(null);
      router.refresh();
    });
  };

  const onConfirmCambiarFecha = () => {
    if (!canCambiarFecha) return;
    const ids = Array.from(selectedIds);
    const fecha = new Date(`${nuevaFecha}T00:00:00Z`);
    startTransition(async () => {
      const result = await cambiarFechaAsientosAction({ asientoIds: ids, nuevaFecha: fecha });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const oks = result.resultados.filter((r) => r.ok).length;
      sumarizar(oks, result.resultados.length - oks, "actualizado", "actualizados");
      const errores = result.resultados.filter((r) => !r.ok);
      if (errores.length > 0) console.warn("cambiar fecha errores", errores);
      setSelectedIds(new Set());
      setDialog(null);
      router.refresh();
    });
  };

  const onConfirmAutoCorregir = () => {
    if (!canAutoCorregir) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const result = await autoCorrigirFechaAsientosAction({ asientoIds: ids });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const aplicados = result.resultados.filter((r) => r.ok && !r.skipped).length;
      const skippedYa = result.resultados.filter(
        (r) => r.ok && r.skipped && r.skipReason?.startsWith("Fecha ya"),
      ).length;
      const skippedSinFuente = result.resultados.filter(
        (r) => r.ok && r.skipped && r.skipReason?.startsWith("Sin fuente"),
      ).length;
      const errs = result.resultados.filter((r) => !r.ok).length;
      const parts = [`${aplicados} corregido${aplicados === 1 ? "" : "s"}`];
      if (skippedYa > 0) parts.push(`${skippedYa} ya correctos`);
      if (skippedSinFuente > 0) parts.push(`${skippedSinFuente} sin fuente`);
      if (errs > 0) parts.push(`${errs} con error`);
      if (errs > 0 && aplicados === 0) toast.error(parts.join(" · "));
      else if (errs > 0) toast.warning(parts.join(" · "));
      else toast.success(parts.join(" · "));
      const errores = result.resultados.filter((r) => !r.ok);
      if (errores.length > 0) console.warn("auto-corregir errores", errores);
      setSelectedIds(new Set());
      setDialog(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold tabular-nums">{selectedIds.size}</span>{" "}
          <span className="text-muted-foreground">
            de {asientos.length} seleccionado{asientos.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Mover a:</span>
            <Select
              value={periodoDestinoId ? String(periodoDestinoId) : "none"}
              onValueChange={(v) => setPeriodoDestinoId(v === "none" ? null : Number(v))}
            >
              <SelectTrigger className="min-w-56">
                <SelectValue>
                  {(value) => {
                    if (!value || value === "none") return "— Período destino —";
                    const p = destinoOptions.find((x) => String(x.id) === value);
                    return p ? `${p.codigo} · ${p.nombre}` : (value as string);
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Período destino —</SelectItem>
                {destinoOptions.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.codigo} · {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!canMover} onClick={() => setDialog("mover")}>
              Mover período
            </Button>
          </div>

          <div className="flex items-center gap-2 border-l pl-2">
            <span className="text-xs text-muted-foreground">Fecha:</span>
            <Input
              type="date"
              value={nuevaFecha}
              onChange={(e) => setNuevaFecha(e.target.value)}
              className="w-40"
            />
            <Button
              variant="outline"
              disabled={!canCambiarFecha}
              onClick={() => setDialog("cambiar-fecha")}
            >
              Cambiar fecha
            </Button>
          </div>

          <Button
            variant="default"
            disabled={!canAutoCorregir}
            onClick={() => setDialog("auto-corregir")}
          >
            Auto-corregir desde fuente
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto py-0">
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onCheckedChange={(v) => toggleAll(!!v)}
                  aria-label="Seleccionar todos"
                />
              </TableHead>
              <TableHead>N°</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Contexto</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {asientos.map((a) => {
              const checked = selectedIds.has(a.id);
              return (
                <TableRow key={a.id} className={checked ? "bg-primary/5 align-top" : "align-top"}>
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleOne(a.id, !!v)}
                      aria-label={`Seleccionar asiento ${a.numero}`}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-mono text-xs">{a.numero}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant="outline" className="font-mono text-xs">
                      {a.periodoCodigo}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="text-sm tabular-nums">{formatDate(a.fecha)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant="ghost" className="text-xs">
                      {a.origen}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={estadoVariant(a.estado)}>{a.estado}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {a.contexto.etiqueta || "—"}
                  </TableCell>
                  <TableCell>
                    {a.contexto.lineas.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col gap-0.5 text-xs leading-tight">
                        {a.contexto.lineas.map((l, i) => (
                          <span
                            key={`${a.id}-ctx-${i}`}
                            className={i === 0 ? "font-medium" : "text-muted-foreground"}
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block whitespace-normal wrap-break-word">{a.descripcion}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono text-sm tabular-nums">
                    {a.totalDebe}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialog === "mover"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mover {selectedIds.size} asiento{selectedIds.size === 1 ? "" : "s"} de período
            </DialogTitle>
            <DialogDescription>
              Remapea al período <strong>{destinoSeleccionado?.codigo}</strong> (
              {destinoSeleccionado?.nombre}). Se asignará un nuevo número secuencial en destino. Las
              fechas y las líneas no se modifican.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onConfirmMover} disabled={!canMover}>
              {pending ? "Moviendo…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "cambiar-fecha"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cambiar fecha de {selectedIds.size} asiento{selectedIds.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              La nueva fecha será <strong>{nuevaFecha || "(sin fecha)"}</strong>. El período se
              recalcula automáticamente y, si cambia, se renumera en destino. Las líneas no se
              modifican.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onConfirmCambiarFecha} disabled={!canCambiarFecha}>
              {pending ? "Actualizando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "auto-corregir"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Auto-corregir fecha de {selectedIds.size} asiento
              {selectedIds.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription className="flex flex-col gap-2">
              <span>
                Para cada asiento, se lee la fecha de la fuente del dominio según el orden de
                preferencia:
              </span>
              <span className="font-mono text-xs">
                movimiento · compra · venta · gasto · embarqueCosto · despacho · entregaVenta ·
                gastoFijoRegistro · chequeRecibidoCobro (fechaPago)
              </span>
              <span>
                Si la fecha del asiento difiere de la fuente, se actualiza y se recalcula el
                período. Los que ya coinciden, o sin fuente (origen MANUAL/AJUSTE, préstamo,
                embarque), se omiten.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onConfirmAutoCorregir} disabled={!canAutoCorregir}>
              {pending ? "Corrigiendo…" : "Aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
