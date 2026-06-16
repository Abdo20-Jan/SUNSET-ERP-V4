"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { crearEntregaAction } from "@/lib/actions/entregas";

type Pendiente = {
  itemVentaId: number;
  productoCodigo: string;
  productoNombre: string;
  vendido: number;
  entregado: number;
  pendiente: number;
};

type Deposito = { id: string; nombre: string };

export function NuevaEntregaForm({
  ventaId,
  depositos,
  pendientes,
  defaultFecha,
}: {
  ventaId: string;
  depositos: Deposito[];
  pendientes: Pendiente[];
  defaultFecha?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? "");
  const [fecha, setFecha] = useState(defaultFecha ?? new Date().toISOString().slice(0, 10));
  const [observacion, setObservacion] = useState("");
  const [cantidades, setCantidades] = useState<Record<number, number>>(
    Object.fromEntries(pendientes.map((p) => [p.itemVentaId, p.pendiente])),
  );

  const totalAEntregar = pendientes.reduce((acc, p) => acc + (cantidades[p.itemVentaId] ?? 0), 0);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const items = pendientes
      .map((p) => ({ itemVentaId: p.itemVentaId, cantidad: cantidades[p.itemVentaId] ?? 0 }))
      .filter((it) => it.cantidad > 0);

    if (items.length === 0) {
      toast.error("Debe entregar al menos 1 unidad.");
      return;
    }
    if (!depositoId) {
      toast.error("Seleccioná un depósito.");
      return;
    }

    start(async () => {
      const result = await crearEntregaAction({
        ventaId,
        depositoId,
        fecha: new Date(fecha),
        observacion: observacion.trim() || undefined,
        items,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Remito ${result.data.numero} creado (BORRADOR). Confirmalo para despachar.`);
      router.push(`/ventas/${ventaId}/entregas`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">Depósito</Label>
            <Select value={depositoId} onValueChange={(v) => setDepositoId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar depósito" />
              </SelectTrigger>
              <SelectContent>
                {depositos.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fecha" className="text-xs uppercase tracking-wide">
              Fecha
            </Label>
            <Input
              id="fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="observacion" className="text-xs uppercase tracking-wide">
              Observación
            </Label>
            <Textarea
              id="observacion"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <Table>
          <caption className="sr-only">Items pendientes de entrega</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Vendido</TableHead>
              <TableHead className="text-right">Entregado</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
              <TableHead className="text-right">A entregar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendientes.map((p) => (
              <TableRow key={p.itemVentaId}>
                <TableCell>
                  <div className="font-mono text-xs text-muted-foreground">{p.productoCodigo}</div>
                  <div>{p.productoNombre}</div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{p.vendido}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{p.entregado}</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {p.pendiente}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={0}
                    max={p.pendiente}
                    value={cantidades[p.itemVentaId] ?? 0}
                    onChange={(e) =>
                      setCantidades((cur) => ({
                        ...cur,
                        [p.itemVentaId]: Math.max(0, Math.min(p.pendiente, Number(e.target.value))),
                      }))
                    }
                    className="ml-auto w-20 text-right"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || totalAEntregar === 0}>
          {pending ? "Guardando…" : "Crear entrega (BORRADOR)"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancelar
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {totalAEntregar} unidad(es) a entregar
        </span>
      </div>
    </form>
  );
}
