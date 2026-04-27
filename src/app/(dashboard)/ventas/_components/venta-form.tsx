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
import Decimal from "decimal.js";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Delete02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

import {
  emitirVentaAction,
  guardarVentaAction,
  type ClienteParaVenta,
  type ProductoParaVenta,
  type VentaDetalle,
} from "@/lib/actions/ventas";
import { fmtMoney } from "@/lib/format";
import { useCmdShortcut } from "@/lib/hooks/use-cmd-shortcut";
import {
  ClienteCombobox,
  type ClienteOption,
} from "@/components/cliente-combobox";
import {
  ProductoCombobox,
  type ProductoOption,
} from "@/components/producto-combobox";
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
import { Textarea } from "@/components/ui/textarea";

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const precioUnitarioRegex = /^\d+(\.\d{1,4})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const CONDICION_VALUES = [
  "CONTADO",
  "TRANSFERENCIA",
  "CHEQUE",
  "TARJETA",
  "CUENTA_CORRIENTE",
  "OTRO",
] as const;

const CONDICION_LABELS: Record<(typeof CONDICION_VALUES)[number], string> = {
  CONTADO: "Contado",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
};

const formSchema = z
  .object({
    numero: z.string().min(1, "Número requerido").max(32),
    clienteId: z.string().uuid("Seleccione cliente"),
    fecha: z.string().min(1, "Fecha requerida"),
    fechaVencimiento: z.string().optional(),
    condicionPago: z.enum(CONDICION_VALUES),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    iibb: z.string().regex(moneyRegex, "IIBB inválido"),
    otros: z.string().regex(moneyRegex, "Otros inválido"),
    notas: z.string().max(500).optional(),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid("Seleccione un producto"),
          cantidad: z.coerce.number().positive("Cantidad > 0"),
          precioUnitario: z
            .string()
            .regex(precioUnitarioRegex, "Precio inválido (máx. 4 decimales)"),
          ivaPorcentaje: z
            .string()
            .regex(/^\d+(\.\d{1,2})?$/, "IVA% inválido"),
        }),
      )
      .min(1, "Agregue al menos un ítem"),
    cheques: z
      .array(
        z.object({
          numero: z.string().trim().min(1, "Nº de cheque requerido").max(40),
          tipo: z.enum(["FISICO", "ECHEQ"]),
          banco: z.string().trim().max(80).optional(),
          emisor: z.string().trim().max(120).optional(),
          cuitEmisor: z.string().trim().max(20).optional(),
          importe: z.string().regex(moneyRegex, "Importe inválido"),
          fechaEmision: z.string().min(1, "Fecha emisión requerida"),
          fechaPago: z.string().min(1, "Fecha pago requerida"),
        }),
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === "ARS" && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC debe ser 1",
      });
    }
    if (
      data.fechaVencimiento &&
      data.fechaVencimiento.trim() !== "" &&
      new Date(data.fechaVencimiento) < new Date(data.fecha)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["fechaVencimiento"],
        message: "Vencimiento no puede ser anterior a la fecha",
      });
    }
  });

type FormValues = z.input<typeof formSchema>;

