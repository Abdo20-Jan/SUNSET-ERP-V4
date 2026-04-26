"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  PlayCircleIcon,
} from "@hugeicons/core-free-icons";

import {
  actualizarGastoFijoAction,
  crearGastoFijoAction,
  registrarGastoFijoAction,
  type CuentaGastoOption,
  type GastoFijoInput,
  type GastoFijoRow,
  type ProveedorOptionParaGastoFijo,
} from "@/lib/actions/gastos-fijos";
import { fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CuentaCombobox } from "@/components/cuenta-combobox";
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
import { Textarea } from "@/components/ui/textarea";

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; row: GastoFijoRow }
  | { mode: "registrar"; row: GastoFijoRow }
  | null;

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function GastosFijosTable({
  gastos,
  proveedores,
  cuentas,
}: {
  gastos: GastoFijoRow[];
  proveedores: ProveedorOptionParaGastoFijo[];
  cuentas: CuentaGastoOption[];
}) {
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {gastos.length} gasto{gastos.length === 1 ? "" : "s"} fijo
          {gastos.length === 1 ? "" : "s"} configurado
          {gastos.length === 1 ? "" : "s"}.
        </p>
        <Button
          size="sm"
          onClick={() => setDialog({ mode: "create" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo gasto fijo
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descripción</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead>Cuenta gasto</TableHead>
            <TableHead className="text-right">Monto neto</TableHead>
            <TableHead className="text-right">Día venc.</TableHead>
            <TableHead>Último registro</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-[200px] text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {gastos.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                Sin gastos fijos. Creá uno para empezar.
              </TableCell>
            </TableRow>
          ) : (
            gastos.map((g) => (
              <TableRow key={g.id} className={g.activo ? "" : "opacity-60"}>
                <TableCell className="font-medium">{g.descripcion}</TableCell>
                <TableCell>{g.proveedorNombre}</TableCell>
                <TableCell className="font-mono text-xs">
                  {g.cuentaGastoCodigo
                    ? `${g.cuentaGastoCodigo} · ${g.cuentaGastoNombre}`
                    : "— default por proveedor —"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {g.moneda} {fmtMoney(g.montoNeto)}
                  <div className="text-xs text-muted-foreground">
                    +{g.ivaPorcentaje}% IVA
                    {Number(g.iibbPorcentaje) > 0
                      ? ` · +${g.iibbPorcentaje}% IIBB`
                      : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {g.diaVencimiento ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {g.ultimoRegistro
                    ? `${String(g.ultimoRegistro.month).padStart(2, "0")}/${g.ultimoRegistro.year} · ${fmtMoney(g.ultimoRegistro.total)}`
                    : "—"}
                  {g.registrosCount > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {g.registrosCount} registros totales
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {g.activo ? (
                    <Badge variant="default">Activo</Badge>
                  ) : (
                    <Badge variant="secondary">Inactivo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={!g.activo}
                      title="Registrar este gasto en un período"
                      onClick={() => setDialog({ mode: "registrar", row: g })}
                    >
                      <HugeiconsIcon icon={PlayCircleIcon} strokeWidth={2} />
                      Registrar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Editar template"
                      onClick={() => setDialog({ mode: "edit", row: g })}
                    >
                      <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <GastoFijoFormDialog
        state={dialog?.mode === "create" || dialog?.mode === "edit" ? dialog : null}
        proveedores={proveedores}
        cuentas={cuentas}
        onClose={() => setDialog(null)}
      />
      <RegistrarDialog
        state={dialog?.mode === "registrar" ? dialog : null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function GastoFijoFormDialog({
  state,
  proveedores,
  cuentas,
  onClose,
}: {
  state: { mode: "create" } | { mode: "edit"; row: GastoFijoRow } | null;
  proveedores: ProveedorOptionParaGastoFijo[];
  cuentas: CuentaGastoOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const editing = state?.mode === "edit" ? state.row : null;

  const [descripcion, setDescripcion] = useState(editing?.descripcion ?? "");
  const [proveedorId, setProveedorId] = useState(editing?.proveedorId ?? "");
  const [cuentaGastoId, setCuentaGastoId] = useState<number | null>(
    editing?.cuentaGastoContableId ?? null,
  );
  const [moneda, setMoneda] = useState<"ARS" | "USD">(editing?.moneda ?? "ARS");
  const [montoNeto, setMontoNeto] = useState(editing?.montoNeto ?? "");
  const [ivaPorcentaje, setIvaPorcentaje] = useState(editing?.ivaPorcentaje ?? "21");
  const [iibbPorcentaje, setIibbPorcentaje] = useState(
    editing?.iibbPorcentaje ?? "0",
  );
  const [diaVencimiento, setDiaVencimiento] = useState(
    editing?.diaVencimiento != null ? String(editing.diaVencimiento) : "",
  );
  const [activo, setActivo] = useState(editing?.activo ?? true);
  const [notas, setNotas] = useState(editing?.notas ?? "");

  // Reset state when dialog opens with different state
  useMemo(() => {
    if (!state) return;
    const r = state.mode === "edit" ? state.row : null;
    setDescripcion(r?.descripcion ?? "");
    setProveedorId(r?.proveedorId ?? "");
    setCuentaGastoId(r?.cuentaGastoContableId ?? null);
    setMoneda(r?.moneda ?? "ARS");
    setMontoNeto(r?.montoNeto ?? "");
    setIvaPorcentaje(r?.ivaPorcentaje ?? "21");
    setIibbPorcentaje(r?.iibbPorcentaje ?? "0");
    setDiaVencimiento(r?.diaVencimiento != null ? String(r.diaVencimiento) : "");
    setActivo(r?.activo ?? true);
    setNotas(r?.notas ?? "");
  }, [state]);

  if (!state) return null;

  const proveedorSeleccionado = proveedores.find((p) => p.id === proveedorId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    if (!descripcion.trim()) {
      toast.error("Descripción obligatoria.");
      return;
    }
    if (!proveedorId) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (!montoNeto || Number(montoNeto) <= 0) {
      toast.error("Monto neto debe ser > 0.");
      return;
    }

    const payload: GastoFijoInput = {
      descripcion: descripcion.trim(),
      proveedorId,
      cuentaGastoContableId: cuentaGastoId,
      moneda,
      montoNeto,
      ivaPorcentaje,
      iibbPorcentaje,
      diaVencimiento: diaVencimiento ? Number(diaVencimiento) : null,
      activo,
      notas: notas.trim() || undefined,
    };

    startTransition(async () => {
      const result =
        state.mode === "edit"
          ? await actualizarGastoFijoAction(state.row.id, payload)
          : await crearGastoFijoAction(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(state.mode === "edit" ? "Gasto actualizado." : "Gasto creado.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(o) => !o && onClose()}
    >
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "edit" ? "Editar gasto fijo" : "Nuevo gasto fijo"}
          </DialogTitle>
          <DialogDescription>
            Configurá un template para gastos recurrentes (ej: "Alquiler
            escritorio", "Honorarios contador"). Después registrá cada mes
            con el botón "Registrar".
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="descripcion">Descripción *</Label>
            <Input
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Alquiler escritorio Maipú"
              maxLength={255}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Proveedor *</Label>
              <Select
                value={proveedorId}
                onValueChange={(v) => {
                  if (!v) return;
                  setProveedorId(v);
                  // Auto-fill cuenta gasto from proveedor if not set
                  const p = proveedores.find((p) => p.id === v);
                  if (p?.cuentaGastoContableId && !cuentaGastoId) {
                    setCuentaGastoId(p.cuentaGastoContableId);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar...">
                    {(value) => {
                      if (!value) return "Seleccionar...";
                      const p = proveedores.find((p) => p.id === value);
                      return p?.nombre ?? "Seleccionar...";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Moneda</Label>
              <Select
                value={moneda}
                onValueChange={(v) => v && setMoneda(v as "ARS" | "USD")}
              >
                <SelectTrigger>
                  <SelectValue>{(v) => v ?? "ARS"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cuenta de gasto (override)</Label>
            <CuentaCombobox
              value={cuentaGastoId}
              onChange={setCuentaGastoId}
              cuentas={cuentas}
              placeholder={
                proveedorSeleccionado?.cuentaGastoContableId
                  ? `Default del proveedor — opcional override`
                  : "Default por tipo de proveedor — opcional override"
              }
            />
            <p className="text-xs text-muted-foreground">
              Si vacío, usa la cuenta de gasto del proveedor (o el default por
              tipo).
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="monto">Monto neto *</Label>
              <Input
                id="monto"
                value={montoNeto}
                onChange={(e) => setMontoNeto(e.target.value)}
                placeholder="100000.00"
                inputMode="decimal"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="iva">% IVA</Label>
              <Input
                id="iva"
                value={ivaPorcentaje}
                onChange={(e) => setIvaPorcentaje(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="iibb">% IIBB</Label>
              <Input
                id="iibb"
                value={iibbPorcentaje}
                onChange={(e) => setIibbPorcentaje(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dia">Día de vencimiento (1-28)</Label>
              <Input
                id="dia"
                type="number"
                min={1}
                max={28}
                value={diaVencimiento}
                onChange={(e) => setDiaVencimiento(e.target.value)}
                placeholder="ej: 10"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Estado</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                />
                <span>Activo (visible para registrar)</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notas">Notas</Label>
            <Textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button">Cancelar</Button>} />
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : state.mode === "edit" ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegistrarDialog({
  state,
  onClose,
}: {
  state: { mode: "registrar"; row: GastoFijoRow } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [tipoCambio, setTipoCambio] = useState("1");

  if (!state) return null;
  const g = state.row;

  const fechaIso =
    g.diaVencimiento != null
      ? `${year}-${String(month).padStart(2, "0")}-${String(g.diaVencimiento).padStart(2, "0")}`
      : `${year}-${String(month).padStart(2, "0")}-01`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await registrarGastoFijoAction({
        gastoFijoId: g.id,
        year,
        month,
        fecha: new Date(fechaIso + "T12:00:00Z"),
        tipoCambio: g.moneda === "ARS" ? "1" : tipoCambio,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Asiento generado — ${String(month).padStart(2, "0")}/${year}.`);
      onClose();
      router.refresh();
    });
  }

  const yearOptions = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  return (
    <Dialog open={Boolean(state)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Registrar gasto fijo</DialogTitle>
          <DialogDescription>
            {g.descripcion} · {g.proveedorNombre}
            <br />
            Genera un asiento contable contabilizado y deja la cuenta a pagar
            lista en Tesorería.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>Mes</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => v && setMonth(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v) => MESES[Number(v) - 1] ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MESES.map((nombre, idx) => (
                    <SelectItem key={idx + 1} value={String(idx + 1)}>
                      {nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Año</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => v && setYear(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue>{(v) => String(v ?? "")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <p>
              <strong>Fecha del asiento:</strong> {fechaIso}
            </p>
            <p>
              <strong>Monto:</strong> {g.moneda} {fmtMoney(g.montoNeto)} +{" "}
              {g.ivaPorcentaje}% IVA
              {Number(g.iibbPorcentaje) > 0
                ? ` + ${g.iibbPorcentaje}% IIBB`
                : ""}
            </p>
          </div>

          {g.moneda === "USD" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tc">Tipo de cambio (USD → ARS)</Label>
              <Input
                id="tc"
                value={tipoCambio}
                onChange={(e) => setTipoCambio(e.target.value)}
                inputMode="decimal"
              />
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button">Cancelar</Button>} />
            <Button type="submit" disabled={isPending}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
              {isPending ? "Registrando…" : "Registrar y contabilizar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
