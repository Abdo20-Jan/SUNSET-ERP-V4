"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { pagarVepDespachoAction } from "@/lib/actions/vep-despacho";
import { fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
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

import type { CuentaBancariaArsOption } from "./vep-section";

export type VepDespachoPendiente = {
  id: number;
  despachoId: string;
  despachoCodigo: string;
  despachoFecha: string;
  embarqueId: string;
  embarqueCodigo: string;
  proveedorNombre: string;
  montoTotal: string;
  estado: string;
  createdAt: string;
};

export function VepDespachoSection({
  veps,
  cuentasBancarias,
  defaultFecha,
}: {
  veps: VepDespachoPendiente[];
  cuentasBancarias: CuentaBancariaArsOption[];
  defaultFecha?: string;
}) {
  const [pagar, setPagar] = useState<VepDespachoPendiente | null>(null);

  if (veps.length === 0) return null;

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">VEP / Despacho aduanero (parcial cruzado)</h2>
            <p className="text-xs text-muted-foreground">
              Cada despacho parcial nacionalizado genera su propio VEP con los tributos del
              despacho. Pagalo desde una cuenta bancaria ARS.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Despacho</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead className="text-right">Total ARS</TableHead>
                <TableHead className="w-28 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {veps.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">
                    {v.despachoCodigo}
                    <div className="text-[10px] text-muted-foreground">
                      embarque {v.embarqueCodigo}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{v.proveedorNombre}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {v.despachoFecha.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                    {fmtMoney(v.montoTotal)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => setPagar(v)}
                      disabled={cuentasBancarias.length === 0}
                    >
                      Pagar VEP
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PagarVepDespachoDialog
        vep={pagar}
        cuentasBancarias={cuentasBancarias}
        onClose={() => setPagar(null)}
        defaultFecha={defaultFecha}
      />
    </>
  );
}

function PagarVepDespachoDialog({
  vep,
  cuentasBancarias,
  onClose,
  defaultFecha,
}: {
  vep: VepDespachoPendiente | null;
  cuentasBancarias: CuentaBancariaArsOption[];
  onClose: () => void;
  defaultFecha?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(defaultFecha ?? new Date().toISOString().slice(0, 10));
  const [numeroVep, setNumeroVep] = useState<string>("");
  const [comprobante, setComprobante] = useState<string>("");
  const [referenciaBanco, setReferenciaBanco] = useState<string>("");

  // Reset state cuando cambia el VEP elegido.
  useEffect(() => {
    if (vep) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync ao mudar vep
      setNumeroVep("");
      setComprobante("");
      setReferenciaBanco("");
    }
  }, [vep]);

  if (!vep) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vep) return;
    if (!cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria desde la que se paga.");
      return;
    }

    startTransition(async () => {
      const result = await pagarVepDespachoAction({
        despachoId: vep.despachoId,
        cuentaBancariaId,
        fecha: new Date(`${fecha}T12:00:00Z`),
        numeroVep: numeroVep.trim() || undefined,
        comprobante: comprobante.trim() || undefined,
        referenciaBanco: referenciaBanco.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `VEP del despacho ${vep.despachoCodigo} pagado — asiento #${result.asientoNumero}`,
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={Boolean(vep)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Pagar VEP del despacho {vep.despachoCodigo}</DialogTitle>
          <DialogDescription>
            Cancela los tributos del despacho (2.1.5.x + 2.1.3.x) contra la cuenta bancaria elegida.
            Total: <strong>ARS {fmtMoney(vep.montoTotal)}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Embarque</span>
              <span className="font-mono">{vep.embarqueCodigo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Proveedor</span>
              <span>{vep.proveedorNombre}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-mono font-bold">
              <span>TOTAL</span>
              <span className="tabular-nums">ARS {fmtMoney(vep.montoTotal)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cuenta bancaria ARS</Label>
            <Select value={cuentaBancariaId} onValueChange={(v) => setCuentaBancariaId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar...">
                  {(value) => {
                    if (!value) return "Seleccionar...";
                    const c = cuentasBancarias.find((c) => c.id === value);
                    return c ? `${c.banco}${c.numero ? ` · ${c.numero}` : ""}` : "Seleccionar...";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {cuentasBancarias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {`${c.banco}${c.numero ? ` · ${c.numero}` : ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="vep-despacho-fecha">Fecha</Label>
              <DatePicker id="vep-despacho-fecha" value={fecha} onChange={setFecha} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vep-despacho-numero">Nº VEP (opcional)</Label>
              <Input
                id="vep-despacho-numero"
                value={numeroVep}
                onChange={(e) => setNumeroVep(e.target.value)}
                placeholder="ej: 001556692219"
                maxLength={50}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vep-despacho-comprobante">Comprobante (opcional)</Label>
              <Input
                id="vep-despacho-comprobante"
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
                placeholder="Nº comprobante"
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vep-despacho-ref">Referencia banco (opcional)</Label>
              <Input
                id="vep-despacho-ref"
                value={referenciaBanco}
                onChange={(e) => setReferenciaBanco(e.target.value)}
                placeholder="Cód. Op. del banco"
                maxLength={100}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="ghost" type="button">
                  Cancelar
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
              {isPending ? "Procesando…" : "Confirmar y contabilizar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
