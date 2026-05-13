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
import { moverAsientosDePeriodoAction } from "@/lib/actions/asientos";
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

export function MoverPeriodoForm({ asientos, periodos, periodoOrigenId }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [periodoDestinoId, setPeriodoDestinoId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  const canSubmit =
    !pending && selectedIds.size > 0 && periodoDestinoId !== null && destinoSeleccionado !== null;

  const onConfirm = () => {
    if (!canSubmit || periodoDestinoId === null) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const result = await moverAsientosDePeriodoAction({
        asientoIds: ids,
        periodoDestinoId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const oks = result.resultados.filter((r) => r.ok).length;
      const errs = result.resultados.length - oks;
      if (errs === 0) {
        toast.success(`${oks} asiento${oks === 1 ? "" : "s"} movido${oks === 1 ? "" : "s"}.`);
      } else if (oks === 0) {
        toast.error(`Ningún asiento se pudo mover (${errs} con error).`);
      } else {
        toast.warning(`${oks} movido${oks === 1 ? "" : "s"}, ${errs} con error.`);
      }
      const errores = result.resultados.filter((r) => !r.ok);
      if (errores.length > 0) {
        console.warn("mover errores", errores);
      }
      setSelectedIds(new Set());
      setConfirmOpen(false);
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
        </div>

        <div className="ml-auto">
          <Button variant="default" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
            Mover{" "}
            {selectedIds.size > 0
              ? `${selectedIds.size} asiento${selectedIds.size === 1 ? "" : "s"}`
              : ""}
          </Button>
        </div>
      </Card>

      <Card className="py-0">
        <Table>
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
              <TableHead>Descripción</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {asientos.map((a) => {
              const checked = selectedIds.has(a.id);
              return (
                <TableRow key={a.id} className={checked ? "bg-primary/5" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleOne(a.id, !!v)}
                      aria-label={`Seleccionar asiento ${a.numero}`}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{a.numero}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {a.periodoCodigo}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm tabular-nums">{formatDate(a.fecha)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[40ch] truncate text-sm">{a.descripcion}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="ghost" className="text-xs">
                      {a.origen}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={estadoVariant(a.estado)}>{a.estado}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {a.totalDebe}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mover {selectedIds.size} asiento{selectedIds.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Los asientos seleccionados serán remapeados al período{" "}
              <strong>{destinoSeleccionado?.codigo}</strong> ({destinoSeleccionado?.nombre}). Se les
              asignará un nuevo número secuencial en el período destino. Las fechas y las líneas no
              se modifican.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onConfirm} disabled={!canSubmit}>
              {pending ? "Moviendo…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