type Props = {
  mode: "create" | "edit";
  numeroSugerido?: string;
  initialData?: VentaDetalle;
  clientes: ClienteParaVenta[];
  productos: ProductoParaVenta[];
};

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function VentaForm({
  mode,
  numeroSugerido,
  initialData,
  clientes,
  productos,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  const clienteOptions: ClienteOption[] = clientes.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    diasPagoDefault: c.diasPagoDefault,
  }));
  const productoOptions: ProductoOption[] = productos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    marca: null,
    medida: null,
  }));

  const defaultValues: FormValues = isEdit
    ? {
        numero: initialData!.numero,
        clienteId: initialData!.clienteId,
        fecha: initialData!.fecha.slice(0, 10),
        fechaVencimiento: initialData!.fechaVencimiento
          ? initialData!.fechaVencimiento.slice(0, 10)
          : "",
        condicionPago: initialData!.condicionPago,
        moneda: initialData!.moneda,
        tipoCambio: initialData!.tipoCambio,
        iibb: initialData!.iibb,
        otros: initialData!.otros,
        notas: initialData!.notas ?? "",
        items: initialData!.items.map((it) => {
          const sub = new Decimal(it.subtotal);
          const ivaDec = new Decimal(it.iva);
          const pct = sub.gt(0)
            ? ivaDec.dividedBy(sub).times(100).toDecimalPlaces(2).toString()
            : "21";
          return {
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitario: it.precioUnitario,
            ivaPorcentaje: pct,
          };
        }),
        cheques: (initialData!.chequesRecibidos ?? []).map((c) => ({
          numero: c.numero,
          tipo: c.tipo as "FISICO" | "ECHEQ",
          banco: c.banco ?? "",
          emisor: c.emisor ?? "",
          cuitEmisor: c.cuitEmisor ?? "",
          importe: c.importe,
          fechaEmision: c.fechaEmision.slice(0, 10),
          fechaPago: c.fechaPago.slice(0, 10),
        })),
      }
    : {
        numero: numeroSugerido ?? "",
        clienteId: "",
        fecha: todayISO(),
        fechaVencimiento: "",
        condicionPago: "CONTADO",
        moneda: "ARS",
        tipoCambio: "1",
        iibb: "0",
        otros: "0",
        notas: "",
        items: [
          {
            productoId: "",
            cantidad: 1,
            precioUnitario: "0",
            ivaPorcentaje: "21",
          },
        ],
        cheques: [],
      };

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const {
    fields: chequeFields,
    append: appendCheque,
    remove: removeCheque,
  } = useFieldArray({ control, name: "cheques" });

  const moneda = useWatch({ control, name: "moneda" });
  const fecha = useWatch({ control, name: "fecha" });
  const clienteId = useWatch({ control, name: "clienteId" });
  const items = useWatch({ control, name: "items" }) ?? [];
  const iibb = useWatch({ control, name: "iibb" }) ?? "0";
  const otros = useWatch({ control, name: "otros" }) ?? "0";

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  const onClienteChange = (id: string) => {
    setValue("clienteId", id, { shouldValidate: true });
    if (isEdit) return;
    const c = clientes.find((x) => x.id === id);
    if (!c) return;
    setValue("condicionPago", c.condicionPagoDefault, { shouldValidate: true });
    if (c.diasPagoDefault != null && fecha) {
      setValue("fechaVencimiento", addDays(fecha, c.diasPagoDefault), {
        shouldValidate: true,
      });
    }
  };

  const onProductoChange = (index: number, id: string) => {
    setValue(`items.${index}.productoId`, id, { shouldValidate: true });
    const p = productos.find((x) => x.id === id);
    const current = getValues(`items.${index}.precioUnitario`);
    if (p && (current === "" || current === "0")) {
      setValue(`items.${index}.precioUnitario`, p.precioVenta, {
        shouldValidate: true,
      });
    }
  };

  // ---- totales en tiempo real ----
  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let iva = new Decimal(0);
    for (const it of items) {
      const qty = Number(it?.cantidad ?? 0) || 0;
      const price = safe(it?.precioUnitario);
      const sub = new Decimal(price).times(qty);
      const pct = new Decimal(safe(it?.ivaPorcentaje)).dividedBy(100);
      subtotal = subtotal.plus(sub);
      iva = iva.plus(sub.times(pct));
    }
    const i = new Decimal(safe(iibb));
    const o = new Decimal(safe(otros));
    const total = subtotal.plus(iva).plus(i).plus(o);
    return {
      subtotal: subtotal.toDecimalPlaces(2),
      iva: iva.toDecimalPlaces(2),
      iibb: i.toDecimalPlaces(2),
      otros: o.toDecimalPlaces(2),
      total: total.toDecimalPlaces(2),
    };
  }, [items, iibb, otros]);

  // Warning si IVA total no coincide con 21% del subtotal
  const ivaWarning = useMemo(() => {
    const sub = totals.subtotal;
    if (sub.lte(0)) return null;
    const expected = sub.times(0.21).toDecimalPlaces(2);
    const diff = totals.iva.minus(expected).abs();
    if (diff.lte(1)) return null;
    return `IVA esperado ≈ ${fmtMoney(expected.toString())} (21%); ingresado ${fmtMoney(totals.iva.toString())}`;
  }, [totals]);

  const addItem = () => {
    append({
      productoId: "",
      cantidad: 1,
      precioUnitario: "0",
      ivaPorcentaje: "21",
    });
  };

  const submitGuardar = handleSubmit((values) => {
    startTransition(async () => {
      const result = await guardarVentaAction({
        id: isEdit ? initialData!.id : undefined,
        numero: values.numero,
        clienteId: values.clienteId,
        fecha: values.fecha,
        fechaVencimiento:
          values.fechaVencimiento && values.fechaVencimiento.trim() !== ""
            ? values.fechaVencimiento
            : undefined,
        condicionPago: values.condicionPago,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        iibb: values.iibb,
        otros: values.otros,
        notas: values.notas,
        items: values.items.map((it) => ({
          productoId: it.productoId,
          cantidad: Number(it.cantidad),
          precioUnitario: it.precioUnitario,
          ivaPorcentaje: it.ivaPorcentaje,
        })),
        cheques: (values.cheques ?? []).map((c) => ({
          numero: c.numero,
          tipo: c.tipo,
          banco: c.banco || undefined,
          emisor: c.emisor || undefined,
          cuitEmisor: c.cuitEmisor || undefined,
          importe: c.importe,
          fechaEmision: c.fechaEmision,
          fechaPago: c.fechaPago,
        })),
      });
      if (result.ok) {
        toast.success(`Venta ${result.numero} guardada (BORRADOR).`);
        router.push(`/ventas/${result.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  useCmdShortcut("s", () => submitGuardar(), !isPending);

  const submitEmitir = handleSubmit((values) => {
    startTransition(async () => {
      const saved = await guardarVentaAction({
        id: isEdit ? initialData!.id : undefined,
        numero: values.numero,
        clienteId: values.clienteId,
        fecha: values.fecha,
        fechaVencimiento:
          values.fechaVencimiento && values.fechaVencimiento.trim() !== ""
            ? values.fechaVencimiento
            : undefined,
        condicionPago: values.condicionPago,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        iibb: values.iibb,
        otros: values.otros,
        notas: values.notas,
        items: values.items.map((it) => ({
          productoId: it.productoId,
          cantidad: Number(it.cantidad),
          precioUnitario: it.precioUnitario,
          ivaPorcentaje: it.ivaPorcentaje,
        })),
        cheques: (values.cheques ?? []).map((c) => ({
          numero: c.numero,
          tipo: c.tipo,
          banco: c.banco || undefined,
          emisor: c.emisor || undefined,
          cuitEmisor: c.cuitEmisor || undefined,
          importe: c.importe,
          fechaEmision: c.fechaEmision,
          fechaPago: c.fechaPago,
        })),
      });
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      const emit = await emitirVentaAction(saved.id);
      if (emit.ok) {
        toast.success(
          `Venta ${saved.numero} emitida (asiento Nº ${emit.numeroAsiento}).`,
        );
        router.push(`/ventas/${saved.id}`);
        router.refresh();
      } else {
        toast.error(emit.error);
      }
    });
  });

  return (
    <form onSubmit={submitGuardar} className="flex flex-col gap-6 pb-32">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEdit ? `Editar venta ${initialData!.numero}` : "Nueva venta"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? "Modifique los datos antes de emitir."
            : "Registre la venta en BORRADOR. Al emitir, se genera el asiento contable."}
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Número" error={errors.numero?.message}>
            <Input {...register("numero")} placeholder="V-2026-0001" />
          </Field>

          <Field label="Cliente" error={errors.clienteId?.message}>
            <Controller
              control={control}
              name="clienteId"
              render={({ field }) => (
                <ClienteCombobox
                  value={field.value || null}
                  onChange={onClienteChange}
                  clientes={clienteOptions}
                />
              )}
            />
          </Field>

          <Field label="Fecha" error={errors.fecha?.message}>
            <Input type="date" {...register("fecha")} />
          </Field>

          <Field
            label="Vencimiento"
            error={errors.fechaVencimiento?.message}
            hint="Auto-calculado según cliente"
          >
            <Input type="date" {...register("fechaVencimiento")} />
          </Field>

          <Field label="Condición de pago">
            <Controller
              control={control}
              name="condicionPago"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) =>
                    field.onChange(v as (typeof CONDICION_VALUES)[number])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDICION_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {CONDICION_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <Field label="Moneda">
            <Controller
              control={control}
              name="moneda"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v as "ARS" | "USD")}
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
          </Field>

          <Field
            label="Tipo de cambio"
            error={errors.tipoCambio?.message}
            hint={moneda === "ARS" ? "ARS: TC = 1" : undefined}
          >
            <Input
              {...register("tipoCambio")}
              disabled={moneda === "ARS"}
              inputMode="decimal"
            />
          </Field>

          <Field label="IIBB" error={errors.iibb?.message}>
            <Input {...register("iibb")} inputMode="decimal" />
          </Field>

          <Field label="Otros" error={errors.otros?.message}>
            <Input {...register("otros")} inputMode="decimal" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Ítems</h2>
              <p className="text-xs text-muted-foreground">
                Cada ítem se valoriza en moneda de la venta.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={addItem}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Agregar ítem
            </Button>
          </div>

          {errors.items?.message && (
            <p className="text-sm text-destructive">{errors.items.message}</p>
          )}

          <div className="flex flex-col gap-3">
            {fields.map((f, index) => (
              <ItemRow
                key={f.id}
                index={index}
                control={control}
                productos={productoOptions}
                productosFull={productos}
                onProductoChange={onProductoChange}
                onRemove={() => remove(index)}
                canRemove={fields.length > 1}
                register={register}
                errorProducto={errors.items?.[index]?.productoId?.message}
                errorCantidad={errors.items?.[index]?.cantidad?.message}
                errorPrecio={errors.items?.[index]?.precioUnitario?.message}
                errorIva={errors.items?.[index]?.ivaPorcentaje?.message}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">Cheques recibidos</h2>
              <p className="text-xs text-muted-foreground">
                Cheques de terceros (físicos o e-cheques) recibidos como
                cobro. Quedan en cartera (cuenta 1.1.4.20) hasta que se
                acrediten en el banco. Cada cheque puede tener su propia
                fecha de pago.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                appendCheque({
                  numero: "",
                  tipo: "ECHEQ",
                  banco: "",
                  emisor: "",
                  cuitEmisor: "",
                  importe: "0",
                  fechaEmision: todayISO(),
                  fechaPago: todayISO(),
                })
              }
            >
              + Agregar cheque
            </Button>
          </div>

          {chequeFields.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
              Sin cheques. Si recibís cheques de terceros, agregalos aquí —
              el asiento debitará 1.1.4.20 VALORES A COBRAR en lugar del
              cliente.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {chequeFields.map((f, idx) => (
                <div
                  key={f.id}
                  className="grid grid-cols-1 items-end gap-2 rounded-lg border bg-muted/10 p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-1">
                    <Label className="text-[10px] uppercase">Tipo</Label>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                      {...register(`cheques.${idx}.tipo` as const)}
                    >
                      <option value="ECHEQ">e-Cheq</option>
                      <option value="FISICO">Físico</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px] uppercase">Nº</Label>
                    <Input
                      className="h-9 text-xs"
                      placeholder="11885210"
                      {...register(`cheques.${idx}.numero` as const)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px] uppercase">Banco</Label>
                    <Input
                      className="h-9 text-xs"
                      placeholder="BCO Corrientes"
                      {...register(`cheques.${idx}.banco` as const)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px] uppercase">Emisor</Label>
                    <Input
                      className="h-9 text-xs"
                      placeholder="Razón social"
                      {...register(`cheques.${idx}.emisor` as const)}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-[10px] uppercase">CUIT</Label>
                    <Input
                      className="h-9 text-xs"
                      placeholder="20-..."
                      {...register(`cheques.${idx}.cuitEmisor` as const)}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-[10px] uppercase">F. emisión</Label>
                    <Input
                      type="date"
                      className="h-9 text-xs"
                      {...register(`cheques.${idx}.fechaEmision` as const)}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-[10px] uppercase">F. pago</Label>
                    <Input
                      type="date"
                      className="h-9 text-xs"
                      {...register(`cheques.${idx}.fechaPago` as const)}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Label className="text-[10px] uppercase">Importe</Label>
                    <Input
                      inputMode="decimal"
                      className="h-9 text-xs"
                      {...register(`cheques.${idx}.importe` as const)}
                    />
                  </div>
                  <div className="flex justify-end md:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeCheque(idx)}
                      aria-label="Eliminar cheque"
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

      <Card>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="notas" className="text-xs uppercase tracking-wide">
            Notas
          </Label>
          <Textarea
            id="notas"
            rows={3}
            placeholder="Observaciones internas (opcional)"
            {...register("notas")}
          />
        </CardContent>
      </Card>

      {ivaWarning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <strong>Verifique IVA:</strong> {ivaWarning}
          </span>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-4 py-3 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <Total label="Subtotal" value={totals.subtotal.toString()} />
            <Total label="IVA" value={totals.iva.toString()} />
            <Total label="IIBB" value={totals.iibb.toString()} />
            <Total label="Otros" value={totals.otros.toString()} />
            <div className="flex items-baseline gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Total
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {fmtMoney(totals.total.toString())} {moneda}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={submitGuardar}
              disabled={isPending}
            >
              {isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={submitEmitir}
              disabled={isPending}
            >
              {isPending ? "Procesando…" : "Guardar y emitir"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function safe(v: unknown): string {
  if (v === undefined || v === null || v === "") return "0";
  return String(v);
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs uppercase tracking-wide">{label}</Label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-3"
          />
          {error}
        </p>
      ) : hint ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className="size-3"
          />
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm tabular-nums">{fmtMoney(value)}</span>
    </div>
  );
}

type ItemRowProps = {
  index: number;
  control: Control<FormValues>;
  productos: ProductoOption[];
  productosFull: ProductoParaVenta[];
  onProductoChange: (index: number, id: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errorProducto?: string;
  errorCantidad?: string;
  errorPrecio?: string;
  errorIva?: string;
};

function ItemRow({
  index,
  control,
  productos,
  productosFull,
  onProductoChange,
  onRemove,
  canRemove,
  register,
  errorProducto,
  errorCantidad,
  errorPrecio,
  errorIva,
}: ItemRowProps) {
  const cantidad = useWatch({ control, name: `items.${index}.cantidad` });
  const precio = useWatch({
    control,
    name: `items.${index}.precioUnitario`,
  });
  const ivaPct = useWatch({ control, name: `items.${index}.ivaPorcentaje` });
  const productoId = useWatch({ control, name: `items.${index}.productoId` });

  const subtotal = useMemo(() => {
    const qty = Number(cantidad ?? 0) || 0;
    const price = new Decimal(safe(precio));
    return price.times(qty).toDecimalPlaces(2);
  }, [cantidad, precio]);

  const iva = useMemo(() => {
    const pct = new Decimal(safe(ivaPct)).dividedBy(100);
    return subtotal.times(pct).toDecimalPlaces(2);
  }, [subtotal, ivaPct]);

  const total = subtotal.plus(iva).toDecimalPlaces(2);

  const productoSel = productosFull.find((p) => p.id === productoId);

  // Rentabilidad: usa costo promedio del producto.
  // ganancia bruta = subtotal - (costo × cantidad).
  // ganancia neta = bruta × (1 - 0.35) (post-Provisión Ganancias 35%).
  // margen% = ganancia / subtotal × 100.
  const rentabilidad = useMemo(() => {
    if (!productoSel) return null;
    const costo = new Decimal(productoSel.costoPromedio || "0");
    if (costo.lte(0)) return null;
    const qty = Number(cantidad ?? 0) || 0;
    if (qty <= 0) return null;
    const costoTotal = costo.times(qty);
    const gananciaBruta = subtotal.minus(costoTotal);
    const provisionGanancias = gananciaBruta.gt(0)
      ? gananciaBruta.times(0.35).toDecimalPlaces(2)
      : new Decimal(0);
    const gananciaNeta = gananciaBruta.minus(provisionGanancias);
    const margenBrutoPct = subtotal.gt(0)
      ? gananciaBruta.dividedBy(subtotal).times(100).toDecimalPlaces(2)
      : new Decimal(0);
    const margenNetoPct = subtotal.gt(0)
      ? gananciaNeta.dividedBy(subtotal).times(100).toDecimalPlaces(2)
      : new Decimal(0);
    return {
      gananciaBruta: gananciaBruta.toDecimalPlaces(2),
      gananciaNeta: gananciaNeta.toDecimalPlaces(2),
      provisionGanancias,
      margenBrutoPct,
      margenNetoPct,
      costoTotal: costoTotal.toDecimalPlaces(2),
    };
  }, [productoSel, subtotal, cantidad]);

  return (
    <div className="grid grid-cols-1 items-end gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-12">
      <div className="md:col-span-5">
        <Label className="text-xs uppercase tracking-wide">Producto</Label>
        <ProductoCombobox
          value={productoId || null}
          onChange={(id) => onProductoChange(index, id)}
          productos={productos}
        />
        {productoSel && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {productoSel.nombre}
          </p>
        )}
        {errorProducto && (
          <p className="mt-1 text-xs text-destructive">{errorProducto}</p>
        )}
      </div>

      <div className="md:col-span-1">
        <Label className="text-xs uppercase tracking-wide">Cant.</Label>
        <Input
          type="number"
          step="0.01"
          min="0"
          {...register(`items.${index}.cantidad` as const, {
            valueAsNumber: true,
          })}
        />
        {errorCantidad && (
          <p className="mt-1 text-xs text-destructive">{errorCantidad}</p>
        )}
      </div>

      <div className="md:col-span-2">
        <Label className="text-xs uppercase tracking-wide">P. unit.</Label>
        <Input
          inputMode="decimal"
          {...register(`items.${index}.precioUnitario` as const)}
        />
        {errorPrecio && (
          <p className="mt-1 text-xs text-destructive">{errorPrecio}</p>
        )}
      </div>

      <div className="md:col-span-1">
        <Label className="text-xs uppercase tracking-wide">IVA %</Label>
        <Input
          inputMode="decimal"
          {...register(`items.${index}.ivaPorcentaje` as const)}
        />
        {errorIva && (
          <p className="mt-1 text-xs text-destructive">{errorIva}</p>
        )}
      </div>

      <div className="md:col-span-2 text-right">
        <Label className="text-xs uppercase tracking-wide">Total línea</Label>
        <p className="font-mono text-sm tabular-nums">
          {fmtMoney(total.toString())}
        </p>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {fmtMoney(subtotal.toString())} + IVA {fmtMoney(iva.toString())}
        </p>
        {rentabilidad ? (
          <div
            className="mt-1 flex flex-col items-end gap-0"
            title={`Costo total: ${fmtMoney(rentabilidad.costoTotal.toString())} · Provisión Ganancias 35%: ${fmtMoney(rentabilidad.provisionGanancias.toString())}`}
          >
            <p
              className={
                "font-mono text-[11px] tabular-nums text-muted-foreground"
              }
            >
              Bruto {rentabilidad.margenBrutoPct.toFixed(2)}% ·{" "}
              {rentabilidad.gananciaBruta.gte(0) ? "+" : ""}
              {fmtMoney(rentabilidad.gananciaBruta.toString())}
            </p>
            <p
              className={
                "font-mono text-xs font-semibold tabular-nums " +
                (rentabilidad.gananciaNeta.gte(0)
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-destructive")
              }
            >
              Neto {rentabilidad.margenNetoPct.toFixed(2)}% ·{" "}
              {rentabilidad.gananciaNeta.gte(0) ? "+" : ""}
              {fmtMoney(rentabilidad.gananciaNeta.toString())}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Margen — (sin costo)
          </p>
        )}
      </div>

      <div className="flex justify-end md:col-span-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Eliminar ítem"
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
