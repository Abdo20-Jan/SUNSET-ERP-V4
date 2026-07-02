"use client";

/**
 * Panel de pago batch de saldos por proveedor (TES-02 · PR-025b).
 *
 * El flujo de negocio es el MISMO del legado `saldos-batch-pago.tsx` (mantido
 * en árbol, no importado — rollback): mismas validaciones/toasts, misma
 * distribución FIFO (`AplicacionPago*`), mismo `sufijoFacts` (Layer-1
 * fallback), mismos payloads **byte-idénticos** a
 * `crearMovimientoTesoreriaAction` / `pagarConIntermediarioAction` (ARS/TC=1
 * hard-coded). La FUENTE está decompuesta en `batch-pago-helpers.ts` (lógica
 * pura) + `batch-pago-form-sections.tsx` (JSX) por el gate de complejidad
 * (Codacy/Lizard) — el runtime no cambia.
 *
 * Siempre montado (estado de cuenta/fecha sobrevive a limpiar la selección,
 * como en el legado top-level); renderiza null sin selección.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  crearMovimientoTesoreriaAction,
  pagarConIntermediarioAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import { Card, CardContent } from "@/components/ui/card";

import {
  buildDescripcionFinal,
  buildLineas,
  calcDiferencia,
  calcSubtotal,
  type LineaPago,
  mensajeIntermediario,
} from "./batch-pago-helpers";
import {
  AsientoPreview,
  FormFields,
  IntermediarioSection,
  IntermediarioToggle,
  PanelHeader,
  RetencionAviso,
} from "./batch-pago-form-sections";
import type { ProveedorIntermediario, SaldoProveedorAging } from "./saldos-proveedores-columns";

type Props = {
  seleccionados: SaldoProveedorAging[];
  montosOverride: Readonly<Record<string, string>>;
  // Lista de proveedores elegibles como beneficiário intermediário
  // (despachante). Incluye TODOS los proveedores activos con cuenta
  // contable — no sólo los que tienen saldo pendiente — para que un
  // despachante sin facturas en el sistema (ej: CYSAR) pueda seleccionarse.
  intermediarios: ProveedorIntermediario[];
  cuentasBancarias: CuentaBancariaOption[];
  defaultFecha?: string;
  /** Limpia selección + overrides en la worklist tras un pago exitoso. */
  onPaid: () => void;
};

