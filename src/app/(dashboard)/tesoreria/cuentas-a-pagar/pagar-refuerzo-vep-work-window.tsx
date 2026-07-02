"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { pagarRefuerzoVepAction } from "@/lib/actions/vep-embarque";
import { fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
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
import { FloatingWorkWindow } from "@/components/record/floating-work-window";

import type { RefuerzoVepPendiente } from "@/lib/services/cuentas-a-pagar";

import type { CuentaBancariaArsOption } from "./vep-section";

/*
 * PagarRefuerzoVepWorkWindow (TES-02 · PR-025b-2) — migra el dialog
 * `PagarRefuerzoVepDialog` de `vep-section.tsx` (mantido en árbol como dead
 * export — rollback) a FloatingWorkWindow (G-04). SÓLO cambia el contenedor
 * (Dialog → FWW; el header pasa a los props `title`/`description`; el
 * `DialogClose` pasa a `Button onClick={onClose}`): el body (crédito Aduana,
 * validaciones, toasts) y la action `pagarRefuerzoVepAction` (CALL, no se
 * modifica) son idénticos — payload byte-idéntico.
 */

export function PagarRefuerzoVepWorkWindow({
  refuerzo,
  cuentasBancarias,
  saldoCreditoAduana,
  onClose,
  defaultFecha,
}: {
  refuerzo: RefuerzoVepPendiente | null;
  cuentasBancarias: CuentaBancariaArsOption[];
  saldoCreditoAduana: string;
  onClose: () => void;
  defaultFecha?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(defaultFecha ?? new Date().toISOString().slice(0, 10));
  const [comprobante, setComprobante] = useState<string>("");
  const [referenciaBanco, setReferenciaBanco] = useState<string>("");
  const [montoBanco, setMontoBanco] = useState<string>(refuerzo?.saldoPendiente ?? "");
  const [creditoAplicado, setCreditoAplicado] = useState<string>("0");

  const saldoCreditoNum = Number(saldoCreditoAduana);

  // TODO(fase-3.4): absorver na extração `<BatchPaymentDialog>` genérico.
  useEffect(() => {
    if (refuerzo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync ao mudar refuerzo
      setMontoBanco(refuerzo.saldoPendiente);
      setCreditoAplicado("0");
    }
  }, [refuerzo]);

  if (!refuerzo) return null;

  const saldoNum = Number(refuerzo.saldoPendiente);
  const bancoNum = Number(montoBanco || "0");
  const creditoNum = Number(creditoAplicado || "0");
  const totalPagoNum =
    (Number.isFinite(bancoNum) ? bancoNum : 0) + (Number.isFinite(creditoNum) ? creditoNum : 0);
  const restante = saldoNum - totalPagoNum;
  const creditoExcedido = creditoNum > saldoCreditoNum + 0.005;
  const totalExcedido = totalPagoNum > saldoNum + 0.005;

  function aplicarCreditoCompleto() {
    if (!refuerzo) return;
    const usar = Math.min(saldoCreditoNum, saldoNum);
    setCreditoAplicado(usar.toFixed(2));
    setMontoBanco(Math.max(0, saldoNum - usar).toFixed(2));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!refuerzo) return;
    if (creditoExcedido) {
      toast.error(
        `Crédito aplicado excede el saldo disponible (ARS ${fmtMoney(saldoCreditoAduana)}).`,
      );
      return;
    }
    if (totalExcedido) {
      toast.error("El total a pagar excede el saldo del refuerzo.");
      return;
    }
    if (creditoNum < saldoNum && !cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria desde la que se paga.");
      return;
    }
    if (totalPagoNum <= 0) {
      toast.error("El pago debe ser mayor a cero.");
      return;
    }

    startTransition(async () => {
      const result = await pagarRefuerzoVepAction({
        embarqueCodigo: refuerzo.embarqueCodigo,
        cuentaBancariaId: cuentaBancariaId || undefined,
        fecha: new Date(`${fecha}T12:00:00Z`),
        comprobante: comprobante.trim() || undefined,
        referenciaBanco: referenciaBanco.trim() || undefined,
        montoBanco: bancoNum.toFixed(2),
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
      if (Number(result.saldoRestante) > 0.005) {
        partes.push(`saldo restante ARS ${fmtMoney(result.saldoRestante)}`);
      }
      const msgExtra = partes.length > 0 ? ` · ${partes.join(" · ")}` : "";
      toast.success(`Refuerzo pagado — asiento #${result.asientoNumero}${msgExtra}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <FloatingWorkWindow
      open={Boolean(refuerzo)}
      onOpenChange={(o) => !o && onClose()}
      title={<>Pagar refuerzo VEP — {refuerzo.embarqueCodigo}</>}
      description={
        <>
          Cancela parte o el total del saldo pendiente con Aduana (cuenta 2.1.5.99). Saldo:{" "}
          <strong>ARS {fmtMoney(refuerzo.saldoPendiente)}</strong>.
        </>
      }
      initialWidth={560}
      initialHeight={620}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {saldoCreditoNum > 0.005 && (
          <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50/50 p-3 dark:border-emerald-700 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between">
              <Label htmlFor="refuerzo-credito" className="text-emerald-900 dark:text-emerald-200">
                Aplicar crédito a favor (1.1.4.13)
              </Label>
              <button
                type="button"
                className="text-xs underline underline-offset-2 text-emerald-800 dark:text-emerald-300"
                onClick={aplicarCreditoCompleto}
              >
                Usar máximo (ARS {fmtMoney(Math.min(saldoCreditoNum, saldoNum).toFixed(2))})
              </button>
            </div>
            <Input
              id="refuerzo-credito"
              value={creditoAplicado}
              onChange={(e) => setCreditoAplicado(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
            <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
              Saldo disponible: <strong>ARS {fmtMoney(saldoCreditoAduana)}</strong>.
            </p>
            {creditoExcedido && (
              <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                Excede el saldo disponible.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="refuerzo-banco">Monto al banco</Label>
          <Input
            id="refuerzo-banco"
            value={montoBanco}
            onChange={(e) => setMontoBanco(e.target.value)}
            inputMode="decimal"
            placeholder={refuerzo.saldoPendiente}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              Total pago:{" "}
              <strong className="font-mono">ARS {fmtMoney(totalPagoNum.toFixed(2))}</strong>
            </span>
            <span>
              {restante > 0.005
                ? `Restante: ARS ${fmtMoney(restante.toFixed(2))}`
                : restante < -0.005
                  ? `Excede en: ARS ${fmtMoney(Math.abs(restante).toFixed(2))}`
                  : "Cubre 100% del saldo"}
            </span>
          </div>
          {totalExcedido && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
              El total a pagar excede el saldo pendiente del refuerzo.
            </p>
          )}
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="refuerzo-fecha">Fecha</Label>
            <DatePicker id="refuerzo-fecha" value={fecha} onChange={setFecha} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refuerzo-comprobante">Nº VEP (opcional)</Label>
            <Input
              id="refuerzo-comprobante"
              value={comprobante}
              onChange={(e) => setComprobante(e.target.value)}
              placeholder="ej: 001556692219"
              maxLength={100}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refuerzo-ref">Referencia banco (opcional)</Label>
            <Input
              id="refuerzo-ref"
              value={referenciaBanco}
              onChange={(e) => setReferenciaBanco(e.target.value)}
              placeholder="Cód. Op. del banco"
              maxLength={100}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            {isPending ? "Procesando…" : "Confirmar y contabilizar"}
          </Button>
        </DialogFooter>
      </form>
    </FloatingWorkWindow>
  );
}
