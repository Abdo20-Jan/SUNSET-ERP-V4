"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Calendar03Icon,
  Delete02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

import {
  crearMovimientoTesoreriaAction,
  type CuentaBancariaOption,
  type CuentaContableContrapartidaOption,
} from "@/lib/actions/movimientos-tesoreria";
import type { ContextoAmortizacion } from "@/lib/actions/prestamos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { CuentaCombobox } from "@/components/cuenta-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const lineaSchema = z.object({
  cuentaContableId: z
    .number()
    .int()
    .positive({ message: "Seleccione la cuenta" }),
  monto: z.string().regex(DECIMAL_RE, "Monto inválido (máx. 2 decimales)"),
  descripcion: z.string().trim().max(255).optional(),
});

const formSchema = z
  .object({
    tipo: z.enum(["COBRO", "PAGO"]),
    cuentaBancariaId: z.string().uuid({ message: "Seleccione la cuenta bancaria" }),
    fecha: z.date({ message: "Seleccione la fecha" }),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(FX_RE, "Tipo de cambio inválido"),
    lineas: z.array(lineaSchema).min(1, "Agregue al menos una línea"),
    descripcion: z.string().trim().max(255).optional(),
    comprobante: z.string().trim().max(100).optional(),
    referenciaBanco: z.string().trim().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    let total = 0;
    data.lineas.forEach((l, i) => {
      const m = Number(l.monto);
      if (!Number.isFinite(m) || m <= 0) {
        ctx.addIssue({
          path: ["lineas", i, "monto"],
          code: z.ZodIssueCode.custom,
          message: "Monto > 0",
        });
      } else {
        total += m;
      }
    });
    if (total <= 0) {
      ctx.addIssue({
        path: ["lineas"],
        code: z.ZodIssueCode.custom,
        message: "El total debe ser mayor a 0",
      });
    }
    const tc = Number(data.tipoCambio);
    if (data.moneda === "ARS" && tc !== 1) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: z.ZodIssueCode.custom,
        message: "TC debe ser 1 cuando moneda=ARS",
      });
    }
    if (data.moneda === "USD" && (!Number.isFinite(tc) || tc <= 0)) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: z.ZodIssueCode.custom,
        message: "TC debe ser mayor a cero",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export type MovimientoFormInitial = {
  tipo?: "COBRO" | "PAGO";
  cuentaContableId?: number;
  descripcion?: string;
  comprobante?: string;
  referenciaBanco?: string;
  monto?: string; // pre-fill monto (string con hasta 2 decimales)
};

export type ModoAmortizacion = "amortizacion" | "intereses";

