"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, LockIcon } from "@hugeicons/core-free-icons";

import {
  crearContenedorAction,
  actualizarPackingListAction,
  avanzarEstadoContenedorAction,
  revertirEstadoContenedorAction,
  cerrarCostosContenedorAction,
  eliminarContenedorAction,
} from "@/lib/actions/contenedores";
import type { ContenedorPackingDTO } from "@/lib/services/contenedor";
import type { ProductoOption } from "@/components/producto-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ============================================================
// PR 2.3 — Matriz de packing list (contenedores) del embarque
// ============================================================
//
// Sección del embarque-form detrás de la flag CONTENEDOR_DESCONSOLIDACION_ENABLED
// (sólo modo edit). Edita el packing list: crear contenedores, agregar/quitar
// líneas de producto (cantidadDeclarada) y guardarlas con bloqueo optimista
// (token Contenedor.updatedAt). La invariante (Σ cantidadDeclarada por producto
// vs ItemEmbarque.cantidad) se calcula localmente sobre los datos persistidos.
//
// Los datos llegan del server (props.contenedores) y se refrescan vía
// router.refresh() tras cada acción.

interface ProductoEmbarque {
  productoId: string;
  cantidad: number;
}

interface DepositoOpt {
  id: string;
  nombre: string;
}

interface Props {
  embarqueId: string;
  productos: ProductoOption[];
  itemsEmbarque: ProductoEmbarque[];
  contenedores: ContenedorPackingDTO[];
  depositos: DepositoOpt[];
  readonly: boolean;
}

// Orden de las fases físicas/aduaneras que se avanzan manualmente. (No se
// importa ESTADO_RANK del service porque es server-only.) Las fases de
// despacho (DESCONSOLIDADO+) las maneja la desconsolidación/despacho.
const FASES_FISICAS = [
  "BORRADOR",
  "EN_TRANSITO",
  "ARRIBADO_PUERTO",
  "EN_ZONA_PRIMARIA",
  "TRASLADO_DEPOSITO_FISCAL",
  "EN_DEPOSITO_FISCAL",
] as const;
type FaseFisica = (typeof FASES_FISICAS)[number];
// Estados-destino válidos para avanzar (excluye BORRADOR, el origen del ciclo).
// Coincide con el enum targetEstado de avanzarEstadoContenedorAction.
type EstadoAvanzable = Exclude<FaseFisica, "BORRADOR">;
// Estados-destino válidos para revertir (excluye EN_DEPOSITO_FISCAL, el último
// del ciclo físico). Coincide con el enum de revertirEstadoContenedorAction.
type EstadoRevertible = Exclude<FaseFisica, "EN_DEPOSITO_FISCAL">;

const FASE_LABEL: Record<FaseFisica, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  ARRIBADO_PUERTO: "Arribado a puerto",
  EN_ZONA_PRIMARIA: "En zona primaria",
  TRASLADO_DEPOSITO_FISCAL: "Traslado a depósito fiscal",
  EN_DEPOSITO_FISCAL: "En depósito fiscal",
};

interface FilaItem {
  key: string;
  productoId: string;
  cantidadDeclarada: number;
}

let filaSeq = 0;
const nuevaFilaKey = () => `fila-${filaSeq++}`;

