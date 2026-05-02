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
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";

import {
  guardarPedidoCompraAction,
  type PedidoCompraDetalle,
} from "@/lib/actions/pedidos-compra";
import { fmtMoney } from "@/lib/format";
import { useCmdShortcut } from "@/lib/hooks/use-cmd-shortcut";
import {
  ProductoCombobox,
  type ProductoOption,
} from "@/components/producto-combobox";
import {
  ProveedorCombobox,
  type ProveedorOption,
} from "@/components/proveedor-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
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
const rateRegex = /^\d+(\.\d{1,6})?$/;

const formSchema = z
  .object({
    numero: z.string().min(1).max(32),
    proveedorId: z.string().uuid("Seleccione proveedor"),
    fecha: z.string().min(1, "Fecha requerida"),
    fechaPrevista: z.string().optional(),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    observaciones: z.string().max(500).optional(),
    items: z
      .array(
        z.object({
          productoId: z.string().uuid("Seleccione producto"),
          cantidad: z.coerce.number().int().positive("Cantidad > 0"),
          precioUnitario: z.string().regex(moneyRegex, "Precio inválido"),
        }),
      )
      .min(1, "Al menos un ítem"),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === "ARS" && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC=1",
      });
    }
  });

type FormValues = z.input<typeof formSchema>;

type ProveedorOpt = { id: string; nombre: string; pais: string };
type ProductoOpt = {
  id: string;
  codigo: string;
  nombre: string;
  costoPromedio: string;
};

