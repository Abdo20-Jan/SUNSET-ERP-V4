"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  crearMovimientoTesoreriaAction,
  pagarConIntermediarioAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CuentaAPagarPorEmbarque } from "@/lib/services/cuentas-a-pagar";

import { fmtMoney } from "../../reportes/_components/money";

type ProveedorOption = {
  proveedorId: string;
  proveedorNombre: string;
  cuentaContableId: number | null;
};

type Props = {
  rows: CuentaAPagarPorEmbarque[];
  cuentasBancarias: CuentaBancariaOption[];
  proveedores: ProveedorOption[];
};

function rowKey(r: CuentaAPagarPorEmbarque): string {
  return `${r.embarqueId}::${r.proveedorId}`;
}

export function EmbarqueBatchPago({
  rows,
  cuentasBancarias,
  proveedores,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [montosOverride, setMontosOverride] = useState<
    Record<string, string>
  >({});
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [comprobante, setComprobante] = useState("");
  const [referenciaBanco, setReferenciaBanco] = useState("");
  const [descripcion, setDescripcion] = useState("");
  // Pago via intermediário (despachante que paga las facturas seleccionadas)
  const [conIntermediario, setConIntermediario] = useState(false);
  const [intermediarioCuentaId, setIntermediarioCuentaId] = useState<
    number | null
  >(null);
  const [montoTransferido, setMontoTransferido] = useState<string>("");

  if (rows.length === 0) return null;

  const rowByKey = new Map(rows.map((r) => [rowKey(r), r]));

  const seleccionados = Array.from(selected)
    .map((k) => rowByKey.get(k))
    .filter((r): r is CuentaAPagarPorEmbarque => !!r);

  const totalSeleccionado = seleccionados.reduce((s, r) => {
    const override = montosOverride[rowKey(r)];
    const monto = override !== undefined ? Number(override) : Number(r.pendienteArs);
    return s + (Number.isFinite(monto) ? monto : 0);
  }, 0);

  const cuentasArs = useMemo(
    () => cuentasBancarias.filter((c) => c.moneda === "ARS"),
    [cuentasBancarias],
  );

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map(rowKey)));
    }
  };

  const subtotalFacturas = totalSeleccionado;
  const montoTransferidoNum = conIntermediario
    ? Number(montoTransferido) || 0
    : subtotalFacturas;
  const diferencia = montoTransferidoNum - subtotalFacturas;

  const onSubmit = () => {
    if (seleccionados.length === 0) {
      toast.error("Seleccioná al menos un embarque/proveedor.");
      return;
    }
    if (!cuentaBancariaId) {
      toast.error("Seleccioná la cuenta bancaria.");
      return;
    }
    // Validar todas las contrapartidas tienen cuenta
    for (const r of seleccionados) {
      if (!r.proveedorCuentaContableId) {
        toast.error(
          `El proveedor "${r.proveedorNombre}" no tiene cuenta contable. No se puede pagar.`,
        );
        return;
      }
    }

    const lineas = seleccionados.map((r) => {
      const override = montosOverride[rowKey(r)];
      const monto = override !== undefined ? override : r.pendienteArs;
      return {
        cuentaContableId: r.proveedorCuentaContableId!,
        monto,
        descripcion: `${r.embarqueCodigo} — ${r.proveedorNombre}`,
      };
    });

    const descripcionFinal =
      descripcion ||
      `Pago múltiple — ${seleccionados.length} proveedor${
        seleccionados.length === 1 ? "" : "es"
      } (${seleccionados
        .map((r) => `${r.embarqueCodigo}/${r.proveedorNombre}`)
        .slice(0, 3)
        .join(", ")}${seleccionados.length > 3 ? "…" : ""})`;

    startTransition(async () => {
      // Caso A: con intermediário (despachante que paga las facturas)
      if (conIntermediario) {
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
        const mensaje =
          r.tipoDiferencia === "anticipo"
            ? `Pago registrado (Asiento Nº ${r.asientoNumero}). Anticipo de ARS ${r.diferencia} a favor del intermediário.`
            : r.tipoDiferencia === "saldo_pendiente"
              ? `Pago registrado (Asiento Nº ${r.asientoNumero}). Quedó saldo pendiente de ARS ${Math.abs(Number(r.diferencia)).toFixed(2)} con el intermediário.`
              : `Pago registrado — Asiento Nº ${r.asientoNumero}.`;
        toast.success(mensaje);
        setSelected(new Set());
        setMontosOverride({});
        setComprobante("");
        setReferenciaBanco("");
        setDescripcion("");
        setConIntermediario(false);
        setIntermediarioCuentaId(null);
        setMontoTransferido("");
        router.refresh();
        return;
      }

      // Caso B: pago directo a los proveedores (sin intermediário)
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
      toast.success(
        `Pago múltiple registrado — Asiento Nº ${r.asientoNumero}`,
      );
      setSelected(new Set());
      setMontosOverride({});
      setComprobante("");
      setReferenciaBanco("");
      setDescripcion("");
      router.refresh();
    });
  };

  const allSelected = selected.size === rows.length && rows.length > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Por embarque · Multi-pago</h2>
          <p className="text-xs text-muted-foreground">
            Seleccioná uno o varios embarques/proveedores para pagar todos en
            un único movimiento bancario (1 cheque o transferencia, N
            beneficiarios). El asiento generado tiene 1 línea HABER al banco
            y N líneas DEBE (una por cada proveedor seleccionado).
          </p>
        </div>

        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
          <strong>¿Ya pagaste y la línea sigue acá?</strong> Verificá que el
          asiento del pago haya usado la <strong>cuenta del proveedor</strong>{" "}
          (2.1.x) como contrapartida. La columna "Saldo proveedor" muestra la
          deuda viva real (haber − debe en su cuenta).
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => toggleAll()}
                  aria-label="Seleccionar todos"
                />
              </TableHead>
              <TableHead className="w-32">Embarque</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Facturas</TableHead>
              <TableHead className="text-right">Total facturado</TableHead>
              <TableHead className="text-right">Saldo proveedor</TableHead>
              <TableHead className="text-right">A pagar</TableHead>
              <TableHead className="w-24 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const k = rowKey(r);
              const isChecked = selected.has(k);
              const totalNum = Number(r.totalArs);
              const saldoNum = Number(r.saldoVivoProveedorArs);
              const partial = saldoNum > 0 && saldoNum < totalNum - 0.01;
              const saldoMatchTotal = Math.abs(saldoNum - totalNum) < 0.01;
              const numerosFacturas = r.facturas
                .map((f) => f.numero)
                .join(", ")
                .slice(0, 200);
              const hrefSingle = r.proveedorCuentaContableId
                ? `/tesoreria/movimientos/nuevo?${new URLSearchParams({
                    tipo: "PAGO",
                    cuentaContableId: String(r.proveedorCuentaContableId),
                    monto: r.pendienteArs,
                    descripcion: `Pago embarque ${r.embarqueCodigo} — ${r.proveedorNombre} — Fact: ${numerosFacturas}`.slice(
                      0,
                      255,
                    ),
                  }).toString()}`
                : null;

              return (
                <TableRow
                  key={k}
                  className={isChecked ? "bg-primary/5" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggle(k)}
                      disabled={!r.proveedorCuentaContableId}
                      aria-label={`Seleccionar ${r.embarqueCodigo}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.embarqueCodigo}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{r.proveedorNombre}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.proveedorCuentaCodigo && (
                          <span className="font-mono">
                            {r.proveedorCuentaCodigo} ·{" "}
                          </span>
                        )}
                        {r.facturas
                          .map((f) => f.numero)
                          .slice(0, 4)
                          .join(", ")}
                        {r.facturas.length > 4
                          ? ` (+${r.facturas.length - 4})`
                          : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.facturas.length}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(r.totalArs)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span
                      className={
                        saldoMatchTotal
                          ? "text-rose-700 dark:text-rose-400"
                          : partial
                            ? "text-amber-700 dark:text-amber-400"
                            : ""
                      }
                    >
                      {fmtMoney(r.saldoVivoProveedorArs)}
                    </span>
                    {saldoMatchTotal && (
                      <div className="text-[10px] font-normal text-muted-foreground">
                        (sin pago registrado)
                      </div>
                    )}
                    {partial && (
                      <div className="text-[10px] font-normal text-muted-foreground">
                        (parcial)
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isChecked ? (
                      <Input
                        type="text"
                        inputMode="decimal"
                        className="h-7 text-right font-mono text-xs tabular-nums"
                        value={
                          montosOverride[k] ?? r.pendienteArs
                        }
                        onChange={(e) =>
                          setMontosOverride((prev) => ({
                            ...prev,
                            [k]: e.target.value,
                          }))
                        }
                      />
                    ) : (
                      <span className="font-mono text-xs tabular-nums font-semibold">
                        {fmtMoney(r.pendienteArs)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {hrefSingle ? (
                      <Link
                        href={hrefSingle}
                        className="inline-flex h-8 items-center rounded-full border border-input bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        Pagar
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        sin cuenta
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {seleccionados.length > 0 && (
          <div className="flex flex-col gap-3 rounded-md border-2 border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {seleccionados.length} factura
                  {seleccionados.length === 1 ? "" : "s"} seleccionada
                  {seleccionados.length === 1 ? "" : "s"} (subtotal)
                </span>
                <span className="font-mono text-lg font-semibold tabular-nums">
                  ARS{" "}
                  {subtotalFacturas.toLocaleString("es-AR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <Button
                type="button"
                onClick={onSubmit}
                disabled={pending || !cuentaBancariaId}
              >
                {pending
                  ? "Procesando…"
                  : `Pagar ${seleccionados.length} con un movimiento`}
              </Button>
            </div>

            {/* Toggle pago vía intermediário (despachante) */}
            <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-card px-3 py-2 text-[12px]">
              <Checkbox
                checked={conIntermediario}
                onCheckedChange={(v) => {
                  const checked = !!v;
                  setConIntermediario(checked);
                  if (checked && !montoTransferido) {
                    setMontoTransferido(subtotalFacturas.toFixed(2));
                  }
                }}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">
                  Pago vía intermediário (despachante / agente)
                </span>
                <span className="text-muted-foreground">
                  Activá si transferís a un despachante (ej: CYSAR) que paga
                  estas facturas a TRP/EXOLGAN/etc en tu nombre. La diferencia
                  entre el monto transferido y el subtotal queda como anticipo
                  (a tu favor) o saldo pendiente con el intermediário.
                </span>
              </div>
            </label>

            {conIntermediario && (
              <div className="flex flex-col gap-2 rounded-md border-2 border-amber-300/70 bg-amber-50/50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/20">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">
                      Beneficiário (intermediário) *
                    </Label>
                    <Select
                      value={
                        intermediarioCuentaId
                          ? String(intermediarioCuentaId)
                          : undefined
                      }
                      onValueChange={(v) =>
                        setIntermediarioCuentaId(v ? Number(v) : null)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione proveedor intermediário">
                          {(value) => {
                            if (!value)
                              return "Seleccione proveedor intermediário";
                            const id = Number(value);
                            const p = proveedores.find(
                              (x) => x.cuentaContableId === id,
                            );
                            return p ? p.proveedorNombre : `Cuenta #${id}`;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {proveedores
                          .filter(
                            (p): p is typeof p & { cuentaContableId: number } =>
                              p.cuentaContableId !== null,
                          )
                          .map((p) => (
                            <SelectItem
                              key={p.proveedorId}
                              value={String(p.cuentaContableId)}
                            >
                              {p.proveedorNombre}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">
                      Monto efectivamente transferido (ARS) *
                    </Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="text-right font-mono tabular-nums"
                      value={montoTransferido}
                      onChange={(e) => setMontoTransferido(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[12px]">
                  <div className="rounded-md border bg-card px-2 py-1">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Subtotal facturas
                    </div>
                    <div className="font-mono tabular-nums">
                      ARS{" "}
                      {subtotalFacturas.toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                  <div className="rounded-md border bg-card px-2 py-1">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Transferido al banco
                    </div>
                    <div className="font-mono tabular-nums">
                      ARS{" "}
                      {montoTransferidoNum.toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                  <div
                    className={
                      "rounded-md border-2 px-2 py-1 " +
                      (Math.abs(diferencia) < 0.01
                        ? "border-muted-foreground/30 bg-card"
                        : diferencia > 0
                          ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
                          : "border-rose-400 bg-rose-50/60 dark:bg-rose-950/30")
                    }
                  >
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Diferencia
                    </div>
                    <div className="font-mono tabular-nums">
                      {Math.abs(diferencia) < 0.01 ? (
                        <span>—</span>
                      ) : diferencia > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          + ARS{" "}
                          {diferencia.toLocaleString("es-AR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      ) : (
                        <span className="text-rose-700 dark:text-rose-400">
                          − ARS{" "}
                          {Math.abs(diferencia).toLocaleString("es-AR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      )}
                    </div>
                    {Math.abs(diferencia) >= 0.01 && (
                      <div
                        className={
                          "mt-0.5 text-[10px] " +
                          (diferencia > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700 dark:text-rose-400")
                        }
                      >
                        {diferencia > 0
                          ? "Anticipo / saldo a favor"
                          : "Saldo pendiente con intermediário"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Cuenta bancaria *</Label>
                <Select
                  value={cuentaBancariaId || undefined}
                  onValueChange={(v) => setCuentaBancariaId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione cuenta">
                      {(value) => {
                        const c = cuentasArs.find((c) => c.id === value);
                        return c
                          ? `${c.banco} · ${c.numero ?? "—"} · ${c.moneda}`
                          : "Seleccione cuenta";
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
                {cuentasArs.length === 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    Sin cuentas bancarias en ARS.
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Fecha</Label>
                <DatePicker value={fecha} onChange={setFecha} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Comprobante (opcional)</Label>
                <Input
                  placeholder="Cheque Nº / Factura A-..."
                  value={comprobante}
                  onChange={(e) => setComprobante(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">
                  Referencia banco (opcional)
                </Label>
                <Input
                  placeholder="Cód. Op. del banco"
                  value={referenciaBanco}
                  onChange={(e) => setReferenciaBanco(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label className="text-[11px]">Descripción (opcional)</Label>
                <Textarea
                  placeholder="Si vacío: 'Pago múltiple — N proveedores (...)'"
                  rows={2}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-md border bg-card px-3 py-2 text-[12px]">
              <p className="mb-1 font-medium">
                Asiento que se generará (vista previa):
              </p>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {seleccionados.map((r) => {
                  const k = rowKey(r);
                  const monto =
                    montosOverride[k] !== undefined
                      ? Number(montosOverride[k])
                      : Number(r.pendienteArs);
                  return (
                    <li key={k}>
                      DEBE {r.proveedorCuentaCodigo ?? "?.?.?.?"}{" "}
                      {r.proveedorNombre} —{" "}
                      <span className="tabular-nums">
                        ARS{" "}
                        {monto.toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        ({r.embarqueCodigo})
                      </span>
                    </li>
                  );
                })}
                {conIntermediario &&
                  intermediarioCuentaId &&
                  Math.abs(diferencia) >= 0.01 && (
                    <li
                      className={
                        diferencia > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-700 dark:text-rose-400"
                      }
                    >
                      {diferencia > 0 ? "DEBE" : "HABER"}{" "}
                      {(() => {
                        const p = proveedores.find(
                          (x) => x.cuentaContableId === intermediarioCuentaId,
                        );
                        return (
                          p?.proveedorNombre ?? `Cuenta #${intermediarioCuentaId}`
                        );
                      })()}{" "}
                      —{" "}
                      <span className="tabular-nums">
                        ARS{" "}
                        {Math.abs(diferencia).toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        ({diferencia > 0 ? "anticipo" : "saldo pendiente"})
                      </span>
                    </li>
                  )}
                <li className="border-t pt-0.5">
                  HABER{" "}
                  {(() => {
                    const c = cuentasArs.find((x) => x.id === cuentaBancariaId);
                    return c
                      ? `${c.cuentaContableCodigo} ${c.banco}`
                      : "(elegí cuenta bancaria)";
                  })()}{" "}
                  —{" "}
                  <span className="tabular-nums">
                    ARS{" "}
                    {(conIntermediario
                      ? montoTransferidoNum
                      : subtotalFacturas
                    ).toLocaleString("es-AR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
