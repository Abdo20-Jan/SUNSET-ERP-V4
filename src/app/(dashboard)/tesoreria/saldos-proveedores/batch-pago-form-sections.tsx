"use client";

/**
 * Subcomponentes de PRESENTACIÓN del panel de pago batch (TES-02 · PR-025b) —
 * JSX extraído VERBATIM del legado `saldos-batch-pago.tsx` (mantido en árbol,
 * no importado) para pasar el gate de complejidad (Codacy/Lizard). Sin lógica
 * de negocio: el estado y los submits viven en `batch-pago-panel.tsx`.
 */

import type { CuentaBancariaOption } from "@/lib/actions/movimientos-tesoreria";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";

import { fmtArsNum } from "./batch-pago-helpers";
import type { ProveedorIntermediario, SaldoProveedorAging } from "./saldos-proveedores-columns";

export function PanelHeader({
  count,
  subtotalFacturas,
  pending,
  disabled,
  onSubmit,
}: {
  count: number;
  subtotalFacturas: number;
  pending: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {count} proveedor
          {count === 1 ? "" : "es"} seleccionado
          {count === 1 ? "" : "s"} (subtotal facturas)
        </span>
        <span className="font-mono text-lg font-semibold tabular-nums">
          ARS {fmtArsNum(subtotalFacturas)}
        </span>
      </div>
      <Button type="button" onClick={onSubmit} disabled={disabled}>
        {pending ? "Procesando…" : `Pagar ${count} con un movimiento`}
      </Button>
    </div>
  );
}

export function RetencionAviso() {
  // Aviso retención Ganancias — sólo aplica a pago de UN proveedor.
  return (
    <div className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
      <strong>Retención Ganancias:</strong> en pago múltiple (varios proveedores) NO se aplica
      retención automática. Si algún proveedor es sujeto a retención, pagalo por separado en{" "}
      <span className="font-medium">Cuentas a Pagar → Pago por factura</span> (o un solo proveedor)
      para que el sistema retenga.
    </div>
  );
}

export function IntermediarioToggle({
  conIntermediario,
  setConIntermediario,
  montoTransferido,
  setMontoTransferido,
  subtotalFacturas,
}: {
  conIntermediario: boolean;
  setConIntermediario: (v: boolean) => void;
  montoTransferido: string;
  setMontoTransferido: (v: string) => void;
  subtotalFacturas: number;
}) {
  // Mismo seed del legado: al activar, si el monto está vacío, propone el subtotal.
  const onToggle = (checked: boolean) => {
    setConIntermediario(checked);
    if (checked && !montoTransferido) {
      setMontoTransferido(subtotalFacturas.toFixed(2));
    }
  };
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-card px-3 py-2 text-[12px]">
      <Checkbox
        checked={conIntermediario}
        onCheckedChange={(v) => onToggle(!!v)}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">Pago vía intermediário (despachante / agente)</span>
        <span className="text-muted-foreground">
          Activá si transferís a un despachante (ej: CYSAR) que paga las facturas a TRP/EXOLGAN/etc
          en tu nombre. La diferencia entre el monto transferido y el subtotal de facturas queda
          como anticipo (a tu favor) o saldo pendiente con el intermediário.
        </span>
      </div>
    </label>
  );
}

