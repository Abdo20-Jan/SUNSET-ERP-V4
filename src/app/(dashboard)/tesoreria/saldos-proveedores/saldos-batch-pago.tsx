"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";

import { fmtMoney } from "@/lib/format";
import {
  crearMovimientoTesoreriaAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateBadge } from "@/components/ui/date-badge";
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
import { Textarea } from "@/components/ui/textarea";

type FacturaPendiente = {
  origen: "compra" | "embarque";
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null;
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string;
  moneda: string;
};

type SaldoProveedorAging = {
  proveedorId: string;
  proveedorNombre: string;
  cuit: string | null;
  pais: string;
  cuentaContableId: number | null;
  saldoTotal: string;
  vencido: string;
  proximo: string;
  alDia: string;
  facturas: FacturaPendiente[];
};

type Props = {
  proveedores: SaldoProveedorAging[];
  cuentasBancarias: CuentaBancariaOption[];
};

export function SaldosBatchPago({ proveedores, cuentasBancarias }: Props) {
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

  const provById = new Map(proveedores.map((p) => [p.proveedorId, p]));
  const seleccionados = Array.from(selected)
    .map((id) => provById.get(id))
    .filter((p): p is SaldoProveedorAging => !!p);

  const totalSeleccionado = seleccionados.reduce((s, p) => {
    const override = montosOverride[p.proveedorId];
    const monto = override !== undefined ? Number(override) : Number(p.saldoTotal);
    return s + (Number.isFinite(monto) ? monto : 0);
  }, 0);

  const cuentasArs = cuentasBancarias.filter((c) => c.moneda === "ARS");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        toast.error(
          `El proveedor "${p.proveedorNombre}" no tiene cuenta contable.`,
        );
        return;
      }
    }

    const lineas = seleccionados.map((p) => {
      const override = montosOverride[p.proveedorId];
      const monto = override !== undefined ? override : p.saldoTotal;
      return {
        cuentaContableId: p.cuentaContableId!,
        monto,
        descripcion: p.proveedorNombre,
      };
    });

    const descripcionFinal =
      descripcion ||
      `Pago múltiple — ${seleccionados.length} proveedor${
        seleccionados.length === 1 ? "" : "es"
      } (${seleccionados
        .map((p) => p.proveedorNombre)
        .slice(0, 3)
        .join(", ")}${seleccionados.length > 3 ? "…" : ""})`;

    startTransition(async () => {
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

  if (proveedores.length === 0) {
    return (
      <Card className="py-0">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Sin saldos pendientes para los filtros seleccionados.
        </CardContent>
      </Card>
    );
  }

  const allSelectableIds = proveedores
    .filter((p) => p.cuentaContableId !== null)
    .map((p) => p.proveedorId);
  const allSelected =
    selected.size === allSelectableIds.length && allSelectableIds.length > 0;

  return (
    <>
      <Card className="py-0">
        <Table>
          <caption className="sr-only">
            Saldos por proveedor con desglose de vencimientos
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => {
                    if (allSelected) setSelected(new Set());
                    else setSelected(new Set(allSelectableIds));
                  }}
                  aria-label="Seleccionar todos"
                />
              </TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Vencido</TableHead>
              <TableHead className="text-right">A vencer 7d</TableHead>
              <TableHead className="text-right">Al día</TableHead>
              <TableHead className="text-right">Saldo contable</TableHead>
              <TableHead className="text-right">A pagar</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proveedores.map((p) => (
              <ProveedorRow
                key={p.proveedorId}
                p={p}
                isChecked={selected.has(p.proveedorId)}
                onToggle={() => toggle(p.proveedorId)}
                montoOverride={montosOverride[p.proveedorId]}
                onMontoChange={(v) =>
                  setMontosOverride((prev) => ({ ...prev, [p.proveedorId]: v }))
                }
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {seleccionados.length > 0 && (
        <Card className="border-2 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {seleccionados.length} proveedor
                  {seleccionados.length === 1 ? "" : "es"} seleccionado
                  {seleccionados.length === 1 ? "" : "s"}
                </span>
                <span className="font-mono text-lg font-semibold tabular-nums">
                  ARS{" "}
                  {totalSeleccionado.toLocaleString("es-AR", {
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
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Fecha</Label>
                <Input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
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
                {seleccionados.map((p) => {
                  const monto =
                    montosOverride[p.proveedorId] !== undefined
                      ? Number(montosOverride[p.proveedorId])
                      : Number(p.saldoTotal);
                  return (
                    <li key={p.proveedorId}>
                      DEBE {p.proveedorNombre} —{" "}
                      <span className="tabular-nums">
                        ARS{" "}
                        {monto.toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </li>
                  );
                })}
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
                    {totalSeleccionado.toLocaleString("es-AR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ProveedorRow({
  p,
  isChecked,
  onToggle,
  montoOverride,
  onMontoChange,
}: {
  p: SaldoProveedorAging;
  isChecked: boolean;
  onToggle: () => void;
  montoOverride: string | undefined;
  onMontoChange: (v: string) => void;
}) {
  const tieneVencidas = Number(p.vencido) > 0;
  const tieneProximas = Number(p.proximo) > 0;

  return (
    <>
      <TableRow
        className={
          isChecked
            ? "bg-primary/5"
            : tieneVencidas
              ? "bg-red-50/40 dark:bg-red-950/10"
              : undefined
        }
      >
        <TableCell>
          <Checkbox
            checked={isChecked}
            onCheckedChange={onToggle}
            disabled={!p.cuentaContableId}
            aria-label={`Seleccionar ${p.proveedorNombre}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{p.proveedorNombre}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {p.cuit ?? "—"} · {p.pais}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {tieneVencidas ? (
            <span className="font-semibold text-red-700 dark:text-red-300">
              {fmtMoney(p.vencido)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {tieneProximas ? (
            <span className="text-amber-700 dark:text-amber-300">
              {fmtMoney(p.proximo)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {Number(p.alDia) > 0 ? (
            fmtMoney(p.alDia)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {fmtMoney(p.saldoTotal)}
        </TableCell>
        <TableCell className="text-right">
          {isChecked ? (
            <Input
              type="text"
              inputMode="decimal"
              className="h-7 text-right font-mono text-xs tabular-nums"
              value={montoOverride ?? p.saldoTotal}
              onChange={(e) => onMontoChange(e.target.value)}
            />
          ) : (
            <span className="font-mono text-xs tabular-nums">—</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          <Link
            href={
              p.cuentaContableId
                ? `/tesoreria/movimientos/nuevo?${new URLSearchParams({
                    tipo: "PAGO",
                    cuentaContableId: String(p.cuentaContableId),
                    monto: p.saldoTotal,
                    descripcion: `Pago a ${p.proveedorNombre}${p.facturas.length > 0 ? ` — ${p.facturas.length} factura(s)` : ""}`,
                  }).toString()}`
                : `/tesoreria/movimientos/nuevo?tipo=PAGO`
            }
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Pagar solo
            <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
          </Link>
        </TableCell>
      </TableRow>
      {p.facturas.length > 0 && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/20 py-2">
            <div className="flex flex-wrap gap-2 px-2">
              {p.facturas.slice(0, 8).map((f) => (
                <span
                  key={`${f.origen}-${f.id}`}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {f.origen === "compra" ? "C" : "EMB"}
                  </Badge>
                  <span className="font-mono">{f.numero}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">
                    {fmtMoney(f.monto)}
                  </span>
                  <DateBadge fecha={f.fechaVencimiento} relative />
                </span>
              ))}
              {p.facturas.length > 8 && (
                <span className="text-xs text-muted-foreground">
                  +{p.facturas.length - 8} más
                </span>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
