"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowReloadHorizontalIcon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  MinusSignIcon,
  MultiplicationSignIcon,
} from "@hugeicons/core-free-icons";

import {
  aprobarLineaAction,
  desaprobarLineaAction,
  editarLineaAction,
  ignorarLineaAction,
  rechazarLineaAction,
  revertirLineaAction,
} from "@/lib/actions/extractos";
import { fmtDate, fmtMoney } from "@/lib/format";

const LineaExtractoStatus = {
  PENDIENTE: "PENDIENTE",
  APROBADA: "APROBADA",
  RECHAZADA: "RECHAZADA",
  IGNORADA: "IGNORADA",
} as const;
type LineaExtractoStatus = (typeof LineaExtractoStatus)[keyof typeof LineaExtractoStatus];
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

export type CuentaOption = {
  id: number;
  codigo: string;
  nombre: string;
};

export type ProveedorOption = {
  id: string;
  nombre: string;
  cuit: string | null;
  cuentaContableId: number | null;
};

export type ClienteOption = {
  id: string;
  nombre: string;
  cuit: string | null;
  cuentaContableId: number | null;
};

export type LineaRow = {
  id: string;
  ordenLinea: number;
  fecha: string;
  descripcion: string;
  comprobante: string | null;
  monto: string;
  saldoExtracto: string | null;
  cuentaSugeridaId: number | null;
  cuentaSugeridaCodigo: string | null;
  cuentaSugeridaNombre: string | null;
  proveedorSugeridoId: string | null;
  proveedorNombre: string | null;
  clienteSugeridoId: string | null;
  clienteNombre: string | null;
  descripcionAsiento: string | null;
  confianza: "ALTA" | "MEDIA" | "BAJA" | null;
  razonSugerencia: string | null;
  notas: string | null;
  status: LineaExtractoStatus;
};

const STATUS_VARIANT: Record<
  LineaExtractoStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDIENTE: "outline",
  APROBADA: "default",
  RECHAZADA: "destructive",
  IGNORADA: "secondary",
};

const STATUS_LABEL: Record<LineaExtractoStatus, string> = {
  PENDIENTE: "Pendiente",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  IGNORADA: "Ignorada",
};

const CONFIANZA_VARIANT: Record<
  "ALTA" | "MEDIA" | "BAJA",
  "default" | "secondary" | "outline"
> = {
  ALTA: "default",
  MEDIA: "secondary",
  BAJA: "outline",
};