export function IntermediarioSection({
  intermediarios,
  intermediarioCuentaId,
  onIntermediarioChange,
  montoTransferido,
  onMontoTransferidoChange,
  subtotalFacturas,
  montoTransferidoNum,
  diferencia,
}: {
  intermediarios: ProveedorIntermediario[];
  intermediarioCuentaId: number | null;
  onIntermediarioChange: (id: number | null) => void;
  montoTransferido: string;
  onMontoTransferidoChange: (v: string) => void;
  subtotalFacturas: number;
  montoTransferidoNum: number;
  diferencia: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-amber-300/70 bg-amber-50/50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/20">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Beneficiário (intermediário) *</Label>
          <Select
            value={intermediarioCuentaId ? String(intermediarioCuentaId) : undefined}
            onValueChange={(v) => onIntermediarioChange(v ? Number(v) : null)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccione proveedor intermediário">
                {(value) => {
                  if (!value) return "Seleccione proveedor intermediário";
                  const id = Number(value);
                  const p = intermediarios.find((x) => x.cuentaContableId === id);
                  return p ? p.proveedorNombre : `Cuenta #${id}`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {intermediarios
                .filter(
                  (p): p is typeof p & { cuentaContableId: number } => p.cuentaContableId !== null,
                )
                .map((p) => (
                  <SelectItem key={p.proveedorId} value={String(p.cuentaContableId)}>
                    {p.proveedorNombre}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Monto efectivamente transferido (ARS) *</Label>
          <Input
            type="text"
            inputMode="decimal"
            className="text-right font-mono tabular-nums"
            value={montoTransferido}
            onChange={(e) => onMontoTransferidoChange(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div className="rounded-md border bg-card px-2 py-1">
          <div className="text-[10px] uppercase text-muted-foreground">Subtotal facturas</div>
          <div className="font-mono tabular-nums">ARS {fmtArsNum(subtotalFacturas)}</div>
        </div>
        <div className="rounded-md border bg-card px-2 py-1">
          <div className="text-[10px] uppercase text-muted-foreground">Transferido al banco</div>
          <div className="font-mono tabular-nums">ARS {fmtArsNum(montoTransferidoNum)}</div>
        </div>
        <DiferenciaBox diferencia={diferencia} />
      </div>
    </div>
  );
}

function DiferenciaBox({ diferencia }: { diferencia: number }) {
  const esCero = Math.abs(diferencia) < 0.01;
  return (
    <div
      className={
        "rounded-md border-2 px-2 py-1 " +
        (esCero
          ? "border-muted-foreground/30 bg-card"
          : diferencia > 0
            ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
            : "border-rose-400 bg-rose-50/60 dark:bg-rose-950/30")
      }
    >
      <div className="text-[10px] uppercase text-muted-foreground">Diferencia</div>
      <div className="font-mono tabular-nums">
        {esCero ? (
          <span>—</span>
        ) : diferencia > 0 ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            + ARS {fmtArsNum(diferencia)}
          </span>
        ) : (
          <span className="text-rose-700 dark:text-rose-400">
            − ARS {fmtArsNum(Math.abs(diferencia))}
          </span>
        )}
      </div>
      {!esCero && (
        <div
          className={
            "mt-0.5 text-[10px] " +
            (diferencia > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-rose-700 dark:text-rose-400")
          }
        >
          {diferencia > 0 ? "Anticipo / saldo a favor" : "Saldo pendiente con intermediário"}
        </div>
      )}
    </div>
  );
}

export function FormFields({
  cuentasArs,
  cuentaBancariaId,
  onCuentaChange,
  fecha,
  onFechaChange,
  comprobante,
  onComprobanteChange,
  referenciaBanco,
  onReferenciaChange,
  descripcion,
  onDescripcionChange,
}: {
  cuentasArs: CuentaBancariaOption[];
  cuentaBancariaId: string;
  onCuentaChange: (v: string) => void;
  fecha: string;
  onFechaChange: (v: string) => void;
  comprobante: string;
  onComprobanteChange: (v: string) => void;
  referenciaBanco: string;
  onReferenciaChange: (v: string) => void;
  descripcion: string;
  onDescripcionChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Cuenta bancaria *</Label>
        <Select
          value={cuentaBancariaId || undefined}
          onValueChange={(v) => onCuentaChange(v ?? "")}
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccione cuenta">
              {(value) => {
                const c = cuentasArs.find((c) => c.id === value);
                return c ? `${c.banco} · ${c.numero ?? "—"} · ${c.moneda}` : "Seleccione cuenta";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {cuentasArs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.banco} · {c.numero ?? "—"} · {c.moneda}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Fecha</Label>
        <DatePicker value={fecha} onChange={onFechaChange} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Comprobante (opcional)</Label>
        <Input
          placeholder="Cheque Nº / Factura A-..."
          value={comprobante}
          onChange={(e) => onComprobanteChange(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Referencia banco (opcional)</Label>
        <Input
          placeholder="Cód. Op. del banco"
          value={referenciaBanco}
          onChange={(e) => onReferenciaChange(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 md:col-span-2">
        <Label className="text-[11px]">Descripción (opcional)</Label>
        <Textarea
          placeholder="Si vacío: 'Pago múltiple — N proveedores (...)'"
          rows={2}
          value={descripcion}
          onChange={(e) => onDescripcionChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export type AsientoPreviewProps = {
  seleccionados: SaldoProveedorAging[];
  montosOverride: Readonly<Record<string, string>>;
  conIntermediario: boolean;
  intermediarioCuentaId: number | null;
  intermediarios: ProveedorIntermediario[];
  diferencia: number;
  cuentasArs: CuentaBancariaOption[];
  cuentaBancariaId: string;
  montoTransferidoNum: number;
  subtotalFacturas: number;
};

export function AsientoPreview(props: AsientoPreviewProps) {
  const {
    seleccionados,
    montosOverride,
    conIntermediario,
    intermediarioCuentaId,
    intermediarios,
    diferencia,
    cuentasArs,
    cuentaBancariaId,
    montoTransferidoNum,
    subtotalFacturas,
  } = props;
  const nombreIntermediario = () => {
    const p = intermediarios.find((x) => x.cuentaContableId === intermediarioCuentaId);
    return p?.proveedorNombre ?? `Cuenta #${intermediarioCuentaId}`;
  };
  const labelBanco = () => {
    const c = cuentasArs.find((x) => x.id === cuentaBancariaId);
    return c ? `${c.cuentaContableCodigo} ${c.banco}` : "(elegí cuenta bancaria)";
  };

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-[12px]">
      <p className="mb-1 font-medium">Asiento que se generará (vista previa):</p>
      <ul className="space-y-0.5 font-mono text-[11px]">
        {seleccionados.map((p) => {
          const monto =
            montosOverride[p.proveedorId] !== undefined
              ? Number(montosOverride[p.proveedorId])
              : Number(p.saldoTotal);
          return (
            <li key={p.proveedorId}>
              DEBE {p.proveedorNombre} —{" "}
              <span className="tabular-nums">ARS {fmtArsNum(monto)}</span>
            </li>
          );
        })}
        {conIntermediario && intermediarioCuentaId && Math.abs(diferencia) >= 0.01 && (
          <li
            className={
              diferencia > 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-700 dark:text-rose-400"
            }
          >
            {diferencia > 0 ? "DEBE" : "HABER"} {nombreIntermediario()} —{" "}
            <span className="tabular-nums">ARS {fmtArsNum(Math.abs(diferencia))}</span>{" "}
            <span className="text-muted-foreground">
              ({diferencia > 0 ? "anticipo" : "saldo pendiente"})
            </span>
          </li>
        )}
        <li className="border-t pt-0.5">
          HABER {labelBanco()} —{" "}
          <span className="tabular-nums">
            ARS {fmtArsNum(conIntermediario ? montoTransferidoNum : subtotalFacturas)}
          </span>
        </li>
      </ul>
    </div>
  );
}
