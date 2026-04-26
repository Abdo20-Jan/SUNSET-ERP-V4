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

/**
 * Mapeo del enum TipoProveedor (maestros) → TipoCostoEmbarque (categoría
 * de gasto en el embarque). Sirve para auto-poblar la categoría al
 * seleccionar un proveedor en una factura.
 */
function mapTipoProveedorACostoEmbarque(
  tipoProveedor: string | null,
): TipoCosto | null {
  switch (tipoProveedor) {
    case "DESPACHANTE":              return "HONORARIOS_DESPACHANTE";
    case "LOGISTICA":                return "FLETE_NACIONAL";
    case "ALMACENAJE":               return "ALMACENAJE";
    case "GASTOS_PORTUARIOS":        return "GASTOS_PORTUARIOS";
    case "SERVICIOS_EXTERIOR":       return "FLETE_INTERNACIONAL";
    case "SERVICIOS_PROFESIONALES":  return "GASTOS_EXTRAS";
    case "MERCADERIA_LOCAL":
    case "MERCADERIA_EXTERIOR":
    case "ALQUILERES":
    case "IT_SOFTWARE":
    case "MARKETING":
    case "OTRO":
    default:                         return "GASTOS_LOCALES";
  }
}

const formSchema = z
  .object({
    codigo: z.string().trim().min(1, "Código requerido").max(32),
    proveedorId: z.string().uuid("Seleccione un proveedor"),
    depositoDestinoId: z.string().uuid("Seleccione un depósito de destino"),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "Tipo de cambio inválido"),
    incoterm: z
      .enum([
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
      ])
      .nullable()
      .optional(),
    lugarIncoterm: z.string().max(80).optional(),
    nombreBuque: z.string().max(120).optional(),
    lineaMaritima: z.string().max(120).optional(),
    fechaEmpaque: z.string().optional(),
    lugarTransbordo: z.string().max(120).optional(),
    fechaTransbordo: z.string().optional(),
    fechaSalida: z.string().optional(),
    fechaLlegada: z.string().optional(),
    diasPagoDespuesLlegada: z.string().optional(),
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
        proveedorId: z.string().uuid("Seleccione un proveedor"),
        moneda: z.enum(["ARS", "USD"]),
        tipoCambio: z.string().regex(rateRegex, "TC inválido"),
        facturaNumero: z.string().max(64).optional(),
        fechaFactura: z.string().optional(),
        // IVA/IIBB/otros a nivel factura (no por línea)
        iva: z.string().regex(moneyRegex, "IVA inválido"),
        iibb: z.string().regex(moneyRegex, "IIBB inválido"),
        otros: z.string().regex(moneyRegex, "Otros inválido"),
        notas: z.string().max(500).optional(),
        lineas: z
          .array(
            z.object({
              tipo: z.enum(TIPO_COSTO_VALUES),
              cuentaContableGastoId: z
                .number()
                .int()
                .positive("Seleccione la cuenta"),
              descripcion: z.string().max(200).optional(),
              subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
            }),
          )
          .min(1, "Agregue al menos un gasto"),
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
          incoterm: null,
          lugarIncoterm: "",
          nombreBuque: "",
          lineaMaritima: "",
          fechaEmpaque: "",
          lugarTransbordo: "",
          fechaTransbordo: "",
          fechaSalida: "",
          fechaLlegada: "",
          diasPagoDespuesLlegada: "",
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
          incoterm: props.initialData.incoterm,
          lugarIncoterm: props.initialData.lugarIncoterm ?? "",
          nombreBuque: props.initialData.nombreBuque ?? "",
          lineaMaritima: props.initialData.lineaMaritima ?? "",
          fechaEmpaque: props.initialData.fechaEmpaque
            ? props.initialData.fechaEmpaque.slice(0, 10)
            : "",
          lugarTransbordo: props.initialData.lugarTransbordo ?? "",
          fechaTransbordo: props.initialData.fechaTransbordo
            ? props.initialData.fechaTransbordo.slice(0, 10)
            : "",
          fechaSalida: props.initialData.fechaSalida
            ? props.initialData.fechaSalida.slice(0, 10)
            : "",
          fechaLlegada: props.initialData.fechaLlegada
            ? props.initialData.fechaLlegada.slice(0, 10)
            : "",
          diasPagoDespuesLlegada:
            props.initialData.diasPagoDespuesLlegada != null
              ? String(props.initialData.diasPagoDespuesLlegada)
              : "",
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
            proveedorId: c.proveedorId,
            moneda: c.moneda,
            tipoCambio: c.tipoCambio,
            facturaNumero: c.facturaNumero ?? "",
            fechaFactura: c.fechaFactura ? c.fechaFactura.slice(0, 10) : "",
            iva: c.iva,
            iibb: c.iibb,
            otros: c.otros,
            notas: c.notas ?? "",
            lineas: c.lineas.map((l) => ({
              tipo: l.tipo as TipoCosto,
              cuentaContableGastoId: l.cuentaContableGastoId,
              descripcion: l.descripcion ?? "",
              subtotal: l.subtotal,
            })),
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

  // Subtotales de gastos en ARS: por cada factura, suma todas sus líneas
  // y multiplica por el TC de la factura.
  const costosSubtotalArs = useMemo(
    () =>
      sumAs2dp(
        costos.map((factura) => {
          const tc = new Decimal(safeMoney(factura?.tipoCambio));
          const subtotalFactura = (factura?.lineas ?? []).reduce(
            (acc, l) => acc.plus(new Decimal(safeMoney(l?.subtotal))),
            new Decimal(0),
          );
          return subtotalFactura.times(tc);
        }),
      ),
    [costos],
  );

  // IVA/IIBB/otros a nivel factura (créditos fiscales locales) × TC de la factura
  const costosFiscalesArs = useMemo(
    () =>
      sumAs2dp(
        costos.map((factura) => {
          const tc = new Decimal(safeMoney(factura?.tipoCambio));
          const total = new Decimal(safeMoney(factura?.iva))
            .plus(new Decimal(safeMoney(factura?.iibb)))
            .plus(new Decimal(safeMoney(factura?.otros)));
          return total.times(tc);
        }),
      ),
    [costos],
  );

  // CIF = FOB + Flete internacional + Seguro marítimo (en ARS), recorriendo
  // cada línea de cada factura y filtrando por tipo.
  const cifTotalArs = useMemo(() => {
    function sumByTipo(tipo: string): Decimal {
      return costos.reduce((acc, factura) => {
        const tc = new Decimal(safeMoney(factura?.tipoCambio));
        const sub = (factura?.lineas ?? [])
          .filter((l) => l?.tipo === tipo)
          .reduce(
            (a, l) => a.plus(new Decimal(safeMoney(l?.subtotal))),
            new Decimal(0),
          );
        return acc.plus(sub.times(tc));
      }, new Decimal(0));
    }
    const fleteIntl = sumByTipo("FLETE_INTERNACIONAL");
    const seguroIntl = sumByTipo("SEGURO_MARITIMO");
    return fobTotalArs.plus(fleteIntl).plus(seguroIntl).toDecimalPlaces(2);
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
    () =>
      sumAs2dp([fobTotalArs, costosSubtotalArs, costosFiscalesArs, tributosArs]),
    [fobTotalArs, costosSubtotalArs, costosFiscalesArs, tributosArs],
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Incoterm</Label>
              <Controller
                control={control}
                name="incoterm"
                render={({ field }) => (
                  <Select
                    value={field.value ?? "NONE"}
                    onValueChange={(v) =>
                      field.onChange(v === "NONE" ? null : v)
                    }
                    disabled={readonly}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sin definir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">— Sin definir —</SelectItem>
                      <SelectItem value="EXW">EXW — Ex Works</SelectItem>
                      <SelectItem value="FCA">FCA — Free Carrier</SelectItem>
                      <SelectItem value="FAS">
                        FAS — Free Alongside Ship
                      </SelectItem>
                      <SelectItem value="FOB">FOB — Free On Board</SelectItem>
                      <SelectItem value="CFR">CFR — Cost &amp; Freight</SelectItem>
                      <SelectItem value="CIF">
                        CIF — Cost, Insurance &amp; Freight
                      </SelectItem>
                      <SelectItem value="CPT">CPT — Carriage Paid To</SelectItem>
                      <SelectItem value="CIP">
                        CIP — Carriage &amp; Insurance Paid
                      </SelectItem>
                      <SelectItem value="DAP">
                        DAP — Delivered At Place
                      </SelectItem>
                      <SelectItem value="DPU">
                        DPU — Delivered At Place Unloaded
                      </SelectItem>
                      <SelectItem value="DDP">
                        DDP — Delivered Duty Paid
                      </SelectItem>
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
                disabled={readonly}
                {...register("lugarIncoterm")}
              />
            </div>
          </div>

          {/* Datos de transporte */}
          <div className="rounded-md border bg-muted/20 p-3">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Datos de transporte
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="nombreBuque" className="text-xs">
                  Nombre del buque
                </Label>
                <Input
                  id="nombreBuque"
                  placeholder="Ej: MSC GAYANE"
                  disabled={readonly}
                  {...register("nombreBuque")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lineaMaritima" className="text-xs">
                  Línea marítima
                </Label>
                <Input
                  id="lineaMaritima"
                  placeholder="Ej: MSC, Maersk, CMA CGM"
                  disabled={readonly}
                  {...register("lineaMaritima")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="fechaEmpaque" className="text-xs">
                  Fecha de empaque
                </Label>
                <Input
                  id="fechaEmpaque"
                  type="date"
                  disabled={readonly}
                  {...register("fechaEmpaque")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="fechaSalida" className="text-xs">
                  Fecha de salida
                </Label>
                <Input
                  id="fechaSalida"
                  type="date"
                  disabled={readonly}
                  {...register("fechaSalida")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lugarTransbordo" className="text-xs">
                  Lugar de transbordo
                </Label>
                <Input
                  id="lugarTransbordo"
                  placeholder="Opcional — si hay transbordo"
                  disabled={readonly}
                  {...register("lugarTransbordo")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="fechaTransbordo" className="text-xs">
                  Fecha de transbordo
                </Label>
                <Input
                  id="fechaTransbordo"
                  type="date"
                  disabled={readonly}
                  {...register("fechaTransbordo")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="fechaLlegada" className="text-xs">
                  Fecha de llegada del contenedor
                </Label>
                <Input
                  id="fechaLlegada"
                  type="date"
                  disabled={readonly}
                  {...register("fechaLlegada")}
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label
                  htmlFor="diasPagoDespuesLlegada"
                  className="text-xs"
                >
                  Plazo de pago (días después de la llegada)
                </Label>
                <Input
                  id="diasPagoDespuesLlegada"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Ej: 120"
                  disabled={readonly}
                  {...register("diasPagoDespuesLlegada")}
                />
                <p className="text-xs text-muted-foreground">
                  El vencimiento se calcula como{" "}
                  <span className="font-mono">fecha de llegada + N días</span>.
                </p>
              </div>
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

      {/* Sección 3: Gastos de nacionalización (facturas de proveedores locales) */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Gastos de nacionalización · Facturas de proveedores locales
            </h2>
            {!readonly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  appendCosto({
                    proveedorId: "",
                    moneda: "ARS",
                    tipoCambio: "1",
                    facturaNumero: "",
                    fechaFactura: "",
                    iva: "0",
                    iibb: "0",
                    otros: "0",
                    notas: "",
                    lineas: [
                      {
                        tipo: "GASTOS_PORTUARIOS",
                        cuentaContableGastoId: 0,
                        descripcion: "",
                        subtotal: "0",
                      },
                    ],
                  })
                }
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                Agregar factura
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Una <strong>factura por proveedor local</strong> (despachante,
            operador portuario, fletes, almacenaje, etc.). Dentro de cada
            factura agregue tantos <strong>gastos</strong> como conceptos
            tenga — cada uno con su <strong>cuenta analítica</strong>
            propia. <strong>IVA, IIBB y otros</strong> se cargan a nivel
            factura (van directo al proveedor — no son gastos). CIF (FOB +
            flete intl + seguro marítimo) ={" "}
            <span className="font-mono font-medium">
              ARS {formatMoney(cifTotalArs.toString())}
            </span>
            .
          </p>

          {costoFields.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Aún no hay facturas. Use “Agregar factura”.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {costoFields.map((field, index) => (
                <FacturaCard
                  key={field.id}
                  index={index}
                  control={control}
                  register={register}
                  setValue={setValue}
                  proveedores={props.proveedores}
                  cuentasGasto={props.cuentasGasto}
                  disabled={readonly}
                  onRemove={() => removeCosto(index)}
                  errors={errors.costos?.[index] as FacturaErrors | undefined}
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

      {/* Spacer pra que el contenido no quede oculto detrás del action bar */}
      <div className="h-16" aria-hidden />

      {/* Sticky action bar */}
      <div className="sticky bottom-0 -mx-4 mt-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            <span className="text-muted-foreground">FOB:</span>{" "}
            <span className="font-mono font-medium">
              {formatMoney(fobTotal.toString())}
            </span>
            {" · "}
            <span className="text-muted-foreground">Costo total:</span>{" "}
            <span className="font-mono font-semibold">
              ARS {formatMoney(costoTotal.toString())}
            </span>
          </div>
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
        </div>
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

type FacturaErrors = {
  proveedorId?: { message?: string };
  moneda?: { message?: string };
  tipoCambio?: { message?: string };
  iva?: { message?: string };
  iibb?: { message?: string };
  otros?: { message?: string };
  lineas?: Array<{
    tipo?: { message?: string };
    cuentaContableGastoId?: { message?: string };
    descripcion?: { message?: string };
    subtotal?: { message?: string };
  }>;
};

function FacturaCard({
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
  errors?: FacturaErrors;
}) {
  const moneda = useWatch({ control, name: `costos.${index}.moneda` as const });
  const tc = useWatch({
    control,
    name: `costos.${index}.tipoCambio` as const,
  });
  const lineas = useWatch({
    control,
    name: `costos.${index}.lineas` as const,
  }) as Array<{ subtotal?: string }> | undefined;
  const facturaIva = useWatch({
    control,
    name: `costos.${index}.iva` as const,
  });
  const facturaIibb = useWatch({
    control,
    name: `costos.${index}.iibb` as const,
  });
  const facturaOtros = useWatch({
    control,
    name: `costos.${index}.otros` as const,
  });
  const proveedorId = useWatch({
    control,
    name: `costos.${index}.proveedorId` as const,
  });

  const {
    fields: lineaFields,
    append: appendLinea,
    remove: removeLinea,
  } = useFieldArray({
    control,
    name: `costos.${index}.lineas` as const,
  });

  useEffect(() => {
    if (moneda === "ARS") {
      setValue(`costos.${index}.tipoCambio` as const, "1", {
        shouldValidate: true,
      });
    }
  }, [moneda, index, setValue]);

  // Auto-fill cuenta gasto + tipo de cada linea cuando se selecciona el
  // proveedor. Solo sobreescribe lineas con cuentaContableGastoId=0
  // (no toca lineas ya configuradas manualmente).
  useEffect(() => {
    if (!proveedorId) return;
    const prov = proveedores.find((p) => p.id === proveedorId);
    if (!prov) return;
    const tipoDefault = mapTipoProveedorACostoEmbarque(
      prov.tipoProveedor ?? null,
    );
    const lineasActuales = (lineas ?? []) as Array<{
      cuentaContableGastoId?: number;
      tipo?: string;
    }>;
    lineasActuales.forEach((l, i) => {
      if (!l) return;
      if (
        (!l.cuentaContableGastoId || l.cuentaContableGastoId === 0) &&
        prov.cuentaGastoContableId
      ) {
        setValue(
          `costos.${index}.lineas.${i}.cuentaContableGastoId` as const,
          prov.cuentaGastoContableId,
          { shouldValidate: false },
        );
      }
      if (tipoDefault) {
        setValue(
          `costos.${index}.lineas.${i}.tipo` as const,
          tipoDefault,
          { shouldValidate: false },
        );
      }
    });
    // Solo dispara cuando cambia el proveedorId — no en cada keystroke de lineas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId]);

  const totales = useMemo(() => {
    const subtotalSum = (lineas ?? []).reduce(
      (acc, l) => acc.plus(new Decimal(safeMoney(l?.subtotal))),
      new Decimal(0),
    );
    const ivaDec = new Decimal(safeMoney(facturaIva));
    const iibbDec = new Decimal(safeMoney(facturaIibb));
    const otrosDec = new Decimal(safeMoney(facturaOtros));
    const total = subtotalSum.plus(ivaDec).plus(iibbDec).plus(otrosDec);
    const tcDec = new Decimal(safeMoney(tc));
    return {
      subtotal: subtotalSum.toDecimalPlaces(2),
      iva: ivaDec.toDecimalPlaces(2),
      iibb: iibbDec.toDecimalPlaces(2),
      otros: otrosDec.toDecimalPlaces(2),
      total: total.toDecimalPlaces(2),
      totalArs: total.times(tcDec).toDecimalPlaces(2),
    };
  }, [lineas, tc, facturaIva, facturaIibb, facturaOtros]);

  const proveedorNombre = useMemo(
    () =>
      proveedores.find((p) => p.id === proveedorId)?.nombre ??
      "Sin proveedor",
    [proveedores, proveedorId],
  );

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Factura #{index + 1}
          </span>
          <span className="text-sm font-medium">{proveedorNombre}</span>
        </div>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Remover factura"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className="size-4"
            />
            Quitar factura
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Header de la factura */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="md:col-span-2 flex flex-col gap-1">
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
            <Label className="text-xs">Tipo de cambio</Label>
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
            <Label className="text-xs">Nº Factura</Label>
            <Input
              className="h-9"
              placeholder="Opcional"
              disabled={disabled}
              {...register(`costos.${index}.facturaNumero` as const)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Fecha factura</Label>
            <Input
              type="date"
              className="h-9"
              disabled={disabled}
              {...register(`costos.${index}.fechaFactura` as const)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              className="h-9"
              placeholder="Nº de orden, observación, etc."
              disabled={disabled}
              {...register(`costos.${index}.notas` as const)}
            />
          </div>
        </div>

        {/* Impuestos a nivel factura (no por línea) */}
        <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">
              IVA ({moneda})
              <span className="ml-1 text-muted-foreground">— factura</span>
            </Label>
            <Input
              inputMode="decimal"
              className="h-9 text-right tabular-nums"
              disabled={disabled}
              {...register(`costos.${index}.iva` as const)}
            />
            {errors?.iva?.message && <FieldError message={errors.iva.message} />}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">
              IIBB ({moneda})
              <span className="ml-1 text-muted-foreground">— factura</span>
            </Label>
            <Input
              inputMode="decimal"
              className="h-9 text-right tabular-nums"
              disabled={disabled}
              {...register(`costos.${index}.iibb` as const)}
            />
            {errors?.iibb?.message && (
              <FieldError message={errors.iibb.message} />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">
              Otros ({moneda})
              <span className="ml-1 text-muted-foreground">— factura</span>
            </Label>
            <Input
              inputMode="decimal"
              className="h-9 text-right tabular-nums"
              disabled={disabled}
              {...register(`costos.${index}.otros` as const)}
            />
            {errors?.otros?.message && (
              <FieldError message={errors.otros.message} />
            )}
          </div>
        </div>

        {/* Tabla de gastos */}
        <div className="mt-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Gastos de la factura — cada uno con su cuenta analítica
          </h3>
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const prov = proveedores.find((p) => p.id === proveedorId);
                appendLinea({
                  tipo: "GASTOS_PORTUARIOS",
                  cuentaContableGastoId: prov?.cuentaGastoContableId ?? 0,
                  descripcion: "",
                  subtotal: "0",
                });
              }}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Agregar gasto
            </Button>
          )}
        </div>

        {lineaFields.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            La factura debe tener al menos una línea.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-44 py-2 pl-3 text-left font-medium">
                    Tipo
                  </th>
                  <th className="py-2 px-2 text-left font-medium">
                    Cuenta analítica
                  </th>
                  <th className="py-2 px-2 text-left font-medium">
                    Descripción
                  </th>
                  <th className="w-32 py-2 px-2 text-right font-medium">
                    Subtotal ({moneda})
                  </th>
                  {!disabled && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {lineaFields.map((field, lineaIdx) => (
                  <LineaRow
                    key={field.id}
                    facturaIndex={index}
                    lineaIndex={lineaIdx}
                    control={control}
                    register={register}
                    cuentasGasto={cuentasGasto}
                    disabled={disabled}
                    onRemove={() => removeLinea(lineaIdx)}
                    errors={errors?.lineas?.[lineaIdx]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totales */}
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t pt-3 text-xs">
          <span className="text-muted-foreground">
            Subtotal:{" "}
            <span className="font-mono font-medium text-foreground">
              {moneda} {formatMoney(totales.subtotal.toString())}
            </span>
          </span>
          <span className="text-muted-foreground">
            IVA:{" "}
            <span className="font-mono font-medium text-foreground">
              {formatMoney(totales.iva.toString())}
            </span>
          </span>
          <span className="text-muted-foreground">
            IIBB:{" "}
            <span className="font-mono font-medium text-foreground">
              {formatMoney(totales.iibb.toString())}
            </span>
          </span>
          <span className="text-muted-foreground">
            Otros:{" "}
            <span className="font-mono font-medium text-foreground">
              {formatMoney(totales.otros.toString())}
            </span>
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">Total factura:</span>{" "}
            <span className="font-mono font-semibold">
              {moneda} {formatMoney(totales.total.toString())}
            </span>
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">≈</span>{" "}
            <span className="font-mono font-semibold">
              ARS {formatMoney(totales.totalArs.toString())}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

type LineaErrors = NonNullable<FacturaErrors["lineas"]>[number];

function LineaRow({
  facturaIndex,
  lineaIndex,
  control,
  register,
  cuentasGasto,
  disabled,
  onRemove,
  errors,
}: {
  facturaIndex: number;
  lineaIndex: number;
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  cuentasGasto: CuentaOption[];
  disabled: boolean;
  onRemove: () => void;
  errors?: LineaErrors;
}) {
  const path = `costos.${facturaIndex}.lineas.${lineaIndex}` as const;

  return (
    <tr className="border-t align-top">
      <td className="py-2 pl-3 pr-2">
        <Controller
          control={control}
          name={`${path}.tipo` as const}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 w-full text-xs">
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
        {errors?.tipo?.message && <FieldError message={errors.tipo.message} />}
      </td>
      <td className="py-2 px-2">
        <Controller
          control={control}
          name={`${path}.cuentaContableGastoId` as const}
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
      </td>
      <td className="py-2 px-2">
        <Input
          className="h-8 text-xs"
          placeholder="Servicio de balanza, etc."
          disabled={disabled}
          {...register(`${path}.descripcion` as const)}
        />
      </td>
      <td className="py-2 px-2">
        <Input
          inputMode="decimal"
          className="h-8 text-right text-xs tabular-nums"
          disabled={disabled}
          {...register(`${path}.subtotal` as const)}
        />
        {errors?.subtotal?.message && (
          <FieldError message={errors.subtotal.message} />
        )}
      </td>
      {!disabled && (
        <td className="py-2 pr-2 text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRemove}
            aria-label="Quitar línea"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className="size-3.5"
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