export function LineasReview({
  importacionId: _importacionId,
  lineas,
  cuentas,
  proveedores,
  clientes,
}: {
  importacionId: string;
  lineas: LineaRow[];
  cuentas: CuentaOption[];
  proveedores: ProveedorOption[];
  clientes: ClienteOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const editingLinea = useMemo(
    () => (editingId ? lineas.find((l) => l.id === editingId) ?? null : null),
    [editingId, lineas],
  );

  function handleAction(
    fn: () => Promise<{ ok: true } | { ok: true; movimientoId: string } | { ok: false; error: string }>,
    successMsg: string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  async function bulkAprobarConfianzaAlta() {
    const candidatas = lineas.filter(
      (l) => l.status === LineaExtractoStatus.PENDIENTE && l.confianza === "ALTA" && resolverContrapartida(l) !== null,
    );
    if (candidatas.length === 0) {
      toast.info("No hay líneas pendientes de confianza ALTA con contrapartida resuelta.");
      return;
    }
    if (!confirm(`Aprobar ${candidatas.length} líneas de confianza ALTA?`)) return;

    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const l of candidatas) {
      const r = await aprobarLineaAction(l.id);
      if (r.ok) ok++;
      else {
        fail++;
        console.warn(`[bulk-aprobar] ${l.descripcion}: ${r.error}`);
      }
    }
    setBulkRunning(false);
    toast.success(`Aprobadas ${ok} líneas${fail > 0 ? ` (${fail} fallaron — revisá la consola)` : ""}.`);
    router.refresh();
  }

  function resolverContrapartida(l: LineaRow): number | null {
    if (l.cuentaSugeridaId) return l.cuentaSugeridaId;
    if (l.proveedorSugeridoId) {
      const p = proveedores.find((x) => x.id === l.proveedorSugeridoId);
      if (p?.cuentaContableId) return p.cuentaContableId;
    }
    if (l.clienteSugeridoId) {
      const c = clientes.find((x) => x.id === l.clienteSugeridoId);
      if (c?.cuentaContableId) return c.cuentaContableId;
    }
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Líneas del extracto</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={bulkRunning || isPending}
          onClick={bulkAprobarConfianzaAlta}
        >
          {bulkRunning ? "Aprobando…" : "Aprobar todas confianza ALTA"}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[90px]">Fecha</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead>Sugerencia</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[260px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineas.map((l) => {
              const monto = Number(l.monto);
              const isPositive = monto > 0;
              const sugerencia = l.cuentaSugeridaCodigo
                ? `${l.cuentaSugeridaCodigo} ${l.cuentaSugeridaNombre ?? ""}`.trim()
                : l.proveedorNombre
                  ? `Proveedor: ${l.proveedorNombre}`
                  : l.clienteNombre
                    ? `Cliente: ${l.clienteNombre}`
                    : null;
              const contrapartida = resolverContrapartida(l);
              const isPendiente = l.status === LineaExtractoStatus.PENDIENTE;

              return (
                <TableRow key={l.id} className={isPendiente ? "" : "opacity-60"}>
                  <TableCell className="text-xs tabular-nums">
                    {fmtDate(new Date(l.fecha))}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <p className="text-sm">{l.descripcion}</p>
                    {l.comprobante ? (
                      <p className="text-xs text-muted-foreground">Comp.: {l.comprobante}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    {sugerencia ? (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs">{sugerencia}</p>
                        {l.confianza ? (
                          <Badge
                            variant={CONFIANZA_VARIANT[l.confianza]}
                            className="w-fit"
                          >
                            {l.confianza}
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Sin sugerencia — editá la línea
                      </span>
                    )}
                    {l.razonSugerencia ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {l.razonSugerencia}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      isPositive
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {fmtMoney(l.monto)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[l.status]}>
                      {STATUS_LABEL[l.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isPendiente ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={isPending || !contrapartida}
                          title={
                            contrapartida ? "Aprobar y crear movimiento" : "Falta contrapartida — editá primero"
                          }
                          onClick={() =>
                            handleAction(
                              () => aprobarLineaAction(l.id),
                              "Línea aprobada — movimiento generado.",
                            )
                          }
                        >
                          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                          Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          title="Editar sugerencia"
                          onClick={() => setEditingId(l.id)}
                        >
                          <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          title="Ignorar — no genera asiento (ej: línea ya conciliada o no contable)"
                          onClick={() =>
                            handleAction(
                              () => ignorarLineaAction(l.id),
                              "Línea ignorada.",
                            )
                          }
                        >
                          <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} />
                          Ignorar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          title="Rechazar — descartar sugerencia"
                          onClick={() =>
                            handleAction(
                              () => rechazarLineaAction(l.id),
                              "Línea rechazada.",
                            )
                          }
                        >
                          <HugeiconsIcon icon={MultiplicationSignIcon} strokeWidth={2} />
                        </Button>
                      </div>
                    ) : l.status === LineaExtractoStatus.IGNORADA ||
                      l.status === LineaExtractoStatus.RECHAZADA ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        title="Volver a pendiente"
                        onClick={() =>
                          handleAction(
                            () => revertirLineaAction(l.id),
                            "Línea reactivada — pendiente de revisión.",
                          )
                        }
                      >
                        <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} />
                        Reactivar
                      </Button>
                    ) : l.status === LineaExtractoStatus.APROBADA ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        title="Anula el asiento, elimina el movimiento y vuelve a pendiente"
                        onClick={() => {
                          if (
                            confirm(
                              "¿Desaprobar esta línea? Se anulará el asiento contabilizado y el movimiento asociado.",
                            )
                          ) {
                            handleAction(
                              () => desaprobarLineaAction(l.id),
                              "Línea desaprobada — asiento anulado.",
                            );
                          }
                        }}
                      >
                        <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} />
                        Desaprobar
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <EditarLineaDialog
        linea={editingLinea}
        cuentas={cuentas}
        proveedores={proveedores}
        clientes={clientes}
        onClose={() => setEditingId(null)}
      />
    </>
  );
}

function EditarLineaDialog({
  linea,
  cuentas,
  proveedores,
  clientes,
  onClose,
}: {
  linea: LineaRow | null;
  cuentas: CuentaOption[];
  proveedores: ProveedorOption[];
  clientes: ClienteOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cuentaId, setCuentaId] = useState<number | null>(linea?.cuentaSugeridaId ?? null);
  const [proveedorId, setProveedorId] = useState<string | null>(linea?.proveedorSugeridoId ?? null);
  const [clienteId, setClienteId] = useState<string | null>(linea?.clienteSugeridoId ?? null);
  const [descripcionAsiento, setDescripcionAsiento] = useState<string>(
    linea?.descripcionAsiento ?? "",
  );
  const [notas, setNotas] = useState<string>(linea?.notas ?? "");

  // Re-sync when changing line
  useMemo(() => {
    if (linea) {
      setCuentaId(linea.cuentaSugeridaId);
      setProveedorId(linea.proveedorSugeridoId);
      setClienteId(linea.clienteSugeridoId);
      setDescripcionAsiento(linea.descripcionAsiento ?? "");
      setNotas(linea.notas ?? "");
    }
  }, [linea]);

  if (!linea) return null;

  function handleSave() {
    if (!linea) return;
    startTransition(async () => {
      const r = await editarLineaAction({
        lineaId: linea.id,
        cuentaSugeridaId: cuentaId,
        proveedorSugeridoId: proveedorId,
        clienteSugeridoId: clienteId,
        descripcionAsiento: descripcionAsiento.trim() || null,
        notas: notas.trim() || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Línea actualizada.");
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open={Boolean(linea)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Editar sugerencia</DialogTitle>
          <DialogDescription>
            {linea.descripcion} — {fmtMoney(linea.monto)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Cuenta contrapartida</Label>
            <CuentaCombobox
              value={cuentaId}
              onChange={(id) => {
                setCuentaId(id);
                setProveedorId(null);
                setClienteId(null);
              }}
              cuentas={cuentas}
              placeholder="Buscar cuenta..."
            />
            <p className="text-[11px] text-muted-foreground">
              Para impuestos, comisiones y FCI. Si es pago a proveedor o cobro de
              cliente, dejá vacío y elegí entidad abajo.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Proveedor</Label>
              <Select
                value={proveedorId ?? "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") setProveedorId(null);
                  else {
                    setProveedorId(v);
                    setCuentaId(null);
                    setClienteId(null);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor">
                    {(value) => {
                      if (!value || value === "__none__") return "— Sin proveedor —";
                      const p = proveedores.find((p) => p.id === value);
                      return p
                        ? `${p.nombre}${p.cuit ? ` (${p.cuit})` : ""}`
                        : "— Sin proveedor —";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Sin proveedor —</SelectItem>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {`${p.nombre}${p.cuit ? ` (${p.cuit})` : ""}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Cliente</Label>
              <Select
                value={clienteId ?? "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") setClienteId(null);
                  else {
                    setClienteId(v);
                    setCuentaId(null);
                    setProveedorId(null);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin cliente">
                    {(value) => {
                      if (!value || value === "__none__") return "— Sin cliente —";
                      const c = clientes.find((c) => c.id === value);
                      return c
                        ? `${c.nombre}${c.cuit ? ` (${c.cuit})` : ""}`
                        : "— Sin cliente —";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Sin cliente —</SelectItem>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {`${c.nombre}${c.cuit ? ` (${c.cuit})` : ""}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="desc-asiento">Descripción del asiento</Label>
            <Input
              id="desc-asiento"
              value={descripcionAsiento}
              onChange={(e) => setDescripcionAsiento(e.target.value)}
              placeholder={linea.descripcion}
              maxLength={500}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notas">Notas internas (opcional)</Label>
            <Textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancelar</Button>} />
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
