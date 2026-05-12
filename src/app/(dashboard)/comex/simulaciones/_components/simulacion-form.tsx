"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import Decimal from "decimal.js";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Calculator01Icon,
  Delete02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

import {
  guardarSimulacionAction,
  eliminarSimulacionAction,
  type SimulacionDetalle,
  type GuardarSimulacionInput,
} from "@/lib/actions/simulaciones-importacion";
import {
  calcularResumenSimulacion,
  type SimulacionInput,
} from "@/lib/services/simulacion-importacion";
import { calcularTributosSugeridos } from "@/lib/services/comex";
import { ProveedorCombobox, type ProveedorOption } from "@/components/proveedor-combobox";
import { ProductoCombobox, type ProductoOption } from "@/components/producto-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyAmount } from "@/components/ui/money-amount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const moneyRegex = /^\d+(?:\.\d{1,2})?$/;
const rateRegex = /^\d+(?:\.\d{1,6})?$/;

const INCOTERMS = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
] as const;

const TIPO_COSTO_VALUES = [
  "FLETE_INTERNACIONAL",
  "FLETE_NACIONAL",
  "SEGURO_MARITIMO",
  "GASTOS_PORTUARIOS",
  "HONORARIOS_DESPACHANTE",
  "OPERADOR_LOGISTICO",
  "ALMACENAJE",
  "DEVOLUCION_CONTENEDOR",
  "AGENTE_DE_CARGAS",
  "GASTOS_LOCALES",
  "GASTOS_EXTRAS",
] as const;

type TipoCosto = (typeof TIPO_COSTO_VALUES)[number];

const TIPO_COSTO_LABELS: Record<TipoCosto, string> = {
  FLETE_INTERNACIONAL: "Flete internacional",
  FLETE_NACIONAL: "Flete nacional",
  SEGURO_MARITIMO: "Seguro marítimo",
  GASTOS_PORTUARIOS: "Gastos portuarios",
  HONORARIOS_DESPACHANTE: "Honorarios despachante",
  OPERADOR_LOGISTICO: "Operador logístico",
  ALMACENAJE: "Almacenaje / WMS",
  DEVOLUCION_CONTENEDOR: "Devolución contenedor",
  AGENTE_DE_CARGAS: "Agente de cargas",
  GASTOS_LOCALES: "Gastos locales",
  GASTOS_EXTRAS: "Gastos extras",
};

const formSchema = z
  .object({
    codigo: z.string().trim().min(1, "Código requerido").max(32),
    nombre: z.string().max(120).optional(),
    proveedorId: z.string().uuid().nullable().optional(),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    incoterm: z.enum(INCOTERMS).nullable().optional(),
    lugarIncoterm: z.string().max(80).optional(),
    valorFleteOrigen: z
      .string()
      .optional()
      .refine((v) => !v || v.length === 0 || moneyRegex.test(v), "Flete origen inválido"),
    valorSeguroOrigen: z
      .string()
      .optional()
      .refine((v) => !v || v.length === 0 || moneyRegex.test(v), "Seguro origen inválido"),
    die: z.string().regex(moneyRegex, "Inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Inválido"),
    arancelSim: z.string().regex(moneyRegex, "Inválido"),
    iva: z.string().regex(moneyRegex, "Inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Inválido"),
    ganancias: z.string().regex(moneyRegex, "Inválido"),
    iibb: z.string().regex(moneyRegex, "Inválido"),
    notas: z.string().max(2000).optional(),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid().nullable().optional(),
          descripcionLibre: z.string().max(200).optional(),
          cantidad: z
            .number({ message: "Cantidad inválida" })
            .int("Debe ser entero")
            .positive("Cantidad > 0"),
          precioUnitarioFob: z.string().regex(moneyRegex, "FOB inválido"),
          precioVentaUnitario: z
            .string()
            .optional()
            .refine((v) => !v || v.length === 0 || moneyRegex.test(v), "Precio venta inválido"),
        }),
      )
      .min(1, "Agregue al menos un ítem"),
    costos: z.array(
      z.object({
        tipo: z.enum(TIPO_COSTO_VALUES),
        descripcion: z.string().max(200).optional(),
        subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
        moneda: z.enum(["ARS", "USD"]),
        tipoCambio: z.string().regex(rateRegex, "TC inválido"),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === "ARS" && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
    data.items.forEach((it, idx) => {
      if (!it.productoId && (!it.descripcionLibre || it.descripcionLibre.trim().length === 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", idx, "productoId"],
          message: "Indique producto o descripción libre",
        });
      }
    });
    data.costos.forEach((c, idx) => {
      if (c.moneda === "ARS" && c.tipoCambio !== "1") {
        ctx.addIssue({
          code: "custom",
          path: ["costos", idx, "tipoCambio"],
          message: "Para ARS, TC=1",
        });
      }
    });
  });