type Props = {
  mode: "create" | "edit";
  numeroSugerido?: string;
  initialData?: PedidoCompraDetalle;
  proveedores: ProveedorOpt[];
  productos: ProductoOpt[];
};

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function PedidoCompraForm({
  mode,
  numeroSugerido,
  initialData,
  proveedores,
  productos,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  const proveedorOptions: ProveedorOption[] = proveedores.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    pais: p.pais,
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
        proveedorId: initialData!.proveedorId,
        fecha: initialData!.fecha.slice(0, 10),
        fechaPrevista: initialData!.fechaPrevista
          ? initialData!.fechaPrevista.slice(0, 10)
          : "",
        moneda: initialData!.moneda,
        tipoCambio: initialData!.tipoCambio,
        observaciones: initialData!.observaciones ?? "",
        items: initialData!.items.map((it) => ({
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
        })),
      }
    : {
        numero: numeroSugerido ?? "",
        proveedorId: "",
        fecha: todayISO(),
        fechaPrevista: "",
        moneda: "ARS",
        tipoCambio: "1",
        observaciones: "",
        items: [{ productoId: "", cantidad: 1, precioUnitario: "0" }],
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

  const moneda = useWatch({ control, name: "moneda" });
  const items = useWatch({ control, name: "items" }) ?? [];

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  const onProductoChange = (index: number, id: string) => {
    setValue(`items.${index}.productoId`, id, { shouldValidate: true });
    const p = productos.find((x) => x.id === id);
    const current = getValues(`items.${index}.precioUnitario`);
    if (p && (current === "" || current === "0")) {
      setValue(`items.${index}.precioUnitario`, p.costoPromedio, {
        shouldValidate: true,
      });
    }
  };

  const total = useMemo(() => {
    let acc = new Decimal(0);
    for (const it of items) {
      const qty = Number(it?.cantidad ?? 0) || 0;
      const price = new Decimal(safe(it?.precioUnitario));
      acc = acc.plus(price.times(qty));
    }
    return acc.toDecimalPlaces(2);
  }, [items]);

  const submit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await guardarPedidoCompraAction({
        id: isEdit ? initialData!.id : undefined,
        numero: values.numero,
        proveedorId: values.proveedorId,
        fecha: values.fecha,
        fechaPrevista:
          values.fechaPrevista && values.fechaPrevista.trim() !== ""
            ? values.fechaPrevista
            : undefined,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        observaciones: values.observaciones,
        items: values.items.map((it) => ({
          productoId: it.productoId,
          cantidad: Number(it.cantidad),
          precioUnitario: it.precioUnitario,
        })),
      });
      if (result.ok) {
        toast.success(`Pedido ${result.numero} guardado.`);
        router.push(`/compras/pedidos/${result.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  useCmdShortcut("s", () => submit(), !isPending);

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 pb-32">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          {isEdit
            ? `Editar pedido ${initialData!.numero}`
            : "Nuevo pedido de compra (OC)"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Una orden de compra define lo que se va a pedir. La factura se crea
          después desde el pedido.
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">Número</Label>
            <Input {...register("numero")} placeholder="OC-2026-0001" />
            {errors.numero && (
              <p className="text-xs text-destructive">{errors.numero.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">Proveedor</Label>
            <Controller
              control={control}
              name="proveedorId"
              render={({ field }) => (
                <ProveedorCombobox
                  value={field.value || null}
                  onChange={field.onChange}
                  proveedores={proveedorOptions}
                />
              )}
            />
            {errors.proveedorId && (
              <p className="text-xs text-destructive">
                {errors.proveedorId.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">Fecha</Label>
            <Controller
              control={control}
              name="fecha"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">
              Fecha prevista
            </Label>
            <Controller
              control={control}
              name="fechaPrevista"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">Moneda</Label>
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wide">
              Tipo de cambio
            </Label>
            <Input
              {...register("tipoCambio")}
              disabled={moneda === "ARS"}
              inputMode="decimal"
            />
            {errors.tipoCambio && (
              <p className="text-xs text-destructive">
                {errors.tipoCambio.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Ítems del pedido</h2>
              <p className="text-xs text-muted-foreground">
                Sin IVA acá. El IVA se calcula al crear la factura desde el
                pedido.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                append(
                  { productoId: "", cantidad: 1, precioUnitario: "0" },
                  { shouldFocus: false },
                )
              }
            >
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
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="observaciones" className="text-xs uppercase tracking-wide">
            Observaciones
          </Label>
          <Textarea id="observaciones" rows={3} {...register("observaciones")} />
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-4 py-3 lg:px-8">
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Total estimado
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {fmtMoney(total.toString())} {moneda}
            </span>
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar pedido"}
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

function ItemRow({
  index,
  control,
  productos,
  productosFull,
  onProductoChange,
  onRemove,
  canRemove,
  register,
}: {
  index: number;
  control: Control<FormValues>;
  productos: ProductoOption[];
  productosFull: ProductoOpt[];
  onProductoChange: (index: number, id: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  register: ReturnType<typeof useForm<FormValues>>["register"];
}) {
  const cantidad = useWatch({ control, name: `items.${index}.cantidad` });
  const precio = useWatch({
    control,
    name: `items.${index}.precioUnitario`,
  });
  const productoId = useWatch({ control, name: `items.${index}.productoId` });

  const subtotal = useMemo(() => {
    const qty = Number(cantidad ?? 0) || 0;
    return new Decimal(safe(precio)).times(qty).toDecimalPlaces(2);
  }, [cantidad, precio]);

  const productoSel = productosFull.find((p) => p.id === productoId);

  return (
    <div className="grid grid-cols-1 items-end gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-12">
      <div className="md:col-span-6">
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
      </div>
      <div className="md:col-span-1">
        <Label className="text-xs uppercase tracking-wide">Cant.</Label>
        <Input
          type="number"
          step="1"
          min="1"
          {...register(`items.${index}.cantidad` as const, {
            valueAsNumber: true,
          })}
        />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs uppercase tracking-wide">P. unit.</Label>
        <Input
          inputMode="decimal"
          {...register(`items.${index}.precioUnitario` as const)}
        />
      </div>
      <div className="md:col-span-2 text-right">
        <Label className="text-xs uppercase tracking-wide">Subtotal</Label>
        <p className="font-mono text-sm tabular-nums">
          {fmtMoney(subtotal.toString())}
        </p>
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
