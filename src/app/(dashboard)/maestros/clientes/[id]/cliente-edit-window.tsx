"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import { CondicionIva, TipoCanal } from "@/generated/prisma/client";
import {
  actualizarClienteAction,
  type ClienteInput,
  type ClienteRow,
  type CuentaContableOption,
} from "@/lib/actions/clientes";
import type { ProvinciaRow } from "@/lib/actions/provincias";
import { Button } from "@/components/ui/button";
import { CuentaCombobox } from "@/components/cuenta-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/form/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { DirtyFooter } from "@/components/record/dirty-footer";
import { useDirtyState } from "@/components/record/use-dirty-state";

/*
 * ClienteEditWindow (PR-005 — piloto) — ilha client que abre la edición del
 * cliente en una FloatingWorkWindow (en vez de drawer/dialog), con DirtyFooter y
 * confirmación de descarte. Reusa la server action `actualizarClienteAction` YA
 * EXISTENTE (intocada) — que revalida el payload completo server-side con su
 * schema canónico — y refleja los campos del diálogo de la lista. El schema de
 * este form es solo UX (errores inline); no toca cálculo/contabilidad/auth.
 */
const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  RI: "Responsable Inscripto",
  MONOTRIBUTO: "Monotributista",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  EXTERIOR: "Exterior (exportación)",
};

const CONDICION_IVA_VALUES = Object.keys(CONDICION_IVA_LABEL) as CondicionIva[];

const TIPO_CANAL_LABEL: Record<TipoCanal, string> = {
  MAYORISTA: "Mayorista / Distribuidor",
  MINORISTA: "Minorista / Punto de Venta",
  REVENDEDOR_GOMERIA: "Revendedor / Gomería",
  TRANSPORTISTA: "Transportista / Flota",
  GRANDE_CUENTA: "Gran Cuenta / Concesionaria",
  EXTERIOR: "Exterior (exportación)",
  CONSUMIDOR_FINAL: "Consumidor Final ocasional",
};

const TIPO_CANAL_VALUES = Object.keys(TIPO_CANAL_LABEL) as TipoCanal[];

const formSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  cuit: z.string().trim().optional().or(z.literal("")),
  tipoCanal: z.enum(TIPO_CANAL_VALUES as [TipoCanal, ...TipoCanal[]]),
  condicionIva: z.enum(CONDICION_IVA_VALUES as [CondicionIva, ...CondicionIva[]]),
  agenteRetencionIva: z.boolean(),
  agenteRetencionGanancias: z.boolean(),
  agenteIibb: z.boolean(),
  // `tipo` no se edita en este form: viaja como passthrough para no resetearlo.
  tipo: z.string().trim().optional().or(z.literal("")),
  direccion: z.string().trim().optional().or(z.literal("")),
  telefono: z.string().trim().optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email inválido."),
  estado: z.enum(["activo", "inactivo"]),
  cuentaContableId: z.number().int().positive().nullable(),
  provinciaId: z.number().int().positive().nullable(),
  alicuotaPercepcionIIBB: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^\d+(\.\d{1,4})?$/.test(v), "Alícuota inválida (formato 0.0000-99.9999).")
    .refine((v) => !v || (Number(v) >= 0 && Number(v) <= 100), "Alícuota fuera de rango [0, 100]."),
  exentoPercepcionIIBB: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

// Helpers de normalização: mantêm baixa a complexidade ciclomática (Codacy ≤ 8)
// concentrando a coalescência/normalização dos campos opcionais aqui, não nos callers.
const orEmpty = (v: string | null | undefined): string => v ?? "";
const blankToUndef = (v: string | undefined): string | undefined =>
  v && v.length > 0 ? v : undefined;

function defaultsFromCliente(c: ClienteRow): FormValues {
  return {
    nombre: c.nombre,
    cuit: orEmpty(c.cuit),
    tipoCanal: c.tipoCanal,
    condicionIva: c.condicionIva,
    agenteRetencionIva: c.agenteRetencionIva,
    agenteRetencionGanancias: c.agenteRetencionGanancias,
    agenteIibb: c.agenteIibb,
    tipo: c.tipo,
    direccion: orEmpty(c.direccion),
    telefono: orEmpty(c.telefono),
    email: orEmpty(c.email),
    estado: c.estado === "inactivo" ? "inactivo" : "activo",
    cuentaContableId: c.cuentaContableId,
    provinciaId: c.provinciaId,
    alicuotaPercepcionIIBB: orEmpty(c.alicuotaPercepcionIIBB),
    exentoPercepcionIIBB: c.exentoPercepcionIIBB,
  };
}

// Monta o payload da action a partir dos valores do form (campos vazios → undefined).
// Extraído do onSubmit para manter o handler com baixa complexidade ciclomática.
function buildClientePayload(values: FormValues): ClienteInput {
  return {
    nombre: values.nombre,
    cuit: blankToUndef(values.cuit),
    tipoCanal: values.tipoCanal,
    condicionIva: values.condicionIva,
    agenteRetencionIva: values.agenteRetencionIva,
    agenteRetencionGanancias: values.agenteRetencionGanancias,
    agenteIibb: values.agenteIibb,
    tipo: blankToUndef(values.tipo),
    direccion: blankToUndef(values.direccion),
    telefono: blankToUndef(values.telefono),
    email: blankToUndef(values.email),
    estado: values.estado,
    cuentaContableId: values.cuentaContableId ?? null,
    provinciaId: values.provinciaId ?? null,
    alicuotaPercepcionIIBB: blankToUndef(values.alicuotaPercepcionIIBB),
    exentoPercepcionIIBB: values.exentoPercepcionIIBB,
    crearCuentaAuto: false,
  };
}

