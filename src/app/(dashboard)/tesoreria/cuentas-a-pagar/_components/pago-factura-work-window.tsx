"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { fmtMoney } from "@/lib/format";
import {
  crearMovimientoTesoreriaAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import {
  simularRetencionGananciasAction,
  type SimulacionRetencion,
} from "@/lib/actions/retenciones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConceptoRG830 } from "@/generated/prisma/client";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";

import {
  CONCEPTO_LABEL,
  CONCEPTO_VALUES,
  type FacturaConProveedor,
  ORIGEN_BADGE,
  ORIGEN_LABEL,
  facturaKey,
  sumarMontos,
  todayIso,
} from "./pago-por-factura";

/*
 * PagoFacturaWorkWindow (TES-02 · PR-025b-2) — migra el dialog
 * `PagoFacturaDialog` de `pago-por-factura.tsx` (mantido en árbol como dead
 * export — rollback) a FloatingWorkWindow (G-04). SÓLO cambia el contenedor
 * (Dialog → FWW; el header pasa a los props `title`/`description`, con
 * null-guard `proveedor?.` porque los props se evalúan también con la ventana
 * cerrada): el body (multi-facturas, retención RG 830 preview/manual,
 * validaciones, toasts) y las actions `crearMovimientoTesoreriaAction` /
 * `simularRetencionGananciasAction` (CALL, no se modifican) son idénticos —
 * payloads byte-idénticos.
 */

export function PagoFacturaWorkWindow({
  open,
  facturas,
  cuentasBancarias,
  onClose,
  onPaid,
  defaultFecha,
  retencionEnabled = false,
}: {
  open: boolean;
  facturas: FacturaConProveedor[];
  cuentasBancarias: CuentaBancariaOption[];
  onClose: () => void;
  onPaid: () => void;
  defaultFecha?: string;
  retencionEnabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(defaultFecha ?? todayIso());
  const [comprobante, setComprobante] = useState<string>("");
  const [referenciaBanco, setReferenciaBanco] = useState<string>("");
  const [montoEditable, setMontoEditable] = useState<string>("");
  const [retencion, setRetencion] = useState<SimulacionRetencion | null>(null);
  // Retención manual: el usuario decide aplicarla y carga el importe a mano.
  const [retManualOn, setRetManualOn] = useState(false);
  const [retConcepto, setRetConcepto] = useState<ConceptoRG830>("BIENES_DE_CAMBIO");
  const [retImporte, setRetImporte] = useState<string>("");

  const sumaFacturas = useMemo(() => sumarMontos(facturas), [facturas]);
  const proveedor = facturas[0] ?? null;
  const moneda = facturas[0]?.moneda ?? "ARS";
  const isMulti = facturas.length > 1;
  const baseRetencion = isMulti ? sumaFacturas : montoEditable;

  const retImporteValido =
    retManualOn && /^\d+(\.\d{1,2})?$/.test(retImporte) && Number(retImporte) > 0;
  const netoManual = useMemo(() => {
    const b = Number(baseRetencion);
    const r = Number(retImporte);
    if (!Number.isFinite(b) || !Number.isFinite(r) || r <= 0) return baseRetencion || "0";
    return Math.max(0, b - r).toFixed(2);
  }, [baseRetencion, retImporte]);

  // Preview de retención Ganancias (RG 830). El backend decide si aplica
  // (flag + proveedor sujeto + concepto + mínimo mensual); acá sólo se
  // muestra para que el usuario no la olvide antes de confirmar.
  useEffect(() => {
    const cuentaId = proveedor?.cuentaContableId;
    if (!open || !cuentaId || moneda !== "ARS" || !/^\d+(\.\d{1,2})?$/.test(baseRetencion)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia el preview cuando no aplica
      setRetencion(null);
      return;
    }
    let cancelled = false;
    void simularRetencionGananciasAction({
      cuentaContableId: cuentaId,
      fecha: new Date(fecha),
      base: baseRetencion,
    }).then((r) => {
      if (!cancelled) setRetencion(r);
    });
    return () => {
      cancelled = true;
    };
  }, [open, proveedor, moneda, baseRetencion, fecha]);

  // Reset monto editable cuando cambia la selección al abrir.
  // TODO(fase-3.4): absorver na extração `<BatchPaymentDialog>` genérico.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync, refactor pendente na extração
    if (open && !isMulti && proveedor) setMontoEditable(proveedor.monto);
  }, [open, isMulti, proveedor]);

  const reset = () => {
    setCuentaBancariaId("");
    setFecha(defaultFecha ?? todayIso());
    setComprobante("");
    setReferenciaBanco("");
    setMontoEditable("");
    setRetencion(null);
    setRetManualOn(false);
    setRetConcepto("BIENES_DE_CAMBIO");
    setRetImporte("");
  };

  const toggleRetManual = (on: boolean) => {
    setRetManualOn(on);
    // Al prender, si el cálculo automático RG 830 aplica, pre-cargar su
    // importe como sugerencia editable. Si no, queda en blanco.
    if (on && retImporte === "" && retencion?.aplica) {
      setRetImporte(retencion.importeRetenido);
    }
  };

  const handleSubmit = () => {
    if (!proveedor?.cuentaContableId) {
      toast.error("Falta cuenta contable del proveedor.");
      return;
    }
    if (!cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria.");
      return;
    }
    if (!isMulti) {
      const m = Number(montoEditable);
      if (!Number.isFinite(m) || m <= 0) {
        toast.error("Monto inválido.");
        return;
      }
    }

    startTransition(async () => {
      const lineas = isMulti
        ? facturas.map((f) => ({
            cuentaContableId: proveedor.cuentaContableId!,
            monto: f.monto,
            descripcion: `Pago factura ${f.numero} — ${f.proveedorNombre}`,
          }))
        : [
            {
              cuentaContableId: proveedor.cuentaContableId!,
              monto: montoEditable,
              descripcion: `Pago factura ${proveedor.numero} — ${proveedor.proveedorNombre}`,
            },
          ];

      const descripcion = isMulti
        ? `Pago ${facturas.length} facturas — ${proveedor.proveedorNombre}`
        : `Pago factura ${proveedor.numero}`;

      const r = await crearMovimientoTesoreriaAction({
        tipo: "PAGO",
        cuentaBancariaId,
        fecha: new Date(fecha),
        moneda: moneda as "ARS" | "USD",
        tipoCambio: "1",
        lineas,
        descripcion: descripcion.slice(0, 255),
        comprobante: comprobante || undefined,
        referenciaBanco: referenciaBanco || undefined,
        retencionGananciasManual:
          moneda === "ARS" && retImporteValido
            ? { importeRetenido: retImporte, concepto: retConcepto }
            : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Pago registrado — Asiento Nº ${r.asientoNumero}`);
      reset();
      onPaid();
    });
  };

  return (
    <FloatingWorkWindow
      open={open && proveedor !== null}
      onOpenChange={(o) => {
        if (!o && !pending) {
          reset();
          onClose();
        }
      }}
      title={
        isMulti ? `Pagar ${facturas.length} facturas` : `Pagar factura ${proveedor?.numero ?? ""}`
      }
      description={
        proveedor && (
          <>
            {proveedor.proveedorNombre}
            {!isMulti && <> — {ORIGEN_LABEL[proveedor.origen]}</>}
            {" · "}Total{" "}
            <span className="font-mono">
              {fmtMoney(sumaFacturas)} {moneda}
            </span>
          </>
        )
      }
      initialWidth={560}
      initialHeight={640}
    >
      {proveedor && (
        <div className="flex flex-col gap-6">
          {isMulti && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <ul className="flex flex-col gap-1">
                {facturas.map((f) => (
                  <li key={facturaKey(f)} className="flex justify-between gap-2">
                    <span>
                      <Badge
                        variant="outline"
                        className="mr-1.5 text-[10px] uppercase"
                        title={ORIGEN_LABEL[f.origen]}
                      >
                        {ORIGEN_BADGE[f.origen]}
                      </Badge>
                      <span className="font-mono">{f.numero}</span>
                    </span>
                    <span className="font-mono tabular-nums">{fmtMoney(f.monto)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-cuenta">Cuenta bancaria / caja</Label>
              <Select value={cuentaBancariaId} onValueChange={(v) => setCuentaBancariaId(v ?? "")}>
                <SelectTrigger id="pf-cuenta" className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {cuentasBancarias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.banco} · {c.moneda}
                      {c.numero ? ` (${c.numero})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pf-fecha">Fecha</Label>
                <DatePicker id="pf-fecha" value={fecha} onChange={setFecha} max={todayIso()} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pf-monto">Monto ({moneda})</Label>
                <Input
                  id="pf-monto"
                  inputMode="decimal"
                  value={isMulti ? sumaFacturas : montoEditable}
                  onChange={(e) => setMontoEditable(e.target.value)}
                  disabled={isMulti}
                />
              </div>
            </div>

            {retencionEnabled && moneda === "ARS" && (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={retManualOn}
                    onChange={(e) => toggleRetManual(e.target.checked)}
                  />
                  Aplicar retención de Ganancias (RG 830)
                </label>
                {retManualOn && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="pf-ret-concepto">Concepto</Label>
                        <Select
                          value={retConcepto}
                          onValueChange={(v) => setRetConcepto(v as ConceptoRG830)}
                        >
                          <SelectTrigger id="pf-ret-concepto" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONCEPTO_VALUES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {CONCEPTO_LABEL[c]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="pf-ret-importe">Importe retenido ({moneda})</Label>
                        <Input
                          id="pf-ret-importe"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={retImporte}
                          onChange={(e) => setRetImporte(e.target.value)}
                        />
                      </div>
                    </div>
                    {retencion?.aplica && (
                      <p className="text-[11px] text-muted-foreground">
                        Sugerido RG 830:{" "}
                        <button
                          type="button"
                          className="underline underline-offset-2"
                          onClick={() => setRetImporte(retencion.importeRetenido)}
                        >
                          {fmtMoney(retencion.importeRetenido)} {moneda}
                        </button>{" "}
                        ({retencion.alicuota}%).
                      </p>
                    )}
                    <div className="flex justify-between gap-2 border-t pt-1.5 text-sm font-medium">
                      <span>Neto a pagar al proveedor</span>
                      <span className="font-mono tabular-nums">
                        {fmtMoney(netoManual)} {moneda}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Se paga el neto; la retención queda como pasivo a depositar (cta. 2.1.3.07)
                      con su certificado.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!retManualOn && retencion?.aplica && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Retención Ganancias (RG 830)
                </div>
                <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Total factura</span>
                    <span className="font-mono tabular-nums">
                      {fmtMoney(retencion.base)} {moneda}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Retención ({retencion.alicuota}%)</span>
                    <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      − {fmtMoney(retencion.importeRetenido)} {moneda}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2 border-t pt-1 font-medium">
                    <span>Neto a pagar al proveedor</span>
                    <span className="font-mono tabular-nums">
                      {fmtMoney(retencion.importeNetoAPagar)} {moneda}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>Vencimiento depósito ARCA</span>
                    <span className="font-mono">{retencion.fechaVencimientoArca}</span>
                  </li>
                </ul>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Se paga el neto, y la retención queda como pasivo a depositar (cta. 2.1.3.07) con
                  su certificado.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pf-comprobante">Comprobante (opcional)</Label>
                <Input
                  id="pf-comprobante"
                  placeholder="Cheque Nº / Factura..."
                  value={comprobante}
                  onChange={(e) => setComprobante(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pf-ref">Referencia banco (opcional)</Label>
                <Input
                  id="pf-ref"
                  placeholder="ID transferencia..."
                  value={referenciaBanco}
                  onChange={(e) => setReferenciaBanco(e.target.value)}
                  maxLength={100}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={pending}>
              {pending ? "Registrando…" : "Registrar pago"}
            </Button>
          </DialogFooter>
        </div>
      )}
    </FloatingWorkWindow>
  );
}
