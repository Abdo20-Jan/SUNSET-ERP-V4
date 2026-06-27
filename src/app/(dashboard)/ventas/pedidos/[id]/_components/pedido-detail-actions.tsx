"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon, CheckmarkCircle02Icon, Invoice01Icon } from "@hugeicons/core-free-icons";

import {
  crearVentaDesdePedidoAction,
  transicionarPedidoVentaAction,
} from "@/lib/actions/pedidos-venta";
import type { PedidoEstado } from "@/generated/prisma/client";
import { MonedaToggle, type Moneda } from "../../../../reportes/_components/moneda-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/*
 * PedidoDetailActions (PR-019) — ilha client del ActionBar del record de Pedido.
 * Reúne lo único interactivo del header: toggle de moneda, transiciones de estado
 * (`transicionarPedidoVentaAction` VERBATIM), conversión a venta
 * (`crearVentaDesdePedidoAction`) y cancelación. Saca "Convertir" y "Cancelar" del
 * Dialog lateral del detalle bespoke (G-04). Espejo de `venta-detail-actions.tsx`.
 */
type Props = {
  pedidoId: number;
  numero: string;
  estado: PedidoEstado;
  moneda: Moneda;
  tcInfo: { valor: string; fecha: string; fuente: string | null } | null;
};

export function PedidoDetailActions({ pedidoId, numero, estado, moneda, tcInfo }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const transicionar = (nuevo: PedidoEstado) => {
    startTransition(async () => {
      const res = await transicionarPedidoVentaAction(pedidoId, nuevo);
      if (res.ok) {
        toast.success(`Pedido marcado como ${nuevo}.`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const convertir = () => {
    startTransition(async () => {
      const res = await crearVentaDesdePedidoAction(pedidoId);
      if (res.ok) {
        toast.success(`Venta ${res.numero} creada en BORRADOR.`);
        router.push(`/ventas/${res.ventaId}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  const esBorrador = estado === "BORRADOR";
  const puedeConfirmar = estado === "ENVIADO" || estado === "PARCIAL";
  const noTerminal = estado !== "COMPLETADO" && estado !== "CANCELADO";

  return (
    <>
      <MonedaToggle current={moneda} tcInfo={tcInfo} />
      {esBorrador && (
        <Button variant="outline" onClick={() => transicionar("ENVIADO")} disabled={isPending}>
          Marcar enviado
        </Button>
      )}
      {puedeConfirmar && (
        <Button variant="outline" onClick={() => transicionar("CONFIRMADO")} disabled={isPending}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
          Confirmar
        </Button>
      )}
      {noTerminal && (
        <>
          <Button variant="outline" onClick={() => transicionar("COMPLETADO")} disabled={isPending}>
            Marcar completado
          </Button>
          <Button onClick={convertir} disabled={isPending}>
            <HugeiconsIcon icon={Invoice01Icon} strokeWidth={2} />
            Convertir a venta
          </Button>
          <CancelarPedidoDialog
            numero={numero}
            disabled={isPending}
            onConfirm={() => transicionar("CANCELADO")}
          />
        </>
      )}
    </>
  );
}

function CancelarPedidoDialog({
  numero,
  disabled,
  onConfirm,
}: {
  numero: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
  };
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} disabled={disabled}>
        <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
        Cancelar pedido
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pedido {numero}</DialogTitle>
            <DialogDescription>
              El pedido pasará a CANCELADO. Las ventas ya creadas siguen vigentes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={disabled}>
              Volver
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={disabled}>
              {disabled ? "Procesando…" : "Cancelar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