export function ClienteEditWindow({
  cliente,
  cuentas,
  provincias,
}: {
  cliente: ClienteRow;
  cuentas: CuentaContableOption[];
  provincias: ProvinciaRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: defaultsFromCliente(cliente),
  });
  const { isDirtyRef } = useDirtyState(isDirty);

  // Resetea a los valores actuales del registro en cada apertura.
  useEffect(() => {
    if (open) reset(defaultsFromCliente(cliente));
  }, [open, cliente, reset]);

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await actualizarClienteAction(cliente.id, buildClientePayload(values));

      if (result.ok) {
        toast.success("Cliente actualizado.");
        reset(values);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  const requestDiscardConfirm = () =>
    new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmOpen(true);
    });

  const resolveConfirm = (ok: boolean) => {
    setConfirmOpen(false);
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolver?.(ok);
  };

  const handleCancel = async () => {
    if (!isDirtyRef.current) {
      setOpen(false);
      return;
    }
    if (await requestDiscardConfirm()) setOpen(false);
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
        Editar
      </Button>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title={`Editar cliente · ${cliente.nombre}`}
        description="Modifique los datos del cliente y guarde los cambios."
        initialWidth={640}
        initialHeight={600}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
        footer={
          <DirtyFooter
            isDirty={isDirty}
            isSaving={isSaving}
            onSave={() => void onSubmit()}
            onCancel={() => void handleCancel()}
            saveLabel="Guardar cambios"
            tabHref={`/maestros/clientes/${cliente.id}`}
            tabLabel={cliente.nombre}
          />
        }
      >
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="nombre">Nombre *</Label>
            <Input id="nombre" aria-invalid={!!errors.nombre} {...register("nombre")} />
            {errors.nombre && <FieldError message={errors.nombre.message} />}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cuit">CUIT</Label>
            <Input
              id="cuit"
              placeholder="XX-XXXXXXXX-X"
              aria-invalid={!!errors.cuit}
              {...register("cuit")}
            />
            {errors.cuit && <FieldError message={errors.cuit.message} />}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Estado</Label>
            <Controller
              control={control}
              name="estado"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="inactivo">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Tipo de canal *</Label>
            <Controller
              control={control}
              name="tipoCanal"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPO_CANAL_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {TIPO_CANAL_LABEL[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Condición IVA *</Label>
            <Controller
              control={control}
              name="condicionIva"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDICION_IVA_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {CONDICION_IVA_LABEL[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input id="telefono" {...register("telefono")} />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" aria-invalid={!!errors.email} {...register("email")} />
            {errors.email && <FieldError message={errors.email.message} />}
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" {...register("direccion")} />
          </div>

          <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:col-span-2">
            <Label>Agente de retención (si aplica)</Label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("agenteRetencionIva")} />
              <span>
                Agente de retención <strong>IVA</strong> (10,5% típico)
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("agenteRetencionGanancias")} />
              <span>
                Agente de retención <strong>Ganancias</strong> (RG 830, 2-6%)
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("agenteIibb")} />
              <span>
                Agente de recaudación <strong>IIBB</strong>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2">
            <Label className="text-sm">Localización fiscal AR</Label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="provincia" className="text-xs text-muted-foreground">
                Provincia (driver de Percepción IIBB)
              </Label>
              <Controller
                control={control}
                name="provinciaId"
                render={({ field }) => (
                  <Select
                    value={field.value === null ? "" : String(field.value)}
                    onValueChange={(v) => field.onChange(v === "" ? null : Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="— Sin provincia —">
                        {(value) => {
                          if (value === null || value === undefined || value === "") {
                            return "— Sin provincia —";
                          }
                          const idNum =
                            typeof value === "string" ? Number(value) : (value as number);
                          const p = provincias.find((x) => x.id === idNum);
                          return p ? `${p.nombre} (${p.codigo})` : "— Sin provincia —";
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {provincias.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nombre} ({p.codigo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="alicuota-percepcion-iibb" className="text-xs text-muted-foreground">
                  Alícuota Percepción IIBB (override del padrón)
                </Label>
                <Input
                  id="alicuota-percepcion-iibb"
                  inputMode="decimal"
                  placeholder="(usa default jurisdicción)"
                  aria-invalid={!!errors.alicuotaPercepcionIIBB}
                  {...register("alicuotaPercepcionIIBB")}
                />
                {errors.alicuotaPercepcionIIBB && (
                  <FieldError message={errors.alicuotaPercepcionIIBB.message} />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="exento-percepcion-iibb" className="text-xs text-muted-foreground">
                  Exento de Percepción IIBB
                </Label>
                <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                  <input
                    id="exento-percepcion-iibb"
                    type="checkbox"
                    {...register("exentoPercepcionIIBB")}
                  />
                  <span>Cliente exento (no percepcionar)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2">
            <Label className="text-sm">Cuenta contable</Label>
            <Controller
              control={control}
              name="cuentaContableId"
              render={({ field }) => (
                <CuentaCombobox
                  value={field.value}
                  onChange={field.onChange}
                  cuentas={cuentas}
                  placeholder="Sin vincular — seleccione cuenta 1.1.3.xx"
                  emptyMessage="No hay cuentas disponibles."
                />
              )}
            />
            <p className="text-xs text-muted-foreground">
              Solo cuentas analíticas bajo{" "}
              <span className="font-mono">1.1.3 CRÉDITOS POR VENTAS</span>.
            </p>
          </div>
        </form>
      </FloatingWorkWindow>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) resolveConfirm(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar cambios</DialogTitle>
            <DialogDescription>
              Hay cambios sin guardar en el cliente. ¿Desea descartarlos?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resolveConfirm(false)}>
              Seguir editando
            </Button>
            <Button type="button" variant="destructive" onClick={() => resolveConfirm(true)}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