type FormValues = z.infer<typeof formSchema>;

type Props =
  | {
      mode: "create";
      proveedores: ProveedorOption[];
      productos: ProductoOption[];
      codigoSugerido: string;
    }
  | {
      mode: "edit";
      proveedores: ProveedorOption[];
      productos: ProductoOption[];
      initialData: SimulacionDetalle;
    };

export function SimulacionForm(props: Props) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const isEdit = props.mode === "edit";

  const defaultValues: FormValues =
    props.mode === "create"
      ? {
          codigo: props.codigoSugerido,
          nombre: "",
          proveedorId: null,
          moneda: "USD",
          tipoCambio: "",
          incoterm: null,
          lugarIncoterm: "",
          valorFleteOrigen: "",
          valorSeguroOrigen: "",
          die: "0",
          tasaEstadistica: "0",
          arancelSim: "0",
          iva: "0",
          ivaAdicional: "0",
          ganancias: "0",
          iibb: "0",
          notas: "",
          items: [],
          costos: [],
        }
      : {
          codigo: props.initialData.codigo,
          nombre: props.initialData.nombre ?? "",
          proveedorId: props.initialData.proveedorId,
          moneda: props.initialData.moneda,
          tipoCambio: props.initialData.tipoCambio,
          incoterm: props.initialData.incoterm,
          lugarIncoterm: props.initialData.lugarIncoterm ?? "",
          valorFleteOrigen: props.initialData.valorFleteOrigen ?? "",
          valorSeguroOrigen: props.initialData.valorSeguroOrigen ?? "",
          die: props.initialData.die,
          tasaEstadistica: props.initialData.tasaEstadistica,
          arancelSim: props.initialData.arancelSim,
          iva: props.initialData.iva,
          ivaAdicional: props.initialData.ivaAdicional,
          ganancias: props.initialData.ganancias,
          iibb: props.initialData.iibb,
          notas: props.initialData.notas ?? "",
          items: props.initialData.items.map((it) => ({
            productoId: it.productoId,
            descripcionLibre: it.descripcionLibre ?? "",
            cantidad: it.cantidad,
            precioUnitarioFob: it.precioUnitarioFob,
            precioVentaUnitario: it.precioVentaUnitario ?? "",
          })),
          costos: props.initialData.costos.map((c) => ({
            tipo: c.tipo as TipoCosto,
            descripcion: c.descripcion ?? "",
            subtotal: c.subtotal,
            moneda: c.moneda,
            tipoCambio: c.tipoCambio,
          })),
        };

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues,
  });

  const {
    fields: itemFields,
    append: appendItem,
    remove: removeItem,
  } = useFieldArray({ control, name: "items" });

  const {
    fields: costoFields,
    append: appendCosto,
    remove: removeCosto,
  } = useFieldArray({ control, name: "costos" });

  // Watch para cálculos en vivo
  const moneda = useWatch({ control, name: "moneda" });
  const tipoCambio = useWatch({ control, name: "tipoCambio" }) ?? "0";
  const incoterm = useWatch({ control, name: "incoterm" });
  const valorFleteOrigen = useWatch({ control, name: "valorFleteOrigen" });
  const valorSeguroOrigen = useWatch({ control, name: "valorSeguroOrigen" });
  const items = useWatch({ control, name: "items" }) ?? [];
  const costos = useWatch({ control, name: "costos" }) ?? [];
  const die = useWatch({ control, name: "die" }) ?? "0";
  const tasaEstadistica = useWatch({ control, name: "tasaEstadistica" }) ?? "0";
  const arancelSim = useWatch({ control, name: "arancelSim" }) ?? "0";
  const iva = useWatch({ control, name: "iva" }) ?? "0";
  const ivaAdicional = useWatch({ control, name: "ivaAdicional" }) ?? "0";
  const ganancias = useWatch({ control, name: "ganancias" }) ?? "0";
  const iibb = useWatch({ control, name: "iibb" }) ?? "0";

  const resumen = useMemo(() => {
    const input = buildSimulacionInput({
      moneda,
      tipoCambio,
      valorFleteOrigen,
      valorSeguroOrigen,
      die,
      tasaEstadistica,
      arancelSim,
      iva,
      ivaAdicional,
      ganancias,
      iibb,
      items,
      costos,
      productos: props.productos,
    });
    return calcularResumenSimulacion(input);
  }, [
    moneda,
    tipoCambio,
    valorFleteOrigen,
    valorSeguroOrigen,
    die,
    tasaEstadistica,
    arancelSim,
    iva,
    ivaAdicional,
    ganancias,
    iibb,
    items,
    costos,
    props.productos,
  ]);

  const handleCalcularTributos = () => {
    if (resumen.cifTotalArs.lte(0)) {
      toast.error("Complete FOB y costos para calcular tributos.");
      return;
    }
    const tc = new Decimal(safeRate(tipoCambio));
    const cifMoneda = tc.gt(0) ? resumen.cifTotalArs.dividedBy(tc) : new Decimal(0);
    const t = calcularTributosSugeridos(cifMoneda);
    setValue("die", t.die.toFixed(2), { shouldValidate: true });
    setValue("tasaEstadistica", t.tasaEstadistica.toFixed(2), { shouldValidate: true });
    setValue("arancelSim", t.arancelSim.toFixed(2), { shouldValidate: true });
    setValue("iva", t.iva.toFixed(2), { shouldValidate: true });
    setValue("ivaAdicional", t.ivaAdicional.toFixed(2), { shouldValidate: true });
    setValue("ganancias", t.ganancias.toFixed(2), { shouldValidate: true });
    setValue("iibb", t.iibb.toFixed(2), { shouldValidate: true });
    toast.success("Tributos sugeridos calculados.");
  };

  const addItem = () => {
    appendItem(
      {
        productoId: null,
        descripcionLibre: "",
        cantidad: 1,
        precioUnitarioFob: "0",
        precioVentaUnitario: "",
      },
      { shouldFocus: false },
    );
  };

  const addCosto = () => {
    // safeRate returns "0" para valor inválido; "0" es truthy en JS por ser
    // string no vacío, entonces el || fallback no se dispara. Comparamos
    // explícitamente con "0" para usar "1" como TC default seguro.
    const tcInicial = safeRate(tipoCambio);
    appendCosto(
      {
        tipo: "FLETE_INTERNACIONAL",
        descripcion: "",
        subtotal: "0",
        moneda: moneda,
        tipoCambio: tcInicial === "0" ? "1" : tcInicial,
      },
      { shouldFocus: false },
    );
  };

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const payload: GuardarSimulacionInput = {
        id: isEdit ? props.initialData.id : undefined,
        codigo: values.codigo,
        nombre: values.nombre,
        proveedorId: values.proveedorId ?? null,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        incoterm: values.incoterm ?? null,
        lugarIncoterm: values.lugarIncoterm,
        valorFleteOrigen: values.valorFleteOrigen,
        valorSeguroOrigen: values.valorSeguroOrigen,
        die: values.die,
        tasaEstadistica: values.tasaEstadistica,
        arancelSim: values.arancelSim,
        iva: values.iva,
        ivaAdicional: values.ivaAdicional,
        ganancias: values.ganancias,
        iibb: values.iibb,
        notas: values.notas,
        items: values.items.map((it) => ({
          productoId: it.productoId ?? null,
          descripcionLibre: it.descripcionLibre,
          cantidad: it.cantidad,
          precioUnitarioFob: it.precioUnitarioFob,
          precioVentaUnitario: it.precioVentaUnitario,
        })),
        costos: values.costos,
      };
      const result = await guardarSimulacionAction(payload);
      if (result.ok) {
        toast.success(
          isEdit
            ? `Simulación ${result.codigo} actualizada.`
            : `Simulación ${result.codigo} creada.`,
        );
        router.push(`/comex/simulaciones/${result.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  const onDelete = () => {
    if (!isEdit) return;
    if (!window.confirm("¿Eliminar esta simulación? La acción no se puede deshacer.")) return;
    startDeleteTransition(async () => {
      const result = await eliminarSimulacionAction(props.initialData.id);
      if (result.ok) {
        toast.success("Simulación eliminada.");
        router.push("/comex/simulaciones");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {isEdit ? "Editar simulación" : "Nueva simulación"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Calculadora de costos de importación · no genera asientos ni movimientos de stock.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={onDelete}
              disabled={isDeleting || isSubmitting}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              Eliminar
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Guardando..." : isEdit ? "Guardar cambios" : "Guardar simulación"}
          </Button>
        </div>
      </div>

      {/* Datos generales */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <h2 className="text-sm font-semibold">Datos generales</h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="codigo">Código</Label>
              <Input id="codigo" readOnly={isEdit} {...register("codigo")} />
              {errors.codigo && <FieldError message={errors.codigo.message} />}
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="nombre">Nombre (opcional)</Label>
              <Input
                id="nombre"
                placeholder="Ej: Pedido contenedor China abril"
                {...register("nombre")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Proveedor (opcional)</Label>
              <Controller
                control={control}
                name="proveedorId"
                render={({ field }) => (
                  <ProveedorCombobox
                    value={field.value || null}
                    onChange={(id) => field.onChange(id || null)}
                    proveedores={props.proveedores}
                  />
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Moneda</Label>
              <Controller
                control={control}
                name="moneda"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      if (v === "ARS") setValue("tipoCambio", "1", { shouldValidate: true });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS — Peso argentino</SelectItem>
                      <SelectItem value="USD">USD — Dólar</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tipoCambio">Tipo de cambio</Label>
              <Input
                id="tipoCambio"
                inputMode="decimal"
                className="text-right tabular-nums"
                disabled={moneda === "ARS"}
                {...register("tipoCambio")}
              />
              {errors.tipoCambio && <FieldError message={errors.tipoCambio.message} />}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Incoterm</Label>
              <Controller
                control={control}
                name="incoterm"
                render={({ field }) => (
                  <Select
                    value={field.value ?? "NONE"}
                    onValueChange={(v) => field.onChange(v === "NONE" ? null : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sin definir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">— Sin definir —</SelectItem>
                      {INCOTERMS.map((i) => (
                        <SelectItem key={i} value={i}>
                          {i}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="lugarIncoterm">Lugar Incoterm</Label>
              <Input
                id="lugarIncoterm"
                placeholder="Ej: Shanghai, Buenos Aires, Hamburg"
                {...register("lugarIncoterm")}
              />
            </div>
          </div>

          {(incoterm === "CIF" || incoterm === "CFR") && (
            <div className="rounded-md border border-dashed bg-muted/10 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Valores en origen incluidos en el precio {incoterm}
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="valorFleteOrigen" className="text-xs">
                    Valor del flete ({moneda})
                  </Label>
                  <Input
                    id="valorFleteOrigen"
                    inputMode="decimal"
                    placeholder="0.00"
                    {...register("valorFleteOrigen")}
                  />
                  {errors.valorFleteOrigen && (
                    <FieldError message={errors.valorFleteOrigen.message} />
                  )}
                </div>
                {incoterm === "CIF" && (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="valorSeguroOrigen" className="text-xs">
                      Valor del seguro ({moneda})
                    </Label>
                    <Input
                      id="valorSeguroOrigen"
                      inputMode="decimal"
                      placeholder="0.00"
                      {...register("valorSeguroOrigen")}
                    />
                    {errors.valorSeguroOrigen && (
                      <FieldError message={errors.valorSeguroOrigen.message} />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="notas">Notas (opcional)</Label>
            <textarea
              id="notas"
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Supuestos, hipótesis, recordatorios..."
              {...register("notas")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Ítems */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Ítems <span className="text-muted-foreground">({itemFields.length})</span>
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Agregar ítem
            </Button>
          </div>

          {itemFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay ítems aún. Agregue al menos uno para calcular el costo nacionalizado.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {itemFields.map((field, idx) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 gap-3 rounded-md border bg-muted/5 p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-4">
                    <Label className="text-xs">Producto</Label>
                    <Controller
                      control={control}
                      name={`items.${idx}.productoId`}
                      render={({ field: f }) => (
                        <ProductoCombobox
                          value={f.value || null}
                          onChange={(id) => f.onChange(id || null)}
                          productos={props.productos}
                        />
                      )}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Label className="text-xs">Descripción libre</Label>
                    <Input
                      placeholder="Si no tiene SKU"
                      {...register(`items.${idx}.descripcionLibre`)}
                    />
                    {errors.items?.[idx]?.productoId && (
                      <FieldError message={errors.items[idx]?.productoId?.message} />
                    )}
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-xs">Cant.</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="text-right tabular-nums"
                      {...register(`items.${idx}.cantidad`, { valueAsNumber: true })}
                    />
                    {errors.items?.[idx]?.cantidad && (
                      <FieldError message={errors.items[idx]?.cantidad?.message} />
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">FOB unit. ({moneda})</Label>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      {...register(`items.${idx}.precioUnitarioFob`)}
                    />
                    {errors.items?.[idx]?.precioUnitarioFob && (
                      <FieldError message={errors.items[idx]?.precioUnitarioFob?.message} />
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">P. venta unit. (ARS)</Label>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      placeholder="Opcional"
                      {...register(`items.${idx}.precioVentaUnitario`)}
                    />
                    {errors.items?.[idx]?.precioVentaUnitario && (
                      <FieldError message={errors.items[idx]?.precioVentaUnitario?.message} />
                    )}
                  </div>
                  <div className="flex items-end md:col-span-12 md:justify-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                      Quitar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {errors.items && typeof errors.items.message === "string" && (
            <FieldError message={errors.items.message} />
          )}
        </CardContent>
      </Card>

      {/* Costos logísticos */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Costos logísticos{" "}
              <span className="text-muted-foreground">({costoFields.length})</span>
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={addCosto}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Agregar costo
            </Button>
          </div>

          {costoFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay costos logísticos cargados. Estos no son obligatorios pero pueden afectar
              significativamente el costo nacionalizado.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {costoFields.map((field, idx) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 gap-3 rounded-md border bg-muted/5 p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-3">
                    <Label className="text-xs">Tipo</Label>
                    <Controller
                      control={control}
                      name={`costos.${idx}.tipo`}
                      render={({ field: f }) => (
                        <Select value={f.value} onValueChange={f.onChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIPO_COSTO_VALUES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {TIPO_COSTO_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="md:col-span-4">
                    <Label className="text-xs">Descripción</Label>
                    <Input
                      placeholder="Detalle del concepto"
                      {...register(`costos.${idx}.descripcion`)}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-xs">Moneda</Label>
                    <Controller
                      control={control}
                      name={`costos.${idx}.moneda`}
                      render={({ field: f }) => (
                        <Select
                          value={f.value}
                          onValueChange={(v) => {
                            f.onChange(v);
                            if (v === "ARS") {
                              setValue(`costos.${idx}.tipoCambio`, "1", { shouldValidate: true });
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ARS">ARS</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Subtotal</Label>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      {...register(`costos.${idx}.subtotal`)}
                    />
                    {errors.costos?.[idx]?.subtotal && (
                      <FieldError message={errors.costos[idx]?.subtotal?.message} />
                    )}
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-xs">TC</Label>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      disabled={costos[idx]?.moneda === "ARS"}
                      {...register(`costos.${idx}.tipoCambio`)}
                    />
                    {errors.costos?.[idx]?.tipoCambio && (
                      <FieldError message={errors.costos[idx]?.tipoCambio?.message} />
                    )}
                  </div>
                  <div className="flex items-end md:col-span-1 md:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCosto(idx)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tributos aduaneros */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Tributos aduaneros</h2>
              <p className="text-xs text-muted-foreground">
                Valores en {moneda}. Los créditos fiscales (IVA, IIBB, Ganancias) no se ratean al
                costo del producto.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleCalcularTributos}>
              <HugeiconsIcon icon={Calculator01Icon} strokeWidth={2} />
              Sugerir tributos
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <TributoField label="DIE" name="die" register={register} error={errors.die?.message} />
            <TributoField
              label="Tasa estadística"
              name="tasaEstadistica"
              register={register}
              error={errors.tasaEstadistica?.message}
            />
            <TributoField
              label="Arancel SIM"
              name="arancelSim"
              register={register}
              error={errors.arancelSim?.message}
            />
            <TributoField label="IVA" name="iva" register={register} error={errors.iva?.message} />
            <TributoField
              label="IVA adicional"
              name="ivaAdicional"
              register={register}
              error={errors.ivaAdicional?.message}
            />
            <TributoField
              label="Ganancias"
              name="ganancias"
              register={register}
              error={errors.ganancias?.message}
            />
            <TributoField
              label="IIBB"
              name="iibb"
              register={register}
              error={errors.iibb?.message}
            />
          </div>
        </CardContent>
      </Card>

      {/* Resumen + rentabilidad */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={InformationCircleIcon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
            />
            <h2 className="text-sm font-semibold">Resumen — todo en ARS</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <ResumenCell
              label={`FOB total (${moneda})`}
              value={resumen.fobTotal.toFixed(2)}
              symbol={moneda === "USD" ? "USD " : "$ "}
            />
            <ResumenCell label="FOB total en ARS" value={resumen.fobTotalArs.toFixed(2)} />
            <ResumenCell label="Flete origen (CIF/CFR)" value={resumen.fleteOrigenArs.toFixed(2)} />
            <ResumenCell label="Seguro origen (CIF)" value={resumen.seguroOrigenArs.toFixed(2)} />
            <ResumenCell label="Costos logísticos" value={resumen.costosLogisticosArs.toFixed(2)} />
            <ResumenCell label="CIF total" value={resumen.cifTotalArs.toFixed(2)} />
            <ResumenCell label="DIE" value={resumen.dieArs.toFixed(2)} />
            <ResumenCell
              label="Tasa + Arancel"
              value={resumen.tasaEstadisticaArs.plus(resumen.arancelSimArs).toFixed(2)}
            />
            <ResumenCell
              label="IVA + IVA adic."
              value={resumen.ivaArs.plus(resumen.ivaAdicionalArs).toFixed(2)}
              muted
            />
            <ResumenCell label="Ganancias" value={resumen.gananciasArs.toFixed(2)} muted />
            <ResumenCell label="IIBB" value={resumen.iibbArs.toFixed(2)} muted />
            <ResumenCell
              label="Créditos fiscales"
              value={resumen.creditosFiscalesArs.toFixed(2)}
              muted
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <HighlightCell
              label="Costo nacionalizado total"
              value={resumen.costoTotalNacionalizadoArs.toFixed(2)}
            />
            <HighlightCell
              label="Desembolso total estimado"
              value={resumen.desembolsoTotalEstimadoArs.toFixed(2)}
              hint="Incluye créditos fiscales (recuperables)"
            />
            <HighlightCell
              label="Margen promedio"
              value={
                resumen.margenPromedioPorcentaje !== null
                  ? `${resumen.margenPromedioPorcentaje.toFixed(2)}%`
                  : "—"
              }
              hint={
                resumen.itemsConPrecio === 0
                  ? "Cargue precios de venta para calcular"
                  : `${resumen.itemsConPrecio} ítem(s) con precio cargado`
              }
              variant={resumen.margenPromedioPorcentaje?.lt(0) ? "negative" : "positive"}
            />
          </div>

          {/* Tabla de items con rentabilidad */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Ítem</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">FOB unit.</th>
                  <th className="px-3 py-2 text-right">Costo unit. nacionalizado</th>
                  <th className="px-3 py-2 text-right">Costo total</th>
                  <th className="px-3 py-2 text-right">P. venta unit.</th>
                  <th className="px-3 py-2 text-right">Margen unit.</th>
                  <th className="px-3 py-2 text-right">%</th>
                  <th className="px-3 py-2 text-right">Utilidad total</th>
                </tr>
              </thead>
              <tbody>
                {resumen.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      Sin ítems para mostrar.
                    </td>
                  </tr>
                ) : (
                  resumen.items.map((it) => (
                    <tr key={it.index} className="border-t">
                      <td className="px-3 py-2 text-xs">
                        {it.descripcion ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{it.cantidad}</td>
                      <td className="px-3 py-2 text-right">
                        <MoneyAmount
                          value={it.precioUnitarioFob.toFixed(2)}
                          mode="plain"
                          symbol={moneda === "USD" ? "USD " : "$ "}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <MoneyAmount
                          value={it.costoUnitarioArs.toFixed(2)}
                          mode="plain"
                          symbol="$ "
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <MoneyAmount value={it.costoTotalArs.toFixed(2)} mode="plain" symbol="$ " />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {it.precioVentaUnitarioArs ? (
                          <MoneyAmount
                            value={it.precioVentaUnitarioArs.toFixed(2)}
                            mode="plain"
                            symbol="$ "
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {it.margenUnitarioArs ? (
                          <MoneyAmount
                            value={it.margenUnitarioArs.toFixed(2)}
                            mode="signed"
                            symbol="$ "
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {it.margenPorcentaje ? (
                          <span
                            className={
                              it.margenPorcentaje.lt(0)
                                ? "text-rose-700 dark:text-rose-400"
                                : "text-emerald-700 dark:text-emerald-400"
                            }
                          >
                            {it.margenPorcentaje.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {it.utilidadTotalArs ? (
                          <MoneyAmount
                            value={it.utilidadTotalArs.toFixed(2)}
                            mode="signed"
                            symbol="$ "
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {resumen.itemsConPrecio > 0 && (
                <tfoot className="border-t bg-muted/20 text-xs font-medium">
                  <tr>
                    <td className="px-3 py-2" colSpan={4}>
                      Totales (sólo ítems con precio cargado)
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyAmount
                        value={resumen.costoSubtotalConPrecioArs.toFixed(2)}
                        mode="plain"
                        symbol="$ "
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyAmount
                        value={resumen.ingresoTotalArs.toFixed(2)}
                        mode="plain"
                        symbol="$ "
                      />
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right">
                      {resumen.margenPromedioPorcentaje
                        ? `${resumen.margenPromedioPorcentaje.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyAmount
                        value={resumen.utilidadTotalArs.toFixed(2)}
                        mode="signed"
                        symbol="$ "
                      />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function TributoField({
  label,
  name,
  register,
  error,
}: {
  label: string;
  name: "die" | "tasaEstadistica" | "arancelSim" | "iva" | "ivaAdicional" | "ganancias" | "iibb";
  register: ReturnType<typeof useForm<FormValues>>["register"];
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs">{label}</Label>
      <Input inputMode="decimal" className="text-right tabular-nums" {...register(name)} />
      {error && <FieldError message={error} />}
    </div>
  );
}

function ResumenCell({
  label,
  value,
  symbol = "$ ",
  muted = false,
}: {
  label: string;
  value: string;
  symbol?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-md border bg-background px-3 py-2 ${
        muted ? "opacity-70" : ""
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <MoneyAmount value={value} mode="plain" symbol={symbol} className="text-sm font-medium" />
    </div>
  );
}

function HighlightCell({
  label,
  value,
  hint,
  variant = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: "neutral" | "positive" | "negative";
}) {
  const isNumeric = !value.endsWith("%") && value !== "—";
  const color =
    variant === "positive"
      ? "border-emerald-600/30 bg-emerald-500/5"
      : variant === "negative"
        ? "border-rose-600/30 bg-rose-500/5"
        : "border-primary/30 bg-primary/5";
  return (
    <div className={`flex flex-col gap-1 rounded-md border ${color} px-3 py-2.5`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {isNumeric ? (
        <MoneyAmount value={value} mode="plain" symbol="$ " className="text-base font-semibold" />
      ) : (
        <span className="font-mono text-base font-semibold tabular-nums">{value}</span>
      )}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3" />
      {message}
    </p>
  );
}

function safeMoney(v: unknown): string {
  if (typeof v === "string" && moneyRegex.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v)) return v.toString();
  return "0";
}

// Tipo de cambio acepta hasta 6 decimales (rateRegex). NO usar safeMoney
// para TCs: limita a 2 decimales y devuelve "0" para ratios válidos como
// "1200.123", lo que ceraría todos los cálculos ARS en vivo.
function safeRate(v: unknown): string {
  if (typeof v === "string" && rateRegex.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v.toString();
  return "0";
}

function safeOptionalMoney(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0 && moneyRegex.test(v)) return v;
  return null;
}

type BuildInputArgs = {
  moneda: "ARS" | "USD";
  tipoCambio: string;
  valorFleteOrigen?: string;
  valorSeguroOrigen?: string;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva: string;
  ivaAdicional: string;
  ganancias: string;
  iibb: string;
  items: ReadonlyArray<FormValues["items"][number] | undefined>;
  costos: ReadonlyArray<FormValues["costos"][number] | undefined>;
  productos: ProductoOption[];
};

function buildItemInput(it: FormValues["items"][number] | undefined, productos: ProductoOption[]) {
  const producto = it?.productoId ? productos.find((p) => p.id === it.productoId) : null;
  return {
    productoId: it?.productoId ?? null,
    descripcionLibre: it?.descripcionLibre ?? null,
    label: producto ? `${producto.codigo} · ${producto.nombre}` : (it?.descripcionLibre ?? null),
    cantidad: Number.isFinite(it?.cantidad) ? (it?.cantidad ?? 0) : 0,
    precioUnitarioFob: safeMoney(it?.precioUnitarioFob),
    precioVentaUnitario: safeOptionalMoney(it?.precioVentaUnitario),
  };
}

function buildCostoInput(c: FormValues["costos"][number] | undefined) {
  return {
    tipo: c?.tipo,
    descripcion: c?.descripcion ?? null,
    subtotal: safeMoney(c?.subtotal),
    moneda: c?.moneda ?? ("USD" as const),
    tipoCambio: safeRate(c?.tipoCambio),
  };
}

function buildSimulacionInput(args: BuildInputArgs): SimulacionInput {
  return {
    moneda: args.moneda,
    tipoCambio: safeRate(args.tipoCambio),
    valorFleteOrigen: safeOptionalMoney(args.valorFleteOrigen),
    valorSeguroOrigen: safeOptionalMoney(args.valorSeguroOrigen),
    die: safeMoney(args.die),
    tasaEstadistica: safeMoney(args.tasaEstadistica),
    arancelSim: safeMoney(args.arancelSim),
    iva: safeMoney(args.iva),
    ivaAdicional: safeMoney(args.ivaAdicional),
    ganancias: safeMoney(args.ganancias),
    iibb: safeMoney(args.iibb),
    items: args.items.map((it) => buildItemInput(it, args.productos)),
    costos: args.costos.map(buildCostoInput),
  };
}