export function BatchPagoPanel({
  seleccionados,
  montosOverride,
  intermediarios,
  cuentasBancarias,
  defaultFecha,
  onPaid,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(defaultFecha ?? new Date().toISOString().slice(0, 10));
  const [comprobante, setComprobante] = useState("");
  const [referenciaBanco, setReferenciaBanco] = useState("");
  const [descripcion, setDescripcion] = useState("");
  // Pago via intermediário (despachante que paga las facturas en nuestro
  // nombre). Cuando activado: monto transferido puede diferir del subtotal
  // de facturas; la diferencia queda como anticipo (a favor) o deuda con
  // el intermediário.
  const [conIntermediario, setConIntermediario] = useState(false);
  const [intermediarioCuentaId, setIntermediarioCuentaId] = useState<number | null>(null);
  const [montoTransferido, setMontoTransferido] = useState<string>("");

  const cuentasArs = cuentasBancarias.filter((c) => c.moneda === "ARS");

  const subtotalFacturas = calcSubtotal(seleccionados, montosOverride);
  const { montoTransferidoNum, diferencia } = calcDiferencia(
    conIntermediario,
    montoTransferido,
    subtotalFacturas,
  );

  const resetFormComun = () => {
    setComprobante("");
    setReferenciaBanco("");
    setDescripcion("");
  };

  const submitConIntermediario = async (lineas: LineaPago[], descripcionFinal: string) => {
    if (!intermediarioCuentaId) {
      toast.error("Seleccioná el beneficiário (intermediário).");
      return;
    }
    if (montoTransferidoNum <= 0) {
      toast.error("Monto transferido debe ser > 0.");
      return;
    }
    const r = await pagarConIntermediarioAction({
      cuentaBancariaId,
      fecha: new Date(fecha),
      moneda: "ARS",
      tipoCambio: "1",
      montoTransferido: montoTransferidoNum.toFixed(2),
      facturas: lineas,
      beneficiarioCuentaId: intermediarioCuentaId,
      descripcion: descripcionFinal.slice(0, 255),
      comprobante: comprobante || undefined,
      referenciaBanco: referenciaBanco || undefined,
    });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(mensajeIntermediario(r));
    onPaid();
    resetFormComun();
    setConIntermediario(false);
    setIntermediarioCuentaId(null);
    setMontoTransferido("");
    router.refresh();
  };

  const submitDirecto = async (lineas: LineaPago[], descripcionFinal: string) => {
    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId,
      fecha: new Date(fecha),
      moneda: "ARS",
      tipoCambio: "1",
      lineas,
      descripcion: descripcionFinal.slice(0, 255),
      comprobante: comprobante || undefined,
      referenciaBanco: referenciaBanco || undefined,
    });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`Pago múltiple registrado — Asiento Nº ${r.asientoNumero}`);
    onPaid();
    resetFormComun();
    router.refresh();
  };

  const onSubmit = () => {
    if (seleccionados.length === 0) {
      toast.error("Seleccioná al menos un proveedor.");
      return;
    }
    if (!cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria.");
      return;
    }
    for (const p of seleccionados) {
      if (!p.cuentaContableId) {
        toast.error(`El proveedor "${p.proveedorNombre}" no tiene cuenta contable.`);
        return;
      }
    }

    const lineas = buildLineas(seleccionados, montosOverride);
    const descripcionFinal = buildDescripcionFinal(descripcion, seleccionados);

    startTransition(async () => {
      // Caso 1: con intermediário (despachante que paga las facturas).
      if (conIntermediario) {
        await submitConIntermediario(lineas, descripcionFinal);
        return;
      }
      // Caso 2: pago directo a los proveedores (no intermediário).
      await submitDirecto(lineas, descripcionFinal);
    });
  };

  if (seleccionados.length === 0) return null;

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col gap-3">
        <PanelHeader
          count={seleccionados.length}
          subtotalFacturas={subtotalFacturas}
          pending={pending}
          disabled={pending || !cuentaBancariaId}
          onSubmit={onSubmit}
        />

        {seleccionados.length > 1 && <RetencionAviso />}

        <IntermediarioToggle
          conIntermediario={conIntermediario}
          setConIntermediario={setConIntermediario}
          montoTransferido={montoTransferido}
          setMontoTransferido={setMontoTransferido}
          subtotalFacturas={subtotalFacturas}
        />

        {conIntermediario && (
          <IntermediarioSection
            intermediarios={intermediarios}
            intermediarioCuentaId={intermediarioCuentaId}
            onIntermediarioChange={setIntermediarioCuentaId}
            montoTransferido={montoTransferido}
            onMontoTransferidoChange={setMontoTransferido}
            subtotalFacturas={subtotalFacturas}
            montoTransferidoNum={montoTransferidoNum}
            diferencia={diferencia}
          />
        )}

        <FormFields
          cuentasArs={cuentasArs}
          cuentaBancariaId={cuentaBancariaId}
          onCuentaChange={setCuentaBancariaId}
          fecha={fecha}
          onFechaChange={setFecha}
          comprobante={comprobante}
          onComprobanteChange={setComprobante}
          referenciaBanco={referenciaBanco}
          onReferenciaChange={setReferenciaBanco}
          descripcion={descripcion}
          onDescripcionChange={setDescripcion}
        />

        <AsientoPreview
          seleccionados={seleccionados}
          montosOverride={montosOverride}
          conIntermediario={conIntermediario}
          intermediarioCuentaId={intermediarioCuentaId}
          intermediarios={intermediarios}
          diferencia={diferencia}
          cuentasArs={cuentasArs}
          cuentaBancariaId={cuentaBancariaId}
          montoTransferidoNum={montoTransferidoNum}
          subtotalFacturas={subtotalFacturas}
        />
      </CardContent>
    </Card>
  );
}
