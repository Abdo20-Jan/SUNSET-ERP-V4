"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { pagarVepEmbarqueAction } from "@/lib/actions/vep-embarque";
import { fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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

import type { VepEmbarque } from "@/lib/services/cuentas-a-pagar";

export type CuentaBancariaArsOption = {
  id: string;
  banco: string;
  numero: string | null;
};

export function VepSection({
  veps,
  cuentasBancarias,
}: {
  veps: VepEmbarque[];
  cuentasBancarias: CuentaBancariaArsOption[];
}) {
  const [pagar, setPagar] = useState<VepEmbarque | null>(null);

  const pendientes = veps.filter((v) => !v.pagado);
  const pagados = veps.filter((v) => v.pagado);

  if (veps.length === 0) return null;

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">
              VEP / Despacho aduanero por embarque
            </h2>
            <p className="text-xs text-muted-foreground">
              Cada embarque CERRADO genera un VEP que agrupa todos los tributos
              aduaneros (DIE, Tasa, IVA imp, IIBB, Ganancias, etc). Pagá el VEP
              completo con un único movimiento contable.
            </p>
          </div>

          {pendientes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Embarque</TableHead>
                  <TableHead>Tributos</TableHead>
                  <TableHead className="text-right">Total VEP (ARS)</TableHead>
                  <TableHead className="w-32 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendientes.map((v) => (
                  <TableRow key={v.embarqueId}>
                    <TableCell className="font-mono text-xs">
                      {v.embarqueCodigo}
                      {v.asientoNumero ? (
                        <div className="text-[10px] text-muted-foreground">
                          asiento #{v.asientoNumero}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {v.cuentas.map((c) => (
                          <span
                            key={c.cuentaId}
                            className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-0.5 text-[11px]"
                          >
                            <span className="font-mono">{c.cuentaCodigo}</span>
                            <span className="tabular-nums">
                              {fmtMoney(c.monto)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                      {fmtMoney(v.totalArs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => setPagar(v)}
                        disabled={cuentasBancarias.length === 0}
                      >
                        Pagar VEP completo
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {pagados.length > 0 && (
            <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                {pagados.length} VEP{pagados.length === 1 ? "" : "s"} ya pagado
                {pagados.length === 1 ? "" : "s"}
              </summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Embarque</TableHead>
                    <TableHead className="text-right">Total ARS</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagados.map((v) => (
                    <TableRow key={v.embarqueId}>
                      <TableCell className="font-mono text-xs">
                        {v.embarqueCodigo}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtMoney(v.totalArs)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="default" className="bg-emerald-600">
                          Pagado
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          )}
        </CardContent>
      </Card>

      <PagarVepDialog
        vep={pagar}
        cuentasBancarias={cuentasBancarias}
        onClose={() => setPagar(null)}
      />
    </>
  );
}

function PagarVepDialog({
  vep,
  cuentasBancarias,
  onClose,
}: {
  vep: VepEmbarque | null;
  cuentasBancarias: CuentaBancariaArsOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [comprobante, setComprobante] = useState<string>("");

  if (!vep) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vep) return;
    if (!cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria desde la que se paga.");
      return;
    }

    startTransition(async () => {
      const result = await pagarVepEmbarqueAction({
        embarqueId: vep.embarqueId,
        cuentaBancariaId,
        fecha: new Date(fecha + "T12:00:00Z"),
        comprobante: comprobante.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `VEP pagado — asiento #${result.asientoNumero} · ARS ${result.total}`,
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={Boolean(vep)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Pagar VEP del embarque {vep.embarqueCodigo}</DialogTitle>
          <DialogDescription>
            Genera un único asiento contable con DEBE en cada cuenta tributaria
            y HABER en el banco. Total: <strong>ARS {fmtMoney(vep.totalArs)}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <p className="mb-1 font-semibold">Detalle del VEP:</p>
            <ul className="space-y-0.5">
              {vep.cuentas.map((c) => (
                <li
                  key={c.cuentaId}
                  className="flex justify-between font-mono"
                >
                  <span>
                    {c.cuentaCodigo} {c.cuentaNombre}
                  </span>
                  <span className="tabular-nums">{fmtMoney(c.monto)}</span>
                </li>
              ))}
              <li className="mt-1 flex justify-between border-t pt-1 font-mono font-bold">
                <span>TOTAL</span>
                <span className="tabular-nums">
                  ARS {fmtMoney(vep.totalArs)}
                </span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cuenta bancaria de débito</Label>
            <Select
              value={cuentaBancariaId}
              onValueChange={(v) => setCuentaBancariaId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar...">
                  {(value) => {
                    if (!value) return "Seleccionar...";
                    const c = cuentasBancarias.find((c) => c.id === value);
                    return c
                      ? `${c.banco}${c.numero ? ` · ${c.numero}` : ""}`
                      : "Seleccionar...";
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
              <Label htmlFor="fecha">Fecha</Label>
              <Input
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="comprobante">Nº VEP (opcional)</Label>
              <Input
                id="comprobante"
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
                placeholder="ej: 001556692219"
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