export function MovimientoForm({
  cuentasBancarias,
  cuentasContrapartida,
  initial,
  contextoAmortizacion,
  modoInicial,
}: {
  cuentasBancarias: CuentaBancariaOption[];
  cuentasContrapartida: CuentaContableContrapartidaOption[];
  initial?: MovimientoFormInitial;
  contextoAmortizacion?: ContextoAmortizacion | null;
  modoInicial?: ModoAmortizacion;
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [modo, setModo] = useState<ModoAmortizacion>(
    modoInicial ?? "amortizacion",
  );

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      tipo: initial?.tipo ?? "COBRO",
      cuentaBancariaId: "",
      fecha: new Date(),
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [
        {
          cuentaContableId: initial?.cuentaContableId ?? 0,
          monto: initial?.monto ?? "0",
          descripcion: initial?.descripcion ?? "",
        },
      ],
      descripcion: "",
      comprobante: initial?.comprobante ?? "",
      referenciaBanco: initial?.referenciaBanco ?? "",
    },
  });

  const {
    fields: lineaFields,
    append: appendLinea,
    remove: removeLinea,
  } = useFieldArray({ control, name: "lineas" });

  const tipo = useWatch({ control, name: "tipo" });
  const moneda = useWatch({ control, name: "moneda" });
  const cuentaBancariaId = useWatch({ control, name: "cuentaBancariaId" });
  const lineas = useWatch({ control, name: "lineas" });
  const totalCalculado = useMemo(() => {
    if (!lineas) return 0;
    return lineas.reduce((s, l) => s + (Number(l?.monto) || 0), 0);
  }, [lineas]);

  const bancoSeleccionado = useMemo(
    () => cuentasBancarias.find((c) => c.id === cuentaBancariaId) ?? null,
    [cuentasBancarias, cuentaBancariaId],
  );

  useEffect(() => {
    if (bancoSeleccionado) {
      setValue("moneda", bancoSeleccionado.moneda, { shouldValidate: true });
    }
  }, [bancoSeleccionado, setValue]);

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  const contrapartidasFiltradas = useMemo(() => {
    if (!bancoSeleccionado) return cuentasContrapartida;
    return cuentasContrapartida.filter(
      (c) => c.id !== bancoSeleccionado.cuentaContableId,
    );
  }, [cuentasContrapartida, bancoSeleccionado]);

  const primeraLineaCuentaId = lineas?.[0]?.cuentaContableId ?? 0;
  const contrapartidaSeleccionada = useMemo(
    () =>
      cuentasContrapartida.find((c) => c.id === primeraLineaCuentaId) ?? null,
    [cuentasContrapartida, primeraLineaCuentaId],
  );

  const handleModoChange = (nuevoModo: ModoAmortizacion) => {
    if (!contextoAmortizacion) return;
    if (nuevoModo === "intereses" && !contextoAmortizacion.cuentaIntereses) {
      return;
    }
    setModo(nuevoModo);
    const cuentaId =
      nuevoModo === "intereses" && contextoAmortizacion.cuentaIntereses
        ? contextoAmortizacion.cuentaIntereses.id
        : contextoAmortizacion.cuentaPrestamo.id;
    setValue("lineas.0.cuentaContableId", cuentaId, { shouldValidate: true });
    setValue(
      "lineas.0.descripcion",
      nuevoModo === "intereses"
        ? `Intereses préstamo ${contextoAmortizacion.prestamo.prestamista}`
        : `Amortización préstamo ${contextoAmortizacion.prestamo.prestamista}`,
      { shouldValidate: false },
    );
  };

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await crearMovimientoTesoreriaAction({
        tipo: values.tipo,
        cuentaBancariaId: values.cuentaBancariaId,
        fecha: values.fecha,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        lineas: values.lineas.map((l) => ({
          cuentaContableId: l.cuentaContableId,
          monto: l.monto,
          descripcion: l.descripcion,
        })),
        descripcion: values.descripcion,
        comprobante: values.comprobante,
        referenciaBanco: values.referenciaBanco,
      });

      if (result.ok) {
        toast.success(
          `Movimiento registrado — Asiento Nº ${result.asientoNumero}`,
        );
        router.push(
          contextoAmortizacion
            ? "/tesoreria/prestamos"
            : "/tesoreria/movimientos",
        );
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {contextoAmortizacion && (
        <PrestamoContextBanner
          contexto={contextoAmortizacion}
          modo={modo}
          onChangeModo={handleModoChange}
        />
      )}
      <Card>
        <CardContent className="flex flex-col gap-5">
          {!contextoAmortizacion && (
            <div className="flex flex-col gap-2">
              <Label>Tipo de movimiento</Label>
              <Controller
                control={control}
                name="tipo"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    <TipoButton
                      selected={field.value === "COBRO"}
                      onClick={() => field.onChange("COBRO")}
                      icon={ArrowDown02Icon}
                      label="Cobro"
                      sublabel="Entrada de dinero"
                      tone="positive"
                    />
                    <TipoButton
                      selected={field.value === "PAGO"}
                      onClick={() => field.onChange("PAGO")}
                      icon={ArrowUp02Icon}
                      label="Pago"
                      sublabel="Salida de dinero"
                      tone="negative"
                    />
                  </div>
                )}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Cuenta bancaria</Label>
              <Controller
                control={control}
                name="cuentaBancariaId"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione una cuenta">
                        {(value) => {
                          const c = cuentasBancarias.find((c) => c.id === value);
                          return c
                            ? `${c.banco} · ${c.numero} · ${c.moneda}`
                            : "Seleccione una cuenta";
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {cuentasBancarias.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.banco} · {c.numero} · {c.moneda}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.cuentaBancariaId && (
                <FieldError message={errors.cuentaBancariaId.message} />
              )}
              {bancoSeleccionado && (
                <p className="text-xs text-muted-foreground">
                  Cuenta contable:{" "}
                  <span className="font-mono">
                    {bancoSeleccionado.cuentaContableCodigo}
                  </span>{" "}
                  — {bancoSeleccionado.cuentaContableNombre}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="fecha">Fecha</Label>
              <Controller
                control={control}
                name="fecha"
                render={({ field }) => (
                  <DatePicker value={field.value} onChange={field.onChange} />
                )}
              />
              {errors.fecha && <FieldError message={errors.fecha.message} />}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="moneda">Moneda</Label>
              <Controller
                control={control}
                name="moneda"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!!bancoSeleccionado}
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
              {bancoSeleccionado && (
                <p className="text-xs text-muted-foreground">
                  Definida por la cuenta bancaria seleccionada.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tipoCambio">Tipo de cambio</Label>
              <Input
                id="tipoCambio"
                inputMode="decimal"
                disabled={moneda === "ARS"}
                aria-invalid={!!errors.tipoCambio}
                {...register("tipoCambio")}
              />
              {errors.tipoCambio && (
                <FieldError message={errors.tipoCambio.message} />
              )}
            </div>
          </div>

          {contextoAmortizacion ? (
            <div className="flex flex-col gap-2">
              <Label>Cuenta contrapartida</Label>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {modo === "intereses" && contextoAmortizacion.cuentaIntereses
                    ? contextoAmortizacion.cuentaIntereses.codigo
                    : contextoAmortizacion.cuentaPrestamo.codigo}
                </span>
                <span className="text-sm">
                  {modo === "intereses" && contextoAmortizacion.cuentaIntereses
                    ? contextoAmortizacion.cuentaIntereses.nombre
                    : contextoAmortizacion.cuentaPrestamo.nombre}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="lineas.0.monto">Monto</Label>
                <Input
                  id="lineas.0.monto"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  aria-invalid={!!errors.lineas?.[0]?.monto}
                  {...register("lineas.0.monto")}
                />
                {errors.lineas?.[0]?.monto && (
                  <FieldError message={errors.lineas[0].monto.message} />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Determinada por el tipo de pago seleccionado arriba.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label>Líneas de contrapartida</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    appendLinea(
                      { cuentaContableId: 0, monto: "0", descripcion: "" },
                      { shouldFocus: false },
                    )
                  }
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                  Agregar línea
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {lineaFields.map((field, idx) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-1 gap-2 rounded-md border bg-card px-3 py-2 md:grid-cols-[2fr_1fr_2fr_auto]"
                  >
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Cuenta {idx + 1}
                      </Label>
                      <Controller
                        control={control}
                        name={`lineas.${idx}.cuentaContableId`}
                        render={({ field: f }) => (
                          <CuentaCombobox
                            value={f.value || null}
                            onChange={f.onChange}
                            cuentas={contrapartidasFiltradas}
                            placeholder="Cuenta contable"
                          />
                        )}
                      />
                      {errors.lineas?.[idx]?.cuentaContableId && (
                        <FieldError
                          message={
                            errors.lineas[idx]?.cuentaContableId?.message
                          }
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Monto
                      </Label>
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        aria-invalid={!!errors.lineas?.[idx]?.monto}
                        {...register(`lineas.${idx}.monto`)}
                      />
                      {errors.lineas?.[idx]?.monto && (
                        <FieldError
                          message={errors.lineas[idx]?.monto?.message}
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Descripción
                      </Label>
                      <Input
                        placeholder="opcional"
                        {...register(`lineas.${idx}.descripcion`)}
                      />
                    </div>
                    <div className="flex items-end">
                      {lineaFields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLinea(idx)}
                          aria-label="Eliminar línea"
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {tipo === "COBRO"
                    ? "Total a cobrar (entrada al banco)"
                    : "Total a pagar (salida del banco)"}
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {moneda}{" "}
                  {totalCalculado.toLocaleString("es-AR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {tipo === "COBRO"
                  ? "Origen del cobro: cliente, ingreso, pasivo cancelado, etc. Podés partir el cobro en varias contrapartidas (ej: cliente paga factura + impuesto)."
                  : "Destino del pago: proveedor, gasto, activo adquirido, etc. Podés partir el pago en varias contrapartidas (ej: factura + IVA + sellos en una sola transferencia)."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr_1fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="descripcion">Descripción (opcional)</Label>
              <Textarea
                id="descripcion"
                placeholder="Detalle del movimiento"
                rows={2}
                {...register("descripcion")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="comprobante">Comprobante (opcional)</Label>
              <Input
                id="comprobante"
                placeholder="Factura A-00001234"
                {...register("comprobante")}
              />
              <p className="text-[11px] text-muted-foreground">
                Nº de cheque, factura o recibo.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="referenciaBanco">Referencia banco (opcional)</Label>
              <Input
                id="referenciaBanco"
                placeholder="Cód. Op. 12345678"
                {...register("referenciaBanco")}
              />
              <p className="text-[11px] text-muted-foreground">
                Código de operación / referencia interna del banco.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Vista previa del asiento</h2>
            <span className="text-xs text-muted-foreground">
              Partida doble · se generará en estado CONTABILIZADO
            </span>
          </div>
          {tipo === "PAGO" &&
            lineas?.length === 1 &&
            contrapartidaSeleccionada &&
            ("cuentaContableCodigo" in contrapartidaSeleccionada
              ? contrapartidaSeleccionada.cuentaContableCodigo
              : contrapartidaSeleccionada.codigo) === "5.8.1.06" && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
                <strong>Imp. Ley 25413 (IDCB)</strong> — el sistema dividirá
                automáticamente: 67% como gasto (5.8.1.06) y 33% como crédito
                pago a cuenta de Ganancias (1.1.4.12).
              </div>
            )}
          <AsientoPreview
            tipo={tipo}
            moneda={moneda}
            banco={bancoSeleccionado}
            lineas={(lineas ?? []).map((l) => ({
              cuenta:
                cuentasContrapartida.find(
                  (c) => c.id === l?.cuentaContableId,
                ) ?? null,
              monto: l?.monto ?? "0",
              descripcion: l?.descripcion ?? "",
            }))}
            totalCalculado={totalCalculado}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Registrar movimiento"}
        </Button>
      </div>
    </form>
  );
}

function TipoButton({
  selected,
  onClick,
  icon,
  label,
  sublabel,
  tone,
}: {
  selected: boolean;
  onClick: () => void;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  sublabel: string;
  tone: "positive" | "negative";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
        selected
          ? tone === "positive"
            ? "border-primary bg-primary/10"
            : "border-destructive bg-destructive/10"
          : "border-input bg-background hover:bg-accent",
      )}
    >
      <div
        className={cn(
          "flex size-9 items-center justify-center rounded-full",
          selected
            ? tone === "positive"
              ? "bg-primary text-primary-foreground"
              : "bg-destructive text-white"
            : "bg-muted text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      </div>
    </button>
  );
}

function AsientoPreview({
  tipo,
  moneda,
  banco,
  lineas,
  totalCalculado,
}: {
  tipo: "COBRO" | "PAGO";
  moneda: "ARS" | "USD";
  banco: CuentaBancariaOption | null;
  lineas: Array<{
    cuenta: CuentaContableContrapartidaOption | null;
    monto: string;
    descripcion: string;
  }>;
  totalCalculado: number;
}) {
  const valorFmt = totalCalculado > 0 ? totalCalculado.toFixed(2) : "—";

  // Caso especial: 1 sola línea + cuenta 5.8.1.06 + tipo PAGO.
  // El backend divide 33% a 1.1.4.12 (crédito Ganancias) + 67% a gasto.
  const unicaLineaCodigo =
    lineas.length === 1 && lineas[0]?.cuenta ? lineas[0].cuenta.codigo : null;
  const esImpuestoLey25413 =
    tipo === "PAGO" && unicaLineaCodigo === "5.8.1.06";

  let rows: Array<{
    role: string;
    cuenta: CuentaBancariaOption | CuentaContableContrapartidaOption | null;
    cuentaOverride?: { codigo: string; nombre: string };
    debe: string;
    haber: string;
  }>;

  if (
    esImpuestoLey25413 &&
    Number.isFinite(totalCalculado) &&
    totalCalculado > 0
  ) {
    const credito = Math.round(totalCalculado * 0.33 * 100) / 100;
    const gasto = Math.round((totalCalculado - credito) * 100) / 100;
    rows = [
      {
        role: "DEBE",
        cuenta: lineas[0]!.cuenta,
        debe: gasto.toFixed(2),
        haber: "—",
      },
      {
        role: "DEBE",
        cuenta: null,
        cuentaOverride: {
          codigo: "1.1.4.12",
          nombre: "CRÉDITO LEY 25413 PAGO A CUENTA GANANCIAS (33%)",
        },
        debe: credito.toFixed(2),
        haber: "—",
      },
      { role: "HABER", cuenta: banco, debe: "—", haber: valorFmt },
    ];
  } else if (tipo === "COBRO") {
    rows = [
      { role: "DEBE", cuenta: banco, debe: valorFmt, haber: "—" },
      ...lineas.map((l) => {
        const m = Number(l.monto);
        return {
          role: "HABER",
          cuenta: l.cuenta,
          debe: "—",
          haber: m > 0 ? m.toFixed(2) : "—",
        };
      }),
    ];
  } else {
    rows = [
      ...lineas.map((l) => {
        const m = Number(l.monto);
        return {
          role: "DEBE",
          cuenta: l.cuenta,
          debe: m > 0 ? m.toFixed(2) : "—",
          haber: "—",
        };
      }),
      { role: "HABER", cuenta: banco, debe: "—", haber: valorFmt },
    ];
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="w-16 py-2 pl-3 text-left font-medium">Posición</th>
            <th className="py-2 pl-3 text-left font-medium">Cuenta</th>
            <th className="py-2 pr-3 text-right font-medium">Debe</th>
            <th className="py-2 pr-3 text-right font-medium">Haber</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-2 pl-3 text-xs text-muted-foreground">
                {r.role}
              </td>
              <td className="py-2 pl-3">
                {r.cuentaOverride ? (
                  <span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.cuentaOverride.codigo}
                    </span>{" "}
                    <span>{r.cuentaOverride.nombre}</span>
                  </span>
                ) : r.cuenta ? (
                  <span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {renderCuentaCodigo(r.cuenta)}
                    </span>{" "}
                    <span>{renderCuentaNombre(r.cuenta)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.debe}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.haber}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/30 text-xs">
          <tr>
            <td colSpan={2} className="py-2 pl-3 text-muted-foreground">
              Moneda: {moneda}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {valorFmt}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {valorFmt}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function renderCuentaCodigo(
  c: CuentaBancariaOption | CuentaContableContrapartidaOption,
): string {
  return "cuentaContableCodigo" in c ? c.cuentaContableCodigo : c.codigo;
}

function renderCuentaNombre(
  c: CuentaBancariaOption | CuentaContableContrapartidaOption,
): string {
  return "cuentaContableNombre" in c ? c.cuentaContableNombre : c.nombre;
}

function PrestamoContextBanner({
  contexto,
  modo,
  onChangeModo,
}: {
  contexto: ContextoAmortizacion;
  modo: ModoAmortizacion;
  onChangeModo: (modo: ModoAmortizacion) => void;
}) {
  const tieneIntereses = !!contexto.cuentaIntereses;
  const saldoFmt = Number(contexto.saldoPendiente).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const explicacion =
    modo === "amortizacion"
      ? "Este movimiento reducirá el capital adeudado del préstamo."
      : "Este movimiento registra el gasto financiero; no afecta el capital adeudado.";
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <HugeiconsIcon
              icon={InformationCircleIcon}
              strokeWidth={2}
              className="size-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              Pagando préstamo de{" "}
              <span className="font-semibold">
                {contexto.prestamo.prestamista}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Saldo pendiente:{" "}
              <span className="font-mono font-medium text-foreground">
                ARS {saldoFmt}
              </span>
              {" · "}Principal:{" "}
              <span className="font-mono">
                {contexto.prestamo.principal} {contexto.prestamo.moneda}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{explicacion}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ModoButton
            selected={modo === "amortizacion"}
            onClick={() => onChangeModo("amortizacion")}
            label="Amortización de capital"
            sublabel={`${contexto.cuentaPrestamo.codigo} · ${contexto.cuentaPrestamo.nombre}`}
          />
          <ModoButton
            selected={modo === "intereses"}
            onClick={() => onChangeModo("intereses")}
            label="Pago de intereses"
            sublabel={
              contexto.cuentaIntereses
                ? `${contexto.cuentaIntereses.codigo} · ${contexto.cuentaIntereses.nombre}`
                : "Cuenta 5.8.2.02 no configurada"
            }
            disabled={!tieneIntereses}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ModoButton({
  selected,
  onClick,
  label,
  sublabel,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-input bg-background hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50 hover:bg-background",
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {sublabel}
      </span>
    </button>
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

function DatePicker({
  value,
  onChange,
}: {
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
          />
        }
      >
        <HugeiconsIcon
          icon={Calendar03Icon}
          strokeWidth={2}
          className="size-4 text-muted-foreground"
        />
        {value ? format(value, "dd/MM/yyyy") : "Seleccione fecha"}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
