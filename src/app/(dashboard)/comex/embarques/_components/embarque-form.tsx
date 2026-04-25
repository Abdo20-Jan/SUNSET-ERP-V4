"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Calculator01Icon,
  Delete02Icon,
  InformationCircleIcon,
  LockIcon,
} from "@hugeicons/core-free-icons";

import {
  guardarEmbarqueAction,
  type EmbarqueDetalle,
} from "@/lib/actions/embarques";
import {
  AsientoEmbarqueLink,
  CerrarEmbarqueDialog,
} from "./cerrar-embarque-dialog";
import {
  ProveedorCombobox,
  type ProveedorOption,
} from "@/components/proveedor-combobox";
import {
  ProductoCombobox,
  type ProductoOption,
} from "@/components/producto-combobox";
import {
  CuentaCombobox,
  type CuentaOption,
} from "@/components/cuenta-combobox";
import Decimal from "decimal.js";

import { calcularTributosSugeridos } from "@/lib/services/comex";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EmbarqueEstado =
  | "BORRADOR"
  | "EN_TRANSITO"
  | "EN_PUERTO"
  | "EN_ADUANA"
  | "DESPACHADO"
  | "EN_DEPOSITO"
  | "CERRADO";

type Moneda = "ARS" | "USD";

const ESTADO_VALUES = [
  "BORRADOR",
  "EN_TRANSITO",
  "EN_PUERTO",
  "EN_ADUANA",
  "DESPACHADO",
  "EN_DEPOSITO",
  "CERRADO",
] as const satisfies readonly EmbarqueEstado[];

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const ESTADOS_EDITABLES: EmbarqueEstado[] = [
  "BORRADOR",
  "EN_TRANSITO",
  "EN_PUERTO",
  "EN_ADUANA",
  "DESPACHADO",
  "EN_DEPOSITO",
];

const ESTADO_LABELS: Record<EmbarqueEstado, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  EN_PUERTO: "En puerto",
  EN_ADUANA: "En aduana",
  DESPACHADO: "Despachado",
  EN_DEPOSITO: "En depósito",
  CERRADO: "Cerrado",
};

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
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    depositoDestinoId: z.string().uuid("Seleccione un depósito de destino"),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
    estado: z.enum(ESTADO_VALUES),
    die: z.string().regex(moneyRegex, "Inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Inválido"),
    arancelSim: z.string().regex(moneyRegex, "Inválido"),
    iva: z.string().regex(moneyRegex, "Inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Inválido"),
    ganancias: z.string().regex(moneyRegex, "Inválido"),
    iibb: z.string().regex(moneyRegex, "Inválido"),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid("Seleccione un producto"),
          cantidad: z
            .number({ message: "Cantidad inválida" })
            .int("Debe ser entero")
            .positive("Cantidad > 0"),
          precioUnitarioFob: z
            .string()
            .regex(moneyRegex, "Precio FOB inválido"),
        }),
      )
      .min(1, "Agregue al menos un ítem"),
    costos: z.array(
      z.object({
        tipo: z.enum(TIPO_COSTO_VALUES),
        proveedorId: z.string().uuid("Seleccione un proveedor"),
        cuentaContableGastoId: z
          .number()
          .int()
          .positive("Seleccione la cuenta de gasto"),
        moneda: z.enum(["ARS", "USD"]),
        tipoCambio: z.string().regex(rateRegex, "TC inválido"),
        subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
        iva: z.string().regex(moneyRegex, "IVA inválido"),
        iibb: z.string().regex(moneyRegex, "IIBB inválido"),
        otros: z.string().regex(moneyRegex, "Otros inválido"),
        facturaNumero: z.string().max(64).optional(),
        fechaFactura: z.string().optional(),
        descripcion: z.string().max(200).optional(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.estado === "CERRADO") {
      ctx.addIssue({
        code: "custom",
        path: ["estado"],
        message:
          "Para cerrar el embarque utilice el botón 'Cerrar y Contabilizar'.",
      });
    }
    if (data.moneda === "ARS" && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, tipo de cambio debe ser 1",
      });
    }
    if (data.moneda === "USD") {
      const tc = Number(data.tipoCambio);
      if (!Number.isFinite(tc) || tc <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["tipoCambio"],
          message: "TC debe ser > 0",
        });
      }
    }
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

export type DepositoOption = {
  id: string;
  nombre: string;
};

