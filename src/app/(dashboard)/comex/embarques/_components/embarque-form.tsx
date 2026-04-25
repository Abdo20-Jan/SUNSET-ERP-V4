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

const formSchema = z
  .object({
    codigo: z.string().trim().min(1, "Código requerido").max(32),
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    depositoDestinoId: z.string().uuid("Seleccione un depósito de destino"),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
    estado: z.enum(ESTADO_VALUES),
    flete: z.string().regex(moneyRegex, "Inválido"),
    seguro: z.string().regex(moneyRegex, "Inválido"),
    die: z.string().regex(moneyRegex, "Inválido"),
    tasaEstadistica: z.string().regex(moneyRegex, "Inválido"),
    arancelSim: z.string().regex(moneyRegex, "Inválido"),
    iva: z.string().regex(moneyRegex, "Inválido"),
    ivaAdicional: z.string().regex(moneyRegex, "Inválido"),
    ganancias: z.string().regex(moneyRegex, "Inválido"),
    iibb: z.string().regex(moneyRegex, "Inválido"),
    gastosPortuarios: z.string().regex(moneyRegex, "Inválido"),
    honorariosDespachante: z.string().regex(moneyRegex, "Inválido"),
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
      codigoSugerido: string;
    }
  | {
      mode: "edit";
      proveedores: ProveedorOption[];
      productos: ProductoOption[];
      depositos: DepositoOption[];
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
          flete: "0",
          seguro: "0",
          die: "0",
          tasaEstadistica: "0",
          arancelSim: "0",
          iva: "0",
          ivaAdicional: "0",
          ganancias: "0",
          iibb: "0",
          gastosPortuarios: "0",
          honorariosDespachante: "0",
          items: [],
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
          flete: props.initialData.flete,
          seguro: props.initialData.seguro,
          die: props.initialData.die,
          tasaEstadistica: props.initialData.tasaEstadistica,
          arancelSim: props.initialData.arancelSim,
          iva: props.initialData.iva,
          ivaAdicional: props.initialData.ivaAdicional,
          ganancias: props.initialData.ganancias,
          iibb: props.initialData.iibb,
          gastosPortuarios: props.initialData.gastosPortuarios,
          honorariosDespachante: props.initialData.honorariosDespachante,
          items: props.initialData.items.map((it) => ({
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitarioFob: it.precioUnitarioFob,
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

  const moneda = useWatch({ control, name: "moneda" });

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  // ---------- Cálculos en tiempo real ----------
  const items = useWatch({ control, name: "items" }) ?? [];
  const flete = useWatch({ control, name: "flete" }) ?? "0";
  const seguro = useWatch({ control, name: "seguro" }) ?? "0";
  const die = useWatch({ control, name: "die" }) ?? "0";
  const tasaEstadistica =
    useWatch({ control, name: "tasaEstadistica" }) ?? "0";
  const arancelSim = useWatch({ control, name: "arancelSim" }) ?? "0";
  const iva = useWatch({ control, name: "iva" }) ?? "0";
  const ivaAdicional = useWatch({ control, name: "ivaAdicional" }) ?? "0";
  const ganancias = useWatch({ control, name: "ganancias" }) ?? "0";
  const iibb = useWatch({ control, name: "iibb" }) ?? "0";
  const gastosPortuarios =
    useWatch({ control, name: "gastosPortuarios" }) ?? "0";
  const honorariosDespachante =
    useWatch({ control, name: "honorariosDespachante" }) ?? "0";

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

  const cifTotal = useMemo(
    () => sumAs2dp([fobTotal, safeMoney(flete), safeMoney(seguro)]),
    [fobTotal, flete, seguro],
  );

  const totalGastosReales = useMemo(
    () =>
      sumAs2dp([
        safeMoney(flete),
        safeMoney(seguro),
        safeMoney(die),
        safeMoney(tasaEstadistica),
        safeMoney(arancelSim),
        safeMoney(gastosPortuarios),
        safeMoney(honorariosDespachante),
      ]),
    [
      flete,
      seguro,
      die,
      tasaEstadistica,
      arancelSim,
      gastosPortuarios,
      honorariosDespachante,
    ],
  );

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

  const costoTotal = useMemo(
    () => sumAs2dp([fobTotal, totalGastosReales]),
    [fobTotal, totalGastosReales],
  );

  // ---------- Acciones ----------
  const handleCalcularTributos = () => {
    if (cifTotal.lte(0)) {
      toast.error("Complete FOB y costos logísticos para calcular tributos.");
      return;
    }
    const t = calcularTributosSugeridos(cifTotal);
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

      {/* Sección 3: Costos Logísticos */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Costos logísticos</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MoneyField
              label="Flete internacional"
              name="flete"
              register={register}
              errors={errors}
              disabled={readonly}
            />
            <MoneyField
              label="Seguro"
              name="seguro"
              register={register}
              errors={errors}
              disabled={readonly}
            />
            <div className="flex flex-col gap-2">
              <Label>CIF Total (FOB + Flete + Seguro)</Label>
              <div className="flex h-9 items-center justify-end rounded-md border border-input bg-muted/30 px-3 font-mono text-sm tabular-nums">
                {formatMoney(cifTotal.toString())}
              </div>
            </div>
          </div>
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
                <strong>Gastos reales</strong> (componen el costo del producto):
                DIE, Tasa Estadística, Arancel SIM, Gastos Portuarios,
                Honorarios Despachante.
              </p>
              <p>
                <strong>Créditos fiscales</strong> (al ACTIVO, no al costo):
                IVA, IVA Adicional, Percepción IIBB, Percepción Ganancias.
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Gastos reales
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
              <MoneyField
                label="Gastos portuarios (5.4.1.01)"
                name="gastosPortuarios"
                register={register}
                errors={errors}
                disabled={readonly}
              />
              <MoneyField
                label="Honorarios despachante (5.6.1.01)"
                name="honorariosDespachante"
                register={register}
                errors={errors}
                disabled={readonly}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Créditos fiscales
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
              label="FOB Total"
              value={formatMoney(fobTotal.toString())}
            />
            <ResumenLinha
              label="CIF Total"
              value={formatMoney(cifTotal.toString())}
            />
            <ResumenLinha
              label="Gastos reales (al costo)"
              value={formatMoney(totalGastosReales.toString())}
            />
            <ResumenLinha
              label="Créditos fiscales (al activo)"
              value={formatMoney(totalCreditosFiscales.toString())}
            />
            <ResumenLinha
              label="Costo total del embarque"
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
