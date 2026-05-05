"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";

import { fmtMoney } from "@/lib/format";
import {
  crearMovimientoTesoreriaAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateBadge } from "@/components/ui/date-badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
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

type FacturaPendiente = {
  origen: "compra" | "embarque" | "gasto";
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

type FacturaConProveedor = FacturaPendiente & {
  proveedorId: string;
  proveedorNombre: string;
  cuentaContableId: number | null;
};

type Props = {
  proveedores: SaldoProveedorAging[];
  cuentasBancarias: CuentaBancariaOption[];
};

const ORIGEN_LABEL: Record<FacturaPendiente["origen"], string> = {
  compra: "Compra",
  gasto: "Gasto",
  embarque: "Costo embarque",
};

const ORIGEN_BADGE: Record<FacturaPendiente["origen"], string> = {
  compra: "C",
  gasto: "G",
  embarque: "EMB",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function facturaKey(f: { origen: string; id: string }): string {
  return `${f.origen}-${f.id}`;
}

function sumarMontos(facturas: FacturaConProveedor[]): string {
  let total = 0;
  for (const f of facturas) total += Number(f.monto);
  return total.toFixed(2);
}

export function PagoPorFactura({ proveedores, cuentasBancarias }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"all" | FacturaPendiente["bucket"]>("all");
  const [origenFilter, setOrigenFilter] = useState<"all" | FacturaPendiente["origen"]>("all");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const facturas: FacturaConProveedor[] = useMemo(() => {
    const all: FacturaConProveedor[] = [];
    for (const p of proveedores) {
      for (const f of p.facturas) {
        all.push({
          ...f,
          proveedorId: p.proveedorId,
          proveedorNombre: p.proveedorNombre,
          cuentaContableId: p.cuentaContableId,
        });
      }
    }
    return all.sort((a, b) => {
      if (a.bucket === "sin_fecha" && b.bucket !== "sin_fecha") return 1;
      if (b.bucket === "sin_fecha" && a.bucket !== "sin_fecha") return -1;
      const av = a.diasParaVencer ?? Number.MAX_SAFE_INTEGER;
      const bv = b.diasParaVencer ?? Number.MAX_SAFE_INTEGER;
      return av - bv;
    });
  }, [proveedores]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return facturas.filter((f) => {
      if (bucketFilter !== "all" && f.bucket !== bucketFilter) return false;
      if (origenFilter !== "all" && f.origen !== origenFilter) return false;
      if (q.length > 0) {
        const haystack = `${f.numero} ${f.proveedorNombre}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [facturas, search, bucketFilter, origenFilter]);

  const counts = useMemo(() => {
    const c = { vencida: 0, proxima: 0, al_dia: 0, sin_fecha: 0 };
    for (const f of facturas) c[f.bucket]++;
    return c;
  }, [facturas]);

  const facturasByKey = useMemo(() => {
    const m = new Map<string, FacturaConProveedor>();
    for (const f of facturas) m.set(facturaKey(f), f);
    return m;
  }, [facturas]);

  const selectedFacturas = useMemo(() => {
    const out: FacturaConProveedor[] = [];
    for (const k of selectedKeys) {
      const f = facturasByKey.get(k);
      if (f) out.push(f);
    }
    return out;
  }, [selectedKeys, facturasByKey]);

  const lockedTo = selectedFacturas[0] ?? null;

  const isSelectable = (f: FacturaConProveedor): boolean => {
    if (f.cuentaContableId === null) return false;
    if (lockedTo === null) return true;
    return f.proveedorId === lockedTo.proveedorId && f.moneda === lockedTo.moneda;
  };

  const toggleOne = (f: FacturaConProveedor) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = facturaKey(f);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectableInFiltered = useMemo(
    () => filtered.filter(isSelectable),
    // biome-ignore lint/correctness/useExhaustiveDependencies: lockedTo is derived from selectedKeys
    [filtered, lockedTo],
  );
  const allSelectableSelected =
    selectableInFiltered.length > 0 &&
    selectableInFiltered.every((f) => selectedKeys.has(facturaKey(f)));
  const someSelected =
    !allSelectableSelected && selectableInFiltered.some((f) => selectedKeys.has(facturaKey(f)));

  const toggleAll = () => {
    if (allSelectableSelected) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const f of selectableInFiltered) next.delete(facturaKey(f));
        return next;
      });
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const f of selectableInFiltered) next.add(facturaKey(f));
        return next;
      });
    }
  };

  const totalSeleccionado = useMemo(() => sumarMontos(selectedFacturas), [selectedFacturas]);

  const abrirDialogParaUna = (f: FacturaConProveedor) => {
    setSelectedKeys(new Set([facturaKey(f)]));
    setDialogOpen(true);
  };

  if (facturas.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Pago por factura individual</h2>
          <p className="text-xs text-muted-foreground">
            Pagar una o varias facturas (Compra, Gasto o costo de Embarque). Multi-selección
            restringida al mismo proveedor + moneda.
          </p>
          <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            Sin facturas pendientes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Pago por factura individual</h2>
          <p className="text-xs text-muted-foreground">
            Pagar una o varias facturas (Compra, Gasto o costo de Embarque). Multi-selección
            restringida al mismo proveedor + moneda.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5 min-w-64">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Nº factura o proveedor"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Vencimiento</Label>
            <Select
              value={bucketFilter}
              onValueChange={(v) => setBucketFilter(v as typeof bucketFilter)}
            >
              <SelectTrigger className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas ({facturas.length})</SelectItem>
                <SelectItem value="vencida">Vencidas ({counts.vencida})</SelectItem>
                <SelectItem value="proxima">Próximas ({counts.proxima})</SelectItem>
                <SelectItem value="al_dia">Al día ({counts.al_dia})</SelectItem>
                <SelectItem value="sin_fecha">Sin fecha ({counts.sin_fecha})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Origen</Label>
            <Select
              value={origenFilter}
              onValueChange={(v) => setOrigenFilter(v as typeof origenFilter)}
            >
              <SelectTrigger className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="compra">Compra</SelectItem>
                <SelectItem value="gasto">Gasto</SelectItem>
                <SelectItem value="embarque">Costo embarque</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedFacturas.length > 0 && lockedTo && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
            <span className="text-sm">
              <strong>{selectedFacturas.length}</strong> factura
              {selectedFacturas.length === 1 ? "" : "s"} de{" "}
              <strong>{lockedTo.proveedorNombre}</strong> · Total{" "}
              <span className="font-mono tabular-nums">
                {fmtMoney(totalSeleccionado)} {lockedTo.moneda}
              </span>
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedKeys(new Set())}>
                Limpiar selección
              </Button>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                Pagar {selectedFacturas.length === 1 ? "factura" : "facturas"}
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    disabled={selectableInFiltered.length === 0}
                    aria-label="Seleccionar todas las facturas seleccionables"
                  />
                </TableHead>
                <TableHead className="w-20">Origen</TableHead>
                <TableHead>Nº factura</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    Sin resultados para los filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((f) => {
                  const k = facturaKey(f);
                  const checked = selectedKeys.has(k);
                  const selectable = isSelectable(f);
                  const dimmed = !selectable && !checked;
                  const lockedReason =
                    !selectable && lockedTo !== null
                      ? f.cuentaContableId === null
                        ? "Falta cuenta contable del proveedor"
                        : f.proveedorId !== lockedTo.proveedorId
                          ? `Solo facturas de ${lockedTo.proveedorNombre}`
                          : `Solo moneda ${lockedTo.moneda}`
                      : undefined;
                  return (
                    <TableRow key={k} className={dimmed ? "opacity-50" : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!selectable && !checked}
                          onChange={() => toggleOne(f)}
                          title={lockedReason}
                          aria-label={`Seleccionar factura ${f.numero}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wide"
                          title={ORIGEN_LABEL[f.origen]}
                        >
                          {ORIGEN_BADGE[f.origen]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{f.numero}</TableCell>
                      <TableCell className="text-sm">{f.proveedorNombre}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <DateBadge fecha={f.fecha} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <DateBadge fecha={f.fechaVencimiento} relative />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtMoney(f.monto)}{" "}
                        <span className="text-xs text-muted-foreground">{f.moneda}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => abrirDialogParaUna(f)}
                          disabled={f.cuentaContableId === null}
                        >
                          Pagar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {filtered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Mostrando {filtered.length} de {facturas.length} facturas pendientes.
          </p>
        )}
      </CardContent>

      <PagoFacturaDialog
        open={dialogOpen}
        facturas={selectedFacturas}
        cuentasBancarias={cuentasBancarias}
        onClose={() => setDialogOpen(false)}
        onPaid={() => {
          setDialogOpen(false);
          setSelectedKeys(new Set());
          router.refresh();
        }}
      />
    </Card>
  );
}

function PagoFacturaDialog({
  open,
  facturas,
  cuentasBancarias,
  onClose,
  onPaid,
}: {
  open: boolean;
  facturas: FacturaConProveedor[];
  cuentasBancarias: CuentaBancariaOption[];
  onClose: () => void;
  onPaid: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(todayIso());
  const [comprobante, setComprobante] = useState<string>("");
  const [referenciaBanco, setReferenciaBanco] = useState<string>("");
  const [montoEditable, setMontoEditable] = useState<string>("");

  const sumaFacturas = useMemo(() => sumarMontos(facturas), [facturas]);
  const proveedor = facturas[0] ?? null;
  const moneda = facturas[0]?.moneda ?? "ARS";
  const isMulti = facturas.length > 1;

  // Reset monto editable cuando cambia la selección al abrir
  useEffect(() => {
    if (open && !isMulti && proveedor) setMontoEditable(proveedor.monto);
  }, [open, isMulti, proveedor]);

  const reset = () => {
    setCuentaBancariaId("");
    setFecha(todayIso());
    setComprobante("");
    setReferenciaBanco("");
    setMontoEditable("");
  };

  const handleSubmit = () => {
    if (!proveedor || !proveedor.cuentaContableId) {
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
    <Dialog
      open={open && proveedor !== null}
      onOpenChange={(o) => {
        if (!o && !pending) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        {proveedor && (
          <>
            <DialogHeader>
              <DialogTitle>
                {isMulti
                  ? `Pagar ${facturas.length} facturas`
                  : `Pagar factura ${proveedor.numero}`}
              </DialogTitle>
              <DialogDescription>
                {proveedor.proveedorNombre}
                {!isMulti && <> — {ORIGEN_LABEL[proveedor.origen]}</>}
                {" · "}Total{" "}
                <span className="font-mono">
                  {fmtMoney(sumaFacturas)} {moneda}
                </span>
              </DialogDescription>
            </DialogHeader>

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
                <Select
                  value={cuentaBancariaId}
                  onValueChange={(v) => setCuentaBancariaId(v ?? "")}
                >
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
