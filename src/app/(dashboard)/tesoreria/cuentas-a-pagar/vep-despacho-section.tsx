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
  saldoCreditoAduana,
  defaultFecha,
}: {
  veps: VepDespachoPendiente[];
  cuentasBancarias: CuentaBancariaArsOption[];
  saldoCreditoAduana: string;
  defaultFecha?: string;
}) {
  const [pagar, setPagar] = useState<VepDespachoPendiente | null>(null);

  if (veps.length === 0) return null;

  const saldoCreditoNum = Number(saldoCreditoAduana);
  const tieneCredito = saldoCreditoNum > 0.005;

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">VEP / Despacho aduanero (parcial cruzado)</h2>
            <p className="text-xs text-muted-foreground">
              Cada despacho parcial nacionalizado genera su propio VEP con los tributos del
              despacho. Pagalo desde una cuenta bancaria ARS — podés ajustar el monto y aplicar
              crédito a favor de Aduana (1.1.4.13) si lo tenés.
            </p>
          </div>

          {tieneCredito && (
            <div className="flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
              <span>
                Crédito a favor Aduana disponible (cuenta 1.1.4.13). Aplicable contra cualquier VEP
                pendiente al momento de pagar.
              </span>
              <span className="font-mono font-semibold tabular-nums">
                ARS {fmtMoney(saldoCreditoAduana)}
              </span>
            </div>
          )}

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
        saldoCreditoAduana={saldoCreditoAduana}
        onClose={() => setPagar(null)}
        defaultFecha={defaultFecha}
      />
    </>
  );
}

function PagarVepDespachoDialog({
  vep,
  cuentasBancarias,
  saldoCreditoAduana,
  onClose,
  defaultFecha,
}: {
  vep: VepDespachoPendiente | null;
  cuentasBancarias: CuentaBancariaArsOption[];
  saldoCreditoAduana: string;
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
  const [montoPagado, setMontoPagado] = useState<string>(vep?.montoTotal ?? "");
  const [creditoAplicado, setCreditoAplicado] = useState<string>("0");

  const saldoCreditoNum = Number(saldoCreditoAduana);

  // Reset state cuando cambia el VEP elegido.
  useEffect(() => {
    if (vep) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync ao mudar vep
      setNumeroVep("");
      setComprobante("");
      setReferenciaBanco("");
      setMontoPagado(vep.montoTotal);
      setCreditoAplicado("0");
    }
  }, [vep]);

  if (!vep) return null;

  const totalNum = Number(vep.montoTotal);
  const bancoNum = Number(montoPagado || "0");
  const creditoNum = Number(creditoAplicado || "0");
  const totalPagoNum =
    (Number.isFinite(bancoNum) ? bancoNum : 0) + (Number.isFinite(creditoNum) ? creditoNum : 0);
  const diff = totalPagoNum - totalNum;
  const tipoDiff: "credito" | "deuda" | "exacto" =
    Math.abs(diff) < 0.005 ? "exacto" : diff > 0 ? "credito" : "deuda";

  const creditoExcedido = creditoNum > saldoCreditoNum + 0.005;

  function aplicarCreditoCompleto() {
    if (!vep) return;
    const usar = Math.min(saldoCreditoNum, totalNum);
    setCreditoAplicado(usar.toFixed(2));
    setMontoPagado(Math.max(0, totalNum - usar).toFixed(2));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vep) return;
    if (creditoExcedido) {
      toast.error(
        `Crédito aplicado excede el saldo disponible (ARS ${fmtMoney(saldoCreditoAduana)}).`,
      );
      return;
    }
    if (creditoNum < totalNum && !cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria desde la que se paga.");
      return;
    }
    if (!Number.isFinite(totalPagoNum) || totalPagoNum <= 0) {
      toast.error("El pago debe ser mayor a cero.");
      return;
    }

    startTransition(async () => {
      const result = await pagarVepDespachoAction({
        despachoId: vep.despachoId,
        cuentaBancariaId: cuentaBancariaId || undefined,
        fecha: new Date(`${fecha}T12:00:00Z`),
        numeroVep: numeroVep.trim() || undefined,
        comprobante: comprobante.trim() || undefined,
        referenciaBanco: referenciaBanco.trim() || undefined,
        montoPagado: bancoNum.toFixed(2),
        creditoAplicado: creditoNum > 0 ? creditoNum.toFixed(2) : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const partes: string[] = [];
      if (Number(result.creditoAplicado) > 0) {
        partes.push(`crédito aplicado ARS ${fmtMoney(result.creditoAplicado)}`);
      }
      if (result.tipoDiferencia === "credito") {
        partes.push(`nueva diferencia a favor ARS ${fmtMoney(result.diferencia)}`);
      } else if (result.tipoDiferencia === "deuda") {
        partes.push(`saldo pendiente (refuerzo) ARS ${fmtMoney(result.diferencia)}`);
      }
      const msgDiff = partes.length > 0 ? ` · ${partes.join(" · ")}` : "";
      toast.success(
        `VEP del despacho ${vep.despachoCodigo} pagado — asiento #${result.asientoNumero}${msgDiff}`,
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
            <Label>Cuenta bancaria de débito (opcional si 100% crédito)</Label>
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

          {saldoCreditoNum > 0.005 && (
            <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50/50 p-3 dark:border-emerald-700 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="vep-despacho-credito"
                  className="text-emerald-900 dark:text-emerald-200"
                >
                  Aplicar crédito a favor (1.1.4.13)
                </Label>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 text-emerald-800 dark:text-emerald-300"
                  onClick={aplicarCreditoCompleto}
                >
                  Usar máximo (ARS {fmtMoney(Math.min(saldoCreditoNum, totalNum).toFixed(2))})
                </button>
              </div>
              <Input
                id="vep-despacho-credito"
                value={creditoAplicado}
                onChange={(e) => setCreditoAplicado(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
              <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                Saldo disponible: <strong>ARS {fmtMoney(saldoCreditoAduana)}</strong>. Se descuenta
                del crédito y reduce lo que tenés que transferir al banco.
              </p>
              {creditoExcedido && (
                <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                  Excede el saldo disponible.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="vep-despacho-monto">Monto efectivamente pagado al banco</Label>
            <Input
              id="vep-despacho-monto"
              value={montoPagado}
              onChange={(e) => setMontoPagado(e.target.value)}
              inputMode="decimal"
              placeholder={vep.montoTotal}
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                Total efectivo del pago:{" "}
                <strong className="font-mono">ARS {fmtMoney(totalPagoNum.toFixed(2))}</strong>{" "}
                (crédito + banco)
              </span>
              <span>
                Total VEP: <span className="font-mono">ARS {fmtMoney(vep.montoTotal)}</span>
              </span>
            </div>
            {tipoDiff === "credito" && (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                Estás pagando <strong>ARS {fmtMoney(diff.toFixed(2))}</strong> de más → genera{" "}
                <strong>nuevo crédito a favor de Aduana</strong> (cuenta 1.1.4.13). Aplicable contra
                próximos despachos.
              </p>
            )}
            {tipoDiff === "deuda" && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                Estás pagando <strong>ARS {fmtMoney(Math.abs(diff).toFixed(2))}</strong> de menos →
                genera <strong>saldo pendiente con Aduana</strong> (cuenta 2.1.5.99). Tendrás que
                pagar un VEP de refuerzo.
              </p>
            )}
            {tipoDiff === "exacto" && totalPagoNum > 0 && (
              <p className="text-xs text-muted-foreground">
                Pago exacto al total VEP — no genera crédito ni deuda adicional.
              </p>
            )}
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