export function ContenedorMatriz(props: Props) {
  const { embarqueId, productos, itemsEmbarque, contenedores, depositos, readonly } = props;
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const [numero, setNumero] = useState("");
  const [tipo, setTipo] = useState("");

  const productoLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of productos) map.set(p.id, `${p.codigo} — ${p.nombre}`);
    return map;
  }, [productos]);

  // Productos válidos = los que pertenecen al embarque.
  const opcionesProducto = useMemo(
    () =>
      itemsEmbarque.map((ie) => ({
        productoId: ie.productoId,
        label: productoLabel.get(ie.productoId) ?? ie.productoId,
        esperado: ie.cantidad,
      })),
    [itemsEmbarque, productoLabel],
  );

  // Invariante: Σ cantidadDeclarada por producto (persistido) vs esperado.
  const invariante = useMemo(() => {
    const declarado = new Map<string, number>();
    for (const c of contenedores) {
      for (const it of c.items) {
        declarado.set(it.productoId, (declarado.get(it.productoId) ?? 0) + it.cantidadDeclarada);
      }
    }
    return opcionesProducto.map((op) => {
      const total = declarado.get(op.productoId) ?? 0;
      return { ...op, declarado: total, diferencia: total - op.esperado };
    });
  }, [contenedores, opcionesProducto]);

  const todoCuadra = invariante.every((i) => i.diferencia === 0);

  const onCrear = () => {
    const num = numero.trim();
    if (!num) {
      toast.error("Ingresá el número de contenedor.");
      return;
    }
    startCreate(async () => {
      const r = await crearContenedorAction({
        embarqueId,
        numeroContenedor: num,
        tipo: tipo.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Contenedor ${num} creado.`);
      setNumero("");
      setTipo("");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Contenedores (packing list)</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              todoCuadra
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            }`}
          >
            {todoCuadra ? "Packing list cuadra" : "Hay diferencias con el embarque"}
          </span>
        </div>

        {/* Invariante por producto */}
        {invariante.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Producto</th>
                  <th className="px-3 py-2 text-right font-medium">Embarque</th>
                  <th className="px-3 py-2 text-right font-medium">Declarado</th>
                  <th className="px-3 py-2 text-right font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {invariante.map((i) => (
                  <tr key={i.productoId} className="border-t">
                    <td className="px-3 py-1.5">{i.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{i.esperado}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{i.declarado}</td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        i.diferencia === 0 ? "text-muted-foreground" : "font-medium text-amber-600"
                      }`}
                    >
                      {i.diferencia > 0 ? `+${i.diferencia}` : i.diferencia}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Contenedores existentes */}
        <div className="flex flex-col gap-3">
          {contenedores.length === 0 && (
            <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              Todavía no hay contenedores cargados para este embarque.
            </p>
          )}
          {contenedores.map((c) => (
            <ContenedorCard
              key={`${c.id}-${c.updatedAt}`}
              contenedor={c}
              opcionesProducto={opcionesProducto}
              depositos={depositos}
              readonly={readonly}
            />
          ))}
        </div>

        {/* Alta de contenedor */}
        {!readonly && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="nuevo-contenedor-numero">
                Nº contenedor
              </label>
              <Input
                id="nuevo-contenedor-numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="MSCU0000001"
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="nuevo-contenedor-tipo">
                Tipo (opcional)
              </label>
              <Input
                id="nuevo-contenedor-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                placeholder="40HC"
                className="w-32"
              />
            </div>
            <Button type="button" variant="secondary" onClick={onCrear} disabled={creating}>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Agregar contenedor
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ContenedorCardProps {
  contenedor: ContenedorPackingDTO;
  opcionesProducto: Array<{ productoId: string; label: string; esperado: number }>;
  depositos: DepositoOpt[];
  readonly: boolean;
}

function ContenedorCard({
  contenedor,
  opcionesProducto,
  depositos,
  readonly,
}: ContenedorCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAvanzar, setShowAvanzar] = useState(false);
  const [showRevertir, setShowRevertir] = useState(false);
  const [showCostos, setShowCostos] = useState(false);
  const [filas, setFilas] = useState<FilaItem[]>(() =>
    contenedor.items.map((it) => ({
      key: nuevaFilaKey(),
      productoId: it.productoId,
      cantidadDeclarada: it.cantidadDeclarada,
    })),
  );

  const editable = contenedor.editable && !readonly;

  const faseIdx = FASES_FISICAS.indexOf(contenedor.estado as FaseFisica);
  const puedeAvanzar =
    !readonly && faseIdx >= 0 && faseIdx < FASES_FISICAS.indexOf("EN_DEPOSITO_FISCAL");
  // Revertir: el contenedor está en alguna fase física posterior a BORRADOR y
  // aún no se desconsolidó (DESCONSOLIDADO+ no figura en FASES_FISICAS, así que
  // faseIdx > 0 ya lo restringe al ciclo físico). El service revalida igual.
  const puedeRevertir = !readonly && faseIdx > 0;

  const addFila = () =>
    setFilas((prev) => [
      ...prev,
      {
        key: nuevaFilaKey(),
        productoId: opcionesProducto[0]?.productoId ?? "",
        cantidadDeclarada: 1,
      },
    ]);

  const removeFila = (key: string) => setFilas((prev) => prev.filter((f) => f.key !== key));

  const updateFila = (key: string, patch: Partial<FilaItem>) =>
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const onGuardar = () => {
    const items = filas
      .filter((f) => f.productoId)
      .map((f) => ({
        productoId: f.productoId,
        cantidadDeclarada: Math.trunc(f.cantidadDeclarada),
      }));
    if (items.length === 0) {
      toast.error("Agregá al menos una línea (o eliminá el contenedor).");
      return;
    }
    if (items.some((i) => i.cantidadDeclarada <= 0)) {
      toast.error("Las cantidades deben ser mayores a cero.");
      return;
    }
    startTransition(async () => {
      const r = await actualizarPackingListAction({
        contenedorId: contenedor.id,
        expectedUpdatedAt: contenedor.updatedAt,
        items,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Packing list de ${contenedor.numeroContenedor} guardado.`);
      router.refresh();
    });
  };

  const onEliminar = () => {
    startTransition(async () => {
      const r = await eliminarContenedorAction(contenedor.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Contenedor ${contenedor.numeroContenedor} eliminado.`);
      router.refresh();
    });
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{contenedor.numeroContenedor}</span>
          {contenedor.tipo && <span className="text-muted-foreground">· {contenedor.tipo}</span>}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {contenedor.estado}
          </span>
          {!editable && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <HugeiconsIcon icon={LockIcon} className="size-3" />
              no editable
            </span>
          )}
        </div>
        {contenedor.estado === "EN_DEPOSITO_FISCAL" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/comex/contenedores/${contenedor.id}/desconsolidacion`)}
          >
            Desconsolidar
          </Button>
        )}
        {contenedor.estado === "AGUARDANDO_INVESTIGACAO" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/comex/contenedores/${contenedor.id}/investigacion`)}
          >
            Investigar divergencia
          </Button>
        )}
        {puedeAvanzar && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAvanzar((v) => !v)}
          >
            Avanzar estado
          </Button>
        )}
        {puedeRevertir && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowRevertir((v) => !v)}
          >
            Revertir estado
          </Button>
        )}
        {editable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCostos((v) => !v)}
          >
            Cerrar costos
          </Button>
        )}
        {editable && (
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs text-muted-foreground">¿Eliminar?</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onEliminar}
                  disabled={pending}
                >
                  Confirmar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
              >
                <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                Eliminar
              </Button>
            )}
          </div>
        )}
      </div>

      {showAvanzar && puedeAvanzar && (
        <AvanzarEstadoPanel
          contenedor={contenedor}
          depositos={depositos}
          faseIdx={faseIdx}
          onClose={() => setShowAvanzar(false)}
        />
      )}

      {showRevertir && puedeRevertir && (
        <RevertirEstadoPanel
          contenedor={contenedor}
          faseIdx={faseIdx}
          onClose={() => setShowRevertir(false)}
        />
      )}

      {showCostos && editable && (
        <CerrarCostosPanel
          contenedor={contenedor}
          opcionesProducto={opcionesProducto}
          onClose={() => setShowCostos(false)}
        />
      )}

      <div className="overflow-x-auto p-3">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Producto</th>
              <th className="py-1 text-right font-medium">Cantidad declarada</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.key} className="border-t">
                <td className="py-1.5 pr-2">
                  <select
                    value={fila.productoId}
                    disabled={!editable}
                    onChange={(e) => updateFila(fila.key, { productoId: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
                  >
                    <option value="">— seleccionar —</option>
                    {opcionesProducto.map((op) => (
                      <option key={op.productoId} value={op.productoId}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 text-right">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    disabled={!editable}
                    value={fila.cantidadDeclarada}
                    onChange={(e) =>
                      updateFila(fila.key, { cantidadDeclarada: Number(e.target.value) })
                    }
                    className="ml-auto w-28 text-right tabular-nums"
                  />
                </td>
                <td className="py-1.5 pl-2 text-right">
                  {editable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFila(fila.key)}
                      disabled={pending}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-center text-xs text-muted-foreground">
                  Sin líneas. Agregá productos del embarque.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {editable && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addFila} disabled={pending}>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Agregar línea
            </Button>
            <Button type="button" size="sm" onClick={onGuardar} disabled={pending}>
              Guardar packing list
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface AvanzarEstadoPanelProps {
  contenedor: ContenedorPackingDTO;
  depositos: DepositoOpt[];
  faseIdx: number;
  onClose: () => void;
}

/** Panel para avanzar el estado físico/aduanero del contenedor (Ponte PR A). */
function AvanzarEstadoPanel({ contenedor, depositos, faseIdx, onClose }: AvanzarEstadoPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // El avance nunca tiene como destino BORRADOR (es el origen del ciclo).
  const opciones = FASES_FISICAS.slice(faseIdx + 1) as EstadoAvanzable[];
  const [target, setTarget] = useState<EstadoAvanzable>(opciones[0] ?? "EN_DEPOSITO_FISCAL");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [depositoId, setDepositoId] = useState("");

  const pideDeposito = target === "EN_ZONA_PRIMARIA" || target === "EN_DEPOSITO_FISCAL";
  const labelDeposito =
    target === "EN_DEPOSITO_FISCAL" ? "Depósito fiscal" : "Depósito zona primaria";

  const onConfirmar = () => {
    if (pideDeposito && !depositoId) {
      toast.error(`Seleccioná el ${labelDeposito.toLowerCase()}.`);
      return;
    }
    startTransition(async () => {
      const r = await avanzarEstadoContenedorAction({
        contenedorId: contenedor.id,
        targetEstado: target,
        fecha: fecha ? new Date(`${fecha}T12:00:00.000Z`) : undefined,
        depositoZonaPrimariaId: target === "EN_ZONA_PRIMARIA" ? depositoId : undefined,
        depositoFiscalId: target === "EN_DEPOSITO_FISCAL" ? depositoId : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${contenedor.numeroContenedor} → ${FASE_LABEL[target]}.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-b bg-muted/20 px-3 py-2">
      <div className="flex flex-col gap-1">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`avanzar-target-${contenedor.id}`}
        >
          Nuevo estado
        </label>
        <select
          id={`avanzar-target-${contenedor.id}`}
          value={target}
          onChange={(e) => setTarget(e.target.value as EstadoAvanzable)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {opciones.map((op) => (
            <option key={op} value={op}>
              {FASE_LABEL[op]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor={`avanzar-fecha-${contenedor.id}`}>
          Fecha
        </label>
        <Input
          id={`avanzar-fecha-${contenedor.id}`}
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="w-40"
        />
      </div>
      {pideDeposito && (
        <div className="flex flex-col gap-1">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`avanzar-deposito-${contenedor.id}`}
          >
            {labelDeposito}
          </label>
          <select
            id={`avanzar-deposito-${contenedor.id}`}
            value={depositoId}
            onChange={(e) => setDepositoId(e.target.value)}
            className="h-9 w-56 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">— seleccionar —</option>
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>
      )}
      <Button type="button" size="sm" onClick={onConfirmar} disabled={pending}>
        Confirmar
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
        Cancelar
      </Button>
    </div>
  );
}

interface RevertirEstadoPanelProps {
  contenedor: ContenedorPackingDTO;
  faseIdx: number;
  onClose: () => void;
}

/**
 * Panel para revertir el estado físico/aduanero del contenedor a la fase
 * inmediatamente anterior (gap #6). Deshace una fase mal avanzada (ej.: pasar a
 * EN_DEPOSITO_FISCAL antes de cerrar costos) — el service prohíbe revertir un
 * contenedor ya desconsolidado o con stock generado.
 */
function RevertirEstadoPanel({ contenedor, faseIdx, onClose }: RevertirEstadoPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // El estado anterior es el de rank-1 dentro del ciclo físico.
  const anterior = FASES_FISICAS[faseIdx - 1] as EstadoRevertible;

  const onConfirmar = () => {
    startTransition(async () => {
      const r = await revertirEstadoContenedorAction({
        contenedorId: contenedor.id,
        targetEstado: anterior,
        expectedUpdatedAt: contenedor.updatedAt,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${contenedor.numeroContenedor} → ${FASE_LABEL[anterior]}.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        Revertir <strong>{FASE_LABEL[contenedor.estado as FaseFisica]}</strong> →{" "}
        <strong>{FASE_LABEL[anterior]}</strong>. Se limpia la fecha de la fase que se deshace.
      </p>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" size="sm" onClick={onConfirmar} disabled={pending}>
          Confirmar reversión
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

interface CerrarCostosPanelProps {
  contenedor: ContenedorPackingDTO;
  opcionesProducto: Array<{ productoId: string; label: string; esperado: number }>;
  onClose: () => void;
}

/**
 * Panel para cerrar los costos del contenedor (Ponte PR B). Lista los SKU del
 * packing list con su costoFCUnitario (USD). El valor en blanco se deriva del
 * rateo del embarque (FOB + flete/seguro origen + facturas ZP) ÷ TC; un valor
 * cargado pisa esa derivación como override manual.
 */
function CerrarCostosPanel({ contenedor, opcionesProducto, onClose }: CerrarCostosPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const op of opcionesProducto) m.set(op.productoId, op.label);
    return m;
  }, [opcionesProducto]);

  // SKU distintos del packing list, con su costoFCUnitario persistido (si ya
  // fue cerrado antes) precargado en el input.
  const skus = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of contenedor.items) {
      if (!m.has(it.productoId)) m.set(it.productoId, it.costoFCUnitario ?? "");
    }
    return Array.from(m, ([productoId, costo]) => ({ productoId, costo }));
  }, [contenedor.items]);

  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(skus.map((s) => [s.productoId, s.costo])),
  );

  const onConfirmar = () => {
    // Sólo los valores cargados explícitamente viajan como override; los
    // vacíos los deriva el service desde el rateo.
    const overrides = Object.entries(valores)
      .filter(([, v]) => v.trim() !== "")
      .map(([productoId, v]) => ({ productoId, costoFCUnitario: v.trim() }));
    startTransition(async () => {
      const r = await cerrarCostosContenedorAction({
        contenedorId: contenedor.id,
        expectedUpdatedAt: contenedor.updatedAt,
        overrides: overrides.length > 0 ? overrides : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Costos de ${contenedor.numeroContenedor} cerrados.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 border-b bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        Dejá el costo en blanco para derivarlo del rateo del embarque, o cargá un valor para
        sobrescribirlo (USD).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Producto</th>
              <th className="py-1 text-right font-medium">Costo FC unitario (USD)</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.productoId} className="border-t">
                <td className="py-1.5 pr-2">{labelMap.get(s.productoId) ?? s.productoId}</td>
                <td className="py-1.5 text-right">
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    inputMode="decimal"
                    value={valores[s.productoId] ?? ""}
                    placeholder="(del rateo)"
                    onChange={(e) =>
                      setValores((prev) => ({ ...prev, [s.productoId]: e.target.value }))
                    }
                    className="ml-auto w-36 text-right tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={onConfirmar} disabled={pending}>
          Cerrar costos
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
