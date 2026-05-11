"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  anularVentasMasivoAction,
  type VentaParaRecalculoRow,
} from "@/lib/actions/admin-percepcion-iibb";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export function RecalculoPercepcionPanel({
  ventas,
}: {
  ventas: VentaParaRecalculoRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [razon, setRazon] = useState("");
  const [isAnulando, startAnular] = useTransition();
  const [resultado, setResultado] = useState<{
    anuladas: number;
    fallidas: { id: string; numero: string; error: string }[];
  } | null>(null);

  const onConfirmar = () => {
    if (confirmacion !== "ANULAR") {
      toast.error("Tipea ANULAR para confirmar.");
      return;
    }
    if (razon.trim().length < 10) {
      toast.error("La razón debe tener al menos 10 caracteres.");
      return;
    }
    startAnular(async () => {
      const r = await anularVentasMasivoAction({ confirmacion, razon });
      if (r.ok) {
        setResultado({ anuladas: r.anuladas, fallidas: r.fallidas });
        setOpen(false);
        setConfirmacion("");
        setRazon("");
        toast.success(
          `${r.anuladas} venda(s) anulada(s)${r.fallidas.length > 0 ? `; ${r.fallidas.length} falló` : ""}.`,
        );
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-sm text-muted-foreground">
          {ventas.length} venda{ventas.length === 1 ? "" : "s"} EMITIDA
          {ventas.length === 1 ? "" : "s"} candidata
          {ventas.length === 1 ? "" : "s"} a recálculo.
        </p>
        <Button
          variant="destructive"
          disabled={ventas.length === 0 || isAnulando}
          onClick={() => setOpen(true)}
        >
          {isAnulando ? "Anulando…" : "Anular todas para recalcular"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Número</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-center">Cheques activos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ventas.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                No hay vendas EMITIDAS para anular.
              </TableCell>
            </TableRow>
          ) : (
            ventas.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-xs">{v.numero}</TableCell>
                <TableCell className="font-mono text-xs">{v.fecha}</TableCell>
                <TableCell>{v.clienteNombre}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {v.total}
                </TableCell>
                <TableCell className="text-center text-sm">{v.chequesActivos}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {resultado && (
        <div className="border-t p-4">
          <h3 className="text-sm font-semibold">Resultado de la operación</h3>
          <p className="text-sm text-muted-foreground">
            {resultado.anuladas} venda(s) anulada(s).
            {resultado.fallidas.length > 0 ? (
              <>
                {" "}
                <span className="text-rose-700">{resultado.fallidas.length} fallaron:</span>
                <ul className="mt-2 ml-4 list-disc text-xs">
                  {resultado.fallidas.map((f) => (
                    <li key={f.id}>
                      <span className="font-mono">{f.numero}</span> — {f.error}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </p>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !isAnulando) {
            setOpen(false);
            setConfirmacion("");
            setRazon("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular {ventas.length} venda(s) EMITIDA(s)</DialogTitle>
            <DialogDescription>
              Operación irreversible. Reverte asientos contables, libera reservas de stock y anula
              cheques recibidos. Las vendas pasarán a estado CANCELADA y deberán ser recreadas
              manualmente con autocálculo de Percepción IIBB.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmacion">
                Tipea <span className="font-mono font-semibold">ANULAR</span> para confirmar
              </Label>
              <Input
                id="confirmacion"
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                placeholder="ANULAR"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="razon">Razón (mín. 10 caracteres)</Label>
              <Textarea
                id="razon"
                value={razon}
                onChange={(e) => setRazon(e.target.value)}
                placeholder="Ej: Recálculo de Percepción IIBB tras deploy del autocálculo por provincia."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isAnulando}
            >
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirmar} disabled={isAnulando}>
              {isAnulando ? "Anulando…" : `Anular ${ventas.length} venda(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
