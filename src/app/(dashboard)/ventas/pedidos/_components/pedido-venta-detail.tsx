"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Decimal from "decimal.js";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Invoice01Icon,
} from "@hugeicons/core-free-icons";

import {
  crearVentaDesdePedidoAction,
  transicionarPedidoVentaAction,
  type PedidoVentaDetalle,
} from "@/lib/actions/pedidos-venta";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PedidoEstado } from "@/generated/prisma/client";

type Props = {
  pedido: PedidoVentaDetalle;
  clienteNombre: string;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  ventasVinculadas: Array<{ id: string; numero: string; estado: string }>;
};

function estadoVariant(
  estado: PedidoEstado,
): "default" | "outline" | "secondary" | "destructive" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "ENVIADO":
    case "CONFIRMADO":
      return "default";
    case "PARCIAL":
    case "COMPLETADO":
      return "secondary";
    case "CANCELADO":
      return "destructive";
  }
}

export function PedidoVentaDetail({
  pedido,
  clienteNombre,
  productosMap,
  ventasVinculadas,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const total = pedido.items
    .reduce(
      (acc, it) => acc.plus(new Decimal(it.precioUnitario).times(it.cantidad)),
      new Decimal(0),
    )
    .toDecimalPlaces(2);

  const editable = pedido.estado === "BORRADOR" || pedido.estado === "ENVIADO";
  const facturable =
    pedido.estado !== "CANCELADO" && pedido.estado !== "COMPLETADO";

  const handleTransicion = (estado: PedidoEstado) => {
    startTransition(async () => {
      const res = await transicionarPedidoVentaAction(pedido.id, estado);
      if (res.ok) {
        toast.success(`Pedido marcado como ${estado}.`);
        setConfirmCancel(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleCrearFactura = () => {
    startTransition(async () => {
      const res = await crearVentaDesdePedidoAction(pedido.id);
      if (res.ok) {
        toast.success(`Venta ${res.numero} creada en BORRADOR.`);
        router.push(`/ventas/${res.ventaId}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight">
              Pedido {pedido.numero}
            </h1>
            <Badge variant={estadoVariant(pedido.estado)}>{pedido.estado}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {clienteNombre} · {fmtDate(new Date(pedido.fecha))} ·{" "}
            {pedido.items.length} ítem{pedido.items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pedido.estado === "BORRADOR" && (
            <Button
              variant="outline"
              onClick={() => handleTransicion("ENVIADO")}
              disabled={isPending}
            >
              Marcar enviado
            </Button>
          )}
          {(pedido.estado === "ENVIADO" || pedido.estado === "PARCIAL") && (
            <Button
              variant="outline"
              onClick={() => handleTransicion("CONFIRMADO")}
              disabled={isPending}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
              Confirmar
            </Button>
          )}
          {pedido.estado !== "COMPLETADO" && pedido.estado !== "CANCELADO" && (
            <Button
              variant="outline"
              onClick={() => handleTransicion("COMPLETADO")}
              disabled={isPending}
            >
              Marcar completado
            </Button>
          )}
          {facturable && (
            <Button
              variant="default"
              onClick={handleCrearFactura}
              disabled={isPending}
            >
              <HugeiconsIcon icon={Invoice01Icon} strokeWidth={2} />
              Crear factura desde pedido
            </Button>
          )}
          {pedido.estado !== "CANCELADO" && pedido.estado !== "COMPLETADO" && (
            <Button
              variant="destructive"
              onClick={() => setConfirmCancel(true)}
              disabled={isPending}
            >
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
              Cancelar pedido
            </Button>
          )}
          {editable && (
            <Link
              href={`/ventas/pedidos/${pedido.id}?editar=1`}
              className={buttonVariants({ variant: "outline" })}
            >
              Editar
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Fecha" value={fmtDate(new Date(pedido.fecha))} />
        <Stat
          label="Fecha prevista"
          value={
            pedido.fechaPrevista
              ? fmtDate(new Date(pedido.fechaPrevista))
              : "—"
          }
        />
        <Stat
          label="Total estimado"
          value={`${fmtMoney(total.toString())} ${pedido.moneda}`}
          emphasis
        />
      </div>

      <Card className="py-0">
        <Table>
          <caption className="sr-only">Ítems del pedido {pedido.numero}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">P. unit.</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedido.items.map((it) => {
              const p = productosMap[it.productoId];
              const sub = new Decimal(it.precioUnitario)
                .times(it.cantidad)
                .toDecimalPlaces(2);
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    {p ? (
                      <span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.codigo}
                        </span>{" "}
                        {p.nombre}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {it.cantidad}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(it.precioUnitario)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(sub.toString())}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {pedido.observaciones && (
        <Card>
          <CardContent>
            <Label>Observaciones</Label>
            <p className="text-sm">{pedido.observaciones}</p>
          </CardContent>
        </Card>
      )}

      {ventasVinculadas.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Facturas creadas desde este pedido
            </h2>
            <div className="flex flex-wrap gap-2">
              {ventasVinculadas.map((v) => (
                <Link
                  key={v.id}
                  href={`/ventas/${v.id}`}
                  className="inline-flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1 text-sm hover:bg-muted/40"
                >
                  <span className="font-mono">{v.numero}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {v.estado}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirmCancel(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pedido {pedido.numero}</DialogTitle>
            <DialogDescription>
              El pedido pasará a CANCELADO. Las ventas ya creadas siguen
              vigentes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCancel(false)}
              disabled={isPending}
            >
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleTransicion("CANCELADO")}
              disabled={isPending}
            >
              {isPending ? "Procesando…" : "Cancelar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={
            emphasis
              ? "font-mono text-xl font-semibold tabular-nums"
              : "text-base"
          }
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