type Props =
  | {
      mode: "create";
      proveedores: ProveedorOption[];
      productos: ProductoOption[];
      depositos: DepositoOption[];
      cuentasGasto: CuentaOption[];
      codigoSugerido: string;
    }
  | {
      mode: "edit";
      proveedores: ProveedorOption[];
      productos: ProductoOption[];
      depositos: DepositoOption[];
      cuentasGasto: CuentaOption[];
      initialData: EmbarqueDetalle;
      readonly: boolean;
    };

export function EmbarqueForm(props: Props) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();

  const readonly = props.mode === "edit" ? props.readonly : false;
  const isEdit = props.mode === "edit";

  const defaultValues: FormValues =
    props.mode === "create"
      ? {
          codigo: props.codigoSugerido,
          proveedorId: "",
          depositoDestinoId: "",
          moneda: "USD",
          tipoCambio: "",
          estado: "BORRADOR",
          die: "0",
          tasaEstadistica: "0",
          arancelSim: "0",
          iva: "0",
          ivaAdicional: "0",
          ganancias: "0",
          iibb: "0",
          items: [],
          costos: [],
        }
      : {
          codigo: props.initialData.codigo,
          proveedorId: props.initialData.proveedorId,
          depositoDestinoId: props.initialData.depositoDestinoId ?? "",
          moneda: props.initialData.moneda,
          tipoCambio: props.initialData.tipoCambio,
          estado:
            props.initialData.estado === "CERRADO"
              ? "BORRADOR"
              : props.initialData.estado,
          die: props.initialData.die,
          tasaEstadistica: props.initialData.tasaEstadistica,
          arancelSim: props.initialData.arancelSim,
          iva: props.initialData.iva,
          ivaAdicional: props.initialData.ivaAdicional,
          ganancias: props.initialData.ganancias,
          iibb: props.initialData.iibb,
          items: props.initialData.items.map((it) => ({
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitarioFob: it.precioUnitarioFob,
          })),
          costos: props.initialData.costos.map((c) => ({
            tipo: c.tipo as TipoCosto,
            proveedorId: c.proveedorId,
            cuentaContableGastoId: c.cuentaContableGastoId,
            moneda: c.moneda,
            tipoCambio: c.tipoCambio,
            subtotal: c.subtotal,
            iva: c.iva,
            iibb: c.iibb,
            otros: c.otros,
            facturaNumero: c.facturaNumero ?? "",
            fechaFactura: c.fechaFactura ? c.fechaFactura.slice(0, 10) : "",
            descripcion: c.descripcion ?? "",
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

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const {
    fields: costoFields,
    append: appendCosto,
    remove: removeCosto,
  } = useFieldArray({
    control,
    name: "costos",
  });

  const moneda = useWatch({ control, name: "moneda" });
  const tipoCambioEmbarque =
    useWatch({ control, name: "tipoCambio" }) ?? "0";

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  // ---------- Cálculos en tiempo real ----------
  const items = useWatch({ control, name: "items" }) ?? [];
  const costos = useWatch({ control, name: "costos" }) ?? [];
  const die = useWatch({ control, name: "die" }) ?? "0";
  const tasaEstadistica =
    useWatch({ control, name: "tasaEstadistica" }) ?? "0";
  const arancelSim = useWatch({ control, name: "arancelSim" }) ?? "0";
  const iva = useWatch({ control, name: "iva" }) ?? "0";
  const ivaAdicional = useWatch({ control, name: "ivaAdicional" }) ?? "0";
  const ganancias = useWatch({ control, name: "ganancias" }) ?? "0";
  const iibb = useWatch({ control, name: "iibb" }) ?? "0";

  const fobTotal = useMemo(
    () =>
      sumAs2dp(
        items.map((it) => {
          const price = safeMoney(it?.precioUnitarioFob);
          const qty = Number.isFinite(it?.cantidad) ? it.cantidad : 0;
          return new Decimal(price).times(qty);
        }),
      ),
    [items],
  );

  const fobTotalArs = useMemo(() => {
    const tc = safeMoney(tipoCambioEmbarque);
    return fobTotal.times(new Decimal(tc)).toDecimalPlaces(2);
  }, [fobTotal, tipoCambioEmbarque]);

  // Subtotales de costos en ARS (subtotal × TC del costo)
  const costosSubtotalArs = useMemo(
    () =>
      sumAs2dp(
        costos.map((c) => {
          const sub = safeMoney(c?.subtotal);
          const tc = safeMoney(c?.tipoCambio);
          return new Decimal(sub).times(new Decimal(tc));
        }),
      ),
    [costos],
  );

  // CIF = FOB + Flete internacional + Seguro marítimo (en ARS).
  const cifTotalArs = useMemo(() => {
    const fleteIntl = costos
      .filter((c) => c?.tipo === "FLETE_INTERNACIONAL")
      .reduce(
        (acc, c) =>
          acc.plus(
            new Decimal(safeMoney(c?.subtotal)).times(
              new Decimal(safeMoney(c?.tipoCambio)),
            ),
          ),
        new Decimal(0),
      );
    const seguroIntl = costos
      .filter((c) => c?.tipo === "SEGURO_MARITIMO")
      .reduce(
        (acc, c) =>
          acc.plus(
            new Decimal(safeMoney(c?.subtotal)).times(
              new Decimal(safeMoney(c?.tipoCambio)),
            ),
          ),
        new Decimal(0),
      );
    return fobTotalArs
      .plus(fleteIntl)
      .plus(seguroIntl)
      .toDecimalPlaces(2);
  }, [fobTotalArs, costos]);

  const totalCreditosFiscales = useMemo(
    () =>
      sumAs2dp([
        safeMoney(iva),
        safeMoney(ivaAdicional),
        safeMoney(iibb),
        safeMoney(ganancias),
      ]),
    [iva, ivaAdicional, iibb, ganancias],
  );

  const tributosArs = useMemo(() => {
    const tc = new Decimal(safeMoney(tipoCambioEmbarque));
    return sumAs2dp([
      new Decimal(safeMoney(die)).times(tc),
      new Decimal(safeMoney(tasaEstadistica)).times(tc),
      new Decimal(safeMoney(arancelSim)).times(tc),
    ]);
  }, [die, tasaEstadistica, arancelSim, tipoCambioEmbarque]);

  const costoTotal = useMemo(
    () => sumAs2dp([fobTotalArs, costosSubtotalArs, tributosArs]),
    [fobTotalArs, costosSubtotalArs, tributosArs],
  );

  // ---------- Acciones ----------
  const handleCalcularTributos = () => {
    if (cifTotalArs.lte(0)) {
      toast.error("Complete FOB y costos logísticos para calcular tributos.");
      return;
    }
    // Tributos se ingresan en moneda del embarque; convertimos CIF (ARS)
    // de vuelta a moneda original dividiendo por TC para sugerir valores.
    const tc = new Decimal(safeMoney(tipoCambioEmbarque));
    const cifMoneda = tc.gt(0) ? cifTotalArs.dividedBy(tc) : new Decimal(0);
    const t = calcularTributosSugeridos(cifMoneda);
    setValue("die", t.die.toFixed(2), { shouldValidate: true });
    setValue("tasaEstadistica", t.tasaEstadistica.toFixed(2), {
      shouldValidate: true,
    });
    setValue("arancelSim", t.arancelSim.toFixed(2), { shouldValidate: true });
    setValue("iva", t.iva.toFixed(2), { shouldValidate: true });
    setValue("ivaAdicional", t.ivaAdicional.toFixed(2), {
      shouldValidate: true,
    });
    setValue("ganancias", t.ganancias.toFixed(2), { shouldValidate: true });
    setValue("iibb", t.iibb.toFixed(2), { shouldValidate: true });
    toast.success("Tributos sugeridos calculados.");
  };

  const addItem = () => {
    append({ productoId: "", cantidad: 1, precioUnitarioFob: "0" });
  };

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await guardarEmbarqueAction({
        id: isEdit ? props.initialData.id : undefined,
        ...values,
      });
      if (result.ok) {
        toast.success(
          isEdit
            ? `Embarque ${result.codigo} actualizado.`
            : `Embarque ${result.codigo} creado.`,
        );
        router.push("/comex/embarques");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? "Editar embarque" : "Nuevo embarque"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? `Código: ${defaultValues.codigo}`
              : "Registre los datos generales, ítems, costos logísticos y tributos."}
          </p>
        </div>
      </div>

      {readonly && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <HugeiconsIcon
            icon={LockIcon}
            strokeWidth={2}
            className="size-4 shrink-0 text-amber-600"
          />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Embarque CERRADO — solo lectura
            </p>
            <p className="mt-1 text-amber-800/80 dark:text-amber-200/80">
              Este embarque ya fue contabilizado. Los valores no pueden
              modificarse.
              {props.mode === "edit" && props.initialData.asiento && (
                <>
                  {" "}
                  <AsientoEmbarqueLink asiento={props.initialData.asiento} />
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Sección 1: Datos Generales */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <h2 className="text-sm font-semibold">Datos generales</h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo"
                aria-invalid={!!errors.codigo}
                readOnly={isEdit}
                disabled={readonly}
                {...register("codigo")}
              />
              {errors.codigo && <FieldError message={errors.codigo.message} />}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Proveedor</Label>
              <Controller
                control={control}
                name="proveedorId"
                render={({ field }) => (
                  <ProveedorCombobox
                    value={field.value || null}
                    onChange={field.onChange}
                    proveedores={props.proveedores}
                    disabled={readonly}
                  />
                )}
              />
              {errors.proveedorId && (
                <FieldError message={errors.proveedorId.message} />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Depósito de destino</Label>
              <Controller
                control={control}
                name="depositoDestinoId"
                render={({ field }) => (
                  <Select
                    value={field.value || ""}
                    onValueChange={field.onChange}
                    disabled={readonly}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione un depósito" />
                    </SelectTrigger>
                    <SelectContent>
                      {props.depositos.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.depositoDestinoId && (
                <FieldError message={errors.depositoDestinoId.message} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Moneda</Label>
              <Controller
                control={control}
                name="moneda"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={readonly}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={"ARS"}>
                        ARS — Peso argentino
                      </SelectItem>
                      <SelectItem value={"USD"}>USD — Dólar</SelectItem>
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
                disabled={readonly || moneda === "ARS"}
                aria-invalid={!!errors.tipoCambio}
                {...register("tipoCambio")}
              />
              {errors.tipoCambio && (
                <FieldError message={errors.tipoCambio.message} />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Estado</Label>
              <Controller
                control={control}
                name="estado"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={readonly}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADOS_EDITABLES.map((e) => (
                        <SelectItem key={e} value={e}>
                          {ESTADO_LABELS[e]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.estado && <FieldError message={errors.estado.message} />}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sección 2: Items */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ítems del embarque</h2>
            {!readonly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                Agregar ítem
              </Button>
            )}
          </div>

          {fields.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Aún no hay ítems. Agregue al menos uno.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-[40%] py-2 pl-3 text-left font-medium">
                      Producto
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Cantidad
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Precio FOB
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Subtotal
                    </th>
                    {!readonly && <th className="w-12 py-2 pr-3"></th>}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <ItemRow
                      key={field.id}
                      index={index}
                      control={control}
                      register={register}
                      productos={props.productos}
                      disabled={readonly}
                      onRemove={() => remove(index)}
                      errors={errors.items?.[index]}
                    />
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30">
                  <tr>
                    <td
                      colSpan={3}
                      className="py-2 pl-3 text-right text-xs text-muted-foreground"
                    >
                      FOB Total
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums">
                      {formatMoney(fobTotal.toString())}
                    </td>
                    {!readonly && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {errors.items && typeof errors.items.message === "string" && (
            <FieldError message={errors.items.message} />
          )}
        </CardContent>
      </Card>

      {/* Sección 3: Costos Logísticos por proveedor */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Costos logísticos</h2>
            {!readonly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  appendCosto({
                    tipo: "FLETE_INTERNACIONAL",
                    proveedorId: "",
                    cuentaContableGastoId: 0,
                    moneda: "USD",
                    tipoCambio: tipoCambioEmbarque || "1",
                    subtotal: "0",
                    iva: "0",
                    iibb: "0",
                    otros: "0",
                    facturaNumero: "",
                    fechaFactura: "",
                    descripcion: "",
                  })
                }
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                Agregar costo
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Cada costo genera una <strong>cuenta a pagar</strong> a su
            proveedor (flete, despachante, operador, etc.) con su IVA e IIBB
            propios. CIF (FOB + flete internacional + seguro marítimo) ={" "}
            <span className="font-mono font-medium">
              ARS {formatMoney(cifTotalArs.toString())}
            </span>
            .
          </p>

          {costoFields.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Aún no hay costos logísticos. Use “Agregar costo”.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {costoFields.map((field, index) => (
                <CostoRow
                  key={field.id}
                  index={index}
                  control={control}
                  register={register}
                  setValue={setValue}
                  proveedores={props.proveedores}
                  cuentasGasto={props.cuentasGasto}
                  disabled={readonly}
                  onRemove={() => removeCosto(index)}
                  errors={errors.costos?.[index]}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección 4: Nacionalización */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Nacionalización — tributos y gastos
            </h2>
            {!readonly && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCalcularTributos}
              >
                <HugeiconsIcon icon={Calculator01Icon} strokeWidth={2} />
                Calcular tributos sugeridos
              </Button>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-200">
            <HugeiconsIcon
              icon={InformationCircleIcon}
              strokeWidth={2}
              className="mt-0.5 size-4 shrink-0"
            />
            <div className="space-y-0.5">
              <p>
                Ingrese estos valores en la <strong>moneda del embarque</strong>
                {moneda && <> ({moneda})</>} tal como aparecen en el despacho.
                Al cerrar el embarque se convierten a ARS multiplicando por el
                TC del embarque ({tipoCambioEmbarque || "—"}) — la AFIP cobra en
                pesos.
              </p>
              <p>
                <strong>Tributos aduaneros</strong> (DIE, Tasa, Arancel SIM):
                componen el costo del producto.{" "}
                <strong>Créditos fiscales</strong> (IVA, IVA Adicional, IIBB,
                Ganancias): van al ACTIVO, no al costo.
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tributos aduaneros ({moneda})
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MoneyField
                label="DIE (5.7.1.01)"
                name="die"
                register={register}
                errors={errors}
                disabled={readonly}
              />
              <MoneyField
                label="Tasa Estadística (5.7.1.02)"
                name="tasaEstadistica"
                register={register}
                errors={errors}
                disabled={readonly}
              />
              <MoneyField
                label="Arancel SIM (5.7.1.03)"
                name="arancelSim"
                register={register}
                errors={errors}
                disabled={readonly}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Créditos fiscales ({moneda})
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <MoneyField
                label="IVA 21% (1.1.4.04)"
                name="iva"
                register={register}
                errors={errors}
                disabled={readonly}
              />
              <MoneyField
                label="IVA Adicional 20% (1.1.4.05)"
                name="ivaAdicional"
                register={register}
                errors={errors}
                disabled={readonly}
              />
              <MoneyField
                label="Percepción IIBB (1.1.4.06)"
                name="iibb"
                register={register}
                errors={errors}
                disabled={readonly}
              />
              <MoneyField
                label="Percepción Ganancias (1.1.4.07)"
                name="ganancias"
                register={register}
                errors={errors}
                disabled={readonly}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sección 5: Resumen */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Resumen</h2>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <ResumenLinha
              label="FOB Total (moneda)"
              value={formatMoney(fobTotal.toString())}
            />
            <ResumenLinha
              label="FOB Total (ARS)"
              value={formatMoney(fobTotalArs.toString())}
            />
            <ResumenLinha
              label="CIF (FOB + Flete intl + Seguro)"
              value={formatMoney(cifTotalArs.toString())}
            />
            <ResumenLinha
              label="Costos logísticos (subtotal ARS)"
              value={formatMoney(costosSubtotalArs.toString())}
            />
            <ResumenLinha
              label="Créditos fiscales (al activo)"
              value={formatMoney(totalCreditosFiscales.toString())}
            />
            <ResumenLinha
              label="Costo total del embarque (ARS)"
              value={formatMoney(costoTotal.toString())}
              emphasis
            />
          </div>
          <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
            La contabilización de nacionalización se genera al usar{" "}
            <strong>Cerrar y Contabilizar</strong>. El rateio del{" "}
            <em>costo unitario</em> por ítem será ejecutado en el PASO 5.
          </p>
        </CardContent>
      </Card>

      {/* Botones */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/comex/embarques")}
          disabled={isSubmitting}
        >
          {readonly ? "Volver" : "Cancelar"}
        </Button>
        {!readonly && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando…"
              : isEdit
                ? "Guardar cambios"
                : "Crear embarque"}
          </Button>
        )}
        {!readonly &&
          props.mode === "edit" &&
          !props.initialData.asiento && (
            <CerrarEmbarqueDialog
              embarqueId={props.initialData.id}
              embarqueCodigo={props.initialData.codigo}
              previewTotalDebe={formatMoney(costoTotal.toString())}
              disabled={isSubmitting}
            />
          )}
      </div>
    </form>
  );
}

// ---------- Helpers / subcomponentes ----------

type ItemErrors = {
  productoId?: { message?: string };
  cantidad?: { message?: string };
  precioUnitarioFob?: { message?: string };
};

function ItemRow({
  index,
  control,
  register,
  productos,
  disabled,
  onRemove,
  errors,
}: {
  index: number;
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  productos: ProductoOption[];
  disabled: boolean;
  onRemove: () => void;
  errors?: ItemErrors;
}) {
  const cantidad = useWatch({
    control,
    name: `items.${index}.cantidad` as const,
  });
  const precioUnitarioFob = useWatch({
    control,
    name: `items.${index}.precioUnitarioFob` as const,
  });

  const subtotal = useMemo(() => {
    const qty = Number.isFinite(cantidad) ? cantidad : 0;
    const price = safeMoney(precioUnitarioFob ?? "0");
    return new Decimal(price).times(qty).toDecimalPlaces(2).toString();
  }, [cantidad, precioUnitarioFob]);

  return (
    <tr className="border-t align-top">
      <td className="py-2 pl-3">
        <Controller
          control={control}
          name={`items.${index}.productoId` as const}
          render={({ field }) => (
            <ProductoCombobox
              value={field.value || null}
              onChange={field.onChange}
              productos={productos}
              disabled={disabled}
            />
          )}
        />
        {errors?.productoId?.message && (
          <FieldError message={errors.productoId.message} />
        )}
      </td>
      <td className="py-2 pr-3">
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          className="w-24 text-right tabular-nums"
          disabled={disabled}
          aria-invalid={!!errors?.cantidad}
          {...register(`items.${index}.cantidad` as const, {
            valueAsNumber: true,
          })}
        />
        {errors?.cantidad?.message && (
          <FieldError message={errors.cantidad.message} />
        )}
      </td>
      <td className="py-2 pr-3">
        <Input
          inputMode="decimal"
          className="w-32 text-right tabular-nums"
          disabled={disabled}
          aria-invalid={!!errors?.precioUnitarioFob}
          {...register(`items.${index}.precioUnitarioFob` as const)}
        />
        {errors?.precioUnitarioFob?.message && (
          <FieldError message={errors.precioUnitarioFob.message} />
        )}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums">
        {formatMoney(subtotal)}
      </td>
      {!disabled && (
        <td className="py-2 pr-3 text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Remover ítem"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        </td>
      )}
    </tr>
  );
}

type CostoErrors = {
  tipo?: { message?: string };
  proveedorId?: { message?: string };
  cuentaContableGastoId?: { message?: string };
  moneda?: { message?: string };
  tipoCambio?: { message?: string };
  subtotal?: { message?: string };
  iva?: { message?: string };
  iibb?: { message?: string };
  otros?: { message?: string };
};

function CostoRow({
  index,
  control,
  register,
  setValue,
  proveedores,
  cuentasGasto,
  disabled,
  onRemove,
  errors,
}: {
  index: number;
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  setValue: ReturnType<typeof useForm<FormValues>>["setValue"];
  proveedores: ProveedorOption[];
  cuentasGasto: CuentaOption[];
  disabled: boolean;
  onRemove: () => void;
  errors?: CostoErrors;
}) {
  const moneda = useWatch({ control, name: `costos.${index}.moneda` as const });
  const subtotal = useWatch({
    control,
    name: `costos.${index}.subtotal` as const,
  });
  const iva = useWatch({ control, name: `costos.${index}.iva` as const });
  const iibb = useWatch({ control, name: `costos.${index}.iibb` as const });
  const otros = useWatch({ control, name: `costos.${index}.otros` as const });
  const tc = useWatch({
    control,
    name: `costos.${index}.tipoCambio` as const,
  });

  useEffect(() => {
    if (moneda === "ARS") {
      setValue(`costos.${index}.tipoCambio` as const, "1", {
        shouldValidate: true,
      });
    }
  }, [moneda, index, setValue]);

  const totalMoneda = useMemo(() => {
    const s = new Decimal(safeMoney(subtotal));
    const i = new Decimal(safeMoney(iva));
    const b = new Decimal(safeMoney(iibb));
    const o = new Decimal(safeMoney(otros));
    return s.plus(i).plus(b).plus(o).toDecimalPlaces(2);
  }, [subtotal, iva, iibb, otros]);

  const totalArs = useMemo(
    () =>
      totalMoneda
        .times(new Decimal(safeMoney(tc)))
        .toDecimalPlaces(2),
    [totalMoneda, tc],
  );

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Tipo</Label>
          <Controller
            control={control}
            name={`costos.${index}.tipo` as const}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={disabled}
              >
                <SelectTrigger className="h-9 w-full">
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
          {errors?.tipo?.message && (
            <FieldError message={errors.tipo.message} />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs">Proveedor</Label>
          <Controller
            control={control}
            name={`costos.${index}.proveedorId` as const}
            render={({ field }) => (
              <ProveedorCombobox
                value={field.value || null}
                onChange={field.onChange}
                proveedores={proveedores}
                disabled={disabled}
              />
            )}
          />
          {errors?.proveedorId?.message && (
            <FieldError message={errors.proveedorId.message} />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs">Cuenta de gasto</Label>
          <Controller
            control={control}
            name={`costos.${index}.cuentaContableGastoId` as const}
            render={({ field }) => (
              <CuentaCombobox
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? 0)}
                cuentas={cuentasGasto}
                disabled={disabled}
              />
            )}
          />
          {errors?.cuentaContableGastoId?.message && (
            <FieldError message={errors.cuentaContableGastoId.message} />
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Moneda</Label>
          <Controller
            control={control}
            name={`costos.${index}.moneda` as const}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={disabled}
              >
                <SelectTrigger className="h-9 w-full">
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
        <div className="flex flex-col gap-1">
          <Label className="text-xs">TC</Label>
          <Input
            inputMode="decimal"
            className="h-9 text-right tabular-nums"
            disabled={disabled || moneda === "ARS"}
            {...register(`costos.${index}.tipoCambio` as const)}
          />
          {errors?.tipoCambio?.message && (
            <FieldError message={errors.tipoCambio.message} />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Subtotal</Label>
          <Input
            inputMode="decimal"
            className="h-9 text-right tabular-nums"
            disabled={disabled}
            {...register(`costos.${index}.subtotal` as const)}
          />
          {errors?.subtotal?.message && (
            <FieldError message={errors.subtotal.message} />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">IVA</Label>
          <Input
            inputMode="decimal"
            className="h-9 text-right tabular-nums"
            disabled={disabled}
            {...register(`costos.${index}.iva` as const)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">IIBB</Label>
          <Input
            inputMode="decimal"
            className="h-9 text-right tabular-nums"
            disabled={disabled}
            {...register(`costos.${index}.iibb` as const)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Otros</Label>
          <Input
            inputMode="decimal"
            className="h-9 text-right tabular-nums"
            disabled={disabled}
            {...register(`costos.${index}.otros` as const)}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Nº Factura (opcional)</Label>
          <Input
            className="h-9"
            disabled={disabled}
            {...register(`costos.${index}.facturaNumero` as const)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Fecha factura (opcional)</Label>
          <Input
            type="date"
            className="h-9"
            disabled={disabled}
            {...register(`costos.${index}.fechaFactura` as const)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Descripción (opcional)</Label>
          <Input
            className="h-9"
            disabled={disabled}
            {...register(`costos.${index}.descripcion` as const)}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <p className="text-xs text-muted-foreground">
          Total {moneda}{" "}
          <span className="font-mono font-medium">
            {formatMoney(totalMoneda.toString())}
          </span>{" "}
          · Total ARS{" "}
          <span className="font-mono font-medium">
            {formatMoney(totalArs.toString())}
          </span>
        </p>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Remover costo"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className="size-4"
            />
            Quitar
          </Button>
        )}
      </div>
    </div>
  );
}

function MoneyField({
  label,
  name,
  register,
  errors,
  disabled,
}: {
  label: string;
  name: keyof FormValues;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errors: Partial<Record<keyof FormValues, { message?: string }>>;
  disabled: boolean;
}) {
  const err = errors[name];
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        inputMode="decimal"
        className="text-right tabular-nums"
        disabled={disabled}
        aria-invalid={!!err}
        {...register(name as never)}
      />
      {err?.message && <FieldError message={err.message} />}
    </div>
  );
}

function ResumenLinha({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
        emphasis ? "border-primary bg-primary/5 font-medium" : "bg-muted/30"
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
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

function sumAs2dp(values: Decimal.Value[]): Decimal {
  return values
    .reduce<Decimal>((acc, v) => acc.plus(new Decimal(v)), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0,00";
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
