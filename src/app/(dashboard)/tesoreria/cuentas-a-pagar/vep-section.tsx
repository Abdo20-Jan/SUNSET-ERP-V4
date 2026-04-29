"use client";

import { useEffect, useState, useTransition } from "react";
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
  saldoCreditoAduana,
}: {
  veps: VepEmbarque[];
  cuentasBancarias: CuentaBancariaArsOption[];
  saldoCreditoAduana: string;
}) {
  const [pagar, setPagar] = useState<VepEmbarque | null>(null);

  const pendientes = veps.filter((v) => !v.pagado);
  const pagados = veps.filter((v) => v.pagado);

  if (veps.length === 0) return null;

  const saldoCreditoNum = Number(saldoCreditoAduana);
  const tieneCredito = saldoCreditoNum > 0.005;

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

          {tieneCredito && (
            <div className="flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
              <span>
                Crédito a favor Aduana disponible (cuenta 1.1.4.13). Aplicable
                contra cualquier VEP pendiente al momento de pagar.
              </span>
              <span className="font-mono font-semibold tabular-nums">
                ARS {fmtMoney(saldoCreditoAduana)}
              </span>
            </div>
          )}

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
        saldoCreditoAduana={saldoCreditoAduana}
        onClose={() => setPagar(null)}
      />
    </>
  );
}

function PagarVepDialog({
  vep,
  cuentasBancarias,
  saldoCreditoAduana,
  onClose,
}: {
  vep: VepEmbarque | null;
  cuentasBancarias: CuentaBancariaArsOption[];
  saldoCreditoAduana: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [comprobante, setComprobante] = useState<string>("");
  const [referenciaBanco, setReferenciaBanco] = useState<string>("");
  const [montoPagado, setMontoPagado] = useState<string>(vep?.totalArs ?? "");
  const [creditoAplicado, setCreditoAplicado] = useState<string>("0");

  const saldoCreditoNum = Number(saldoCreditoAduana);

  // Reset valores when vep changes
  useEffect(() => {
    if (vep) {
      setMontoPagado(vep.totalArs);
      setCreditoAplicado("0");
    }
  }, [vep]);

  if (!vep) return null;

  const totalNum = Number(vep.totalArs);
  const bancoNum = Number(montoPagado || "0");
  const creditoNum = Number(creditoAplicado || "0");
  const totalPagoNum =
    (Number.isFinite(bancoNum) ? bancoNum : 0) +
    (Number.isFinite(creditoNum) ? creditoNum : 0);
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
      const result = await pagarVepEmbarqueAction({
        embarqueId: vep.embarqueId,
        cuentaBancariaId: cuentaBancariaId || undefined,
        fecha: new Date(fecha + "T12:00:00Z"),
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
        partes.push(
          `saldo pendiente (refuerzo) ARS ${fmtMoney(result.diferencia)}`,
        );
      }
      const msgDiff = partes.length > 0 ? ` · ${partes.join(" · ")}` : "";
      toast.success(
        `VEP registrado — asiento #${result.asientoNumero}${msgDiff}`,
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

          {saldoCreditoNum > 0.005 && (
            <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50/50 p-3 dark:border-emerald-700 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <Label htmlFor="credito-aplicado" className="text-emerald-900 dark:text-emerald-200">
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
                id="credito-aplicado"
                value={creditoAplicado}
                onChange={(e) => setCreditoAplicado(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
              <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                Saldo disponible: <strong>ARS {fmtMoney(saldoCreditoAduana)}</strong>.
                Se descuenta del crédito y reduce lo que tenés que transferir
                al banco.
              </p>
              {creditoExcedido && (
                <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                  Excede el saldo disponible.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="monto-pagado">
              Monto efectivamente pagado al banco
            </Label>
            <Input
              id="monto-pagado"
              value={montoPagado}
              onChange={(e) => setMontoPagado(e.target.value)}
              inputMode="decimal"
              placeholder={vep.totalArs}
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                Total efectivo del pago:{" "}
                <strong className="font-mono">
                  ARS {fmtMoney(totalPagoNum.toFixed(2))}
                </strong>{" "}
                (crédito + banco)
              </span>
              <span>
                Total VEP:{" "}
                <span className="font-mono">ARS {fmtMoney(vep.totalArs)}</span>
              </span>
            </div>
            {tipoDiff === "credito" && (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                Estás pagando <strong>ARS {fmtMoney(diff.toFixed(2))}</strong> de
                más → genera <strong>nuevo crédito a favor de Aduana</strong>{" "}
                (cuenta 1.1.4.13). Aplicable contra próximos despachos.
              </p>
            )}
            {tipoDiff === "deuda" && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                Estás pagando <strong>ARS {fmtMoney(Math.abs(diff).toFixed(2))}</strong>{" "}
                de menos → genera <strong>saldo pendiente con Aduana</strong>{" "}
                (cuenta 2.1.5.99). Tendrás que pagar un VEP de refuerzo.
              </p>
            )}
            {tipoDiff === "exacto" && totalPagoNum > 0 && (
              <p className="text-xs text-muted-foreground">
                Pago exacto al total VEP — no genera crédito ni deuda
                adicional.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="referenciaBanco">
                Referencia banco (opcional)
              </Label>
              <Input
                id="referenciaBanco"
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
