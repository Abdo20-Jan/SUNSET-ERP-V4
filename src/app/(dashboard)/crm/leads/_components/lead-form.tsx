"use client";

import { useRouter } from "next/navigation";

import { type LeadInput } from "@/lib/actions/leads";
import { LEAD_ESTADOS, LEAD_FUENTES } from "@/lib/crm-enums";
import { fdString, fdStringOrUndefined } from "@/lib/form-data";
import type { LeadEstado, LeadFuente } from "@/generated/prisma/client";

import { EnumSelect } from "./enum-select";
import { useLeadFormSubmit } from "./use-lead-form-submit";

type Props = {
  mode: "create" | "edit";
  leadId?: string;
  initial?: Partial<LeadInput>;
  /** PR-030: hospedado en FloatingWorkWindow → sólo ajusta container/footer. */
  embedded?: boolean;
  /** PR-030: el host cancela (cierra la ventana) en vez de router.back(). */
  onCancel?: () => void;
  /** PR-030: el host cierra + refresca en vez de router.push al detalle. */
  onSuccess?: (id: string) => void;
  /** PR-030: burbujea el dirty para el gate de descarte de la ventana. */
  onDirtyChange?: (dirty: boolean) => void;
};

function buildLeadInput(formData: FormData): LeadInput {
  return {
    nombre: fdString(formData, "nombre"),
    empresa: fdStringOrUndefined(formData, "empresa"),
    cuit: fdStringOrUndefined(formData, "cuit"),
    email: fdStringOrUndefined(formData, "email"),
    telefono: fdStringOrUndefined(formData, "telefono"),
    fuente: (fdString(formData, "fuente") as LeadFuente) || "ORGANICO",
    estado: (fdString(formData, "estado") as LeadEstado) || "NUEVO",
    notas: fdStringOrUndefined(formData, "notas"),
  };
}

function pickSubmitLabel(pending: boolean, mode: "create" | "edit"): string {
  if (pending) return "Guardando...";
  return mode === "create" ? "Crear lead" : "Guardar cambios";
}

// Layout embedded (FloatingWorkWindow) vs full-page — helpers nombrados
// (gate Lizard CCN≤8).
function formClassName(embedded: boolean): string {
  if (embedded) return "flex h-full flex-col gap-4 overflow-y-auto p-1";
  return "space-y-4";
}

function footerClassName(embedded: boolean): string {
  if (embedded) return "mt-auto flex justify-end gap-3 border-t pt-3";
  return "flex gap-3";
}

export function LeadForm({
  mode,
  leadId,
  initial,
  embedded = false,
  onCancel,
  onSuccess,
  onDirtyChange,
}: Props) {
  const router = useRouter();
  const { submit, pending, error } = useLeadFormSubmit(mode, leadId, onSuccess);
  // Normalizado una vez (CCN baja): mismos defaults que los `initial?.x` previos.
  const init: Partial<LeadInput> = initial ?? {};

  function handleSubmit(formData: FormData) {
    submit(buildLeadInput(formData));
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
      return;
    }
    router.back();
  }

  return (
    <form
      action={handleSubmit}
      onChange={() => onDirtyChange?.(true)}
      className={formClassName(embedded)}
    >
      <LeadFields init={init} />

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className={footerClassName(embedded)}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pickSubmitLabel(pending, mode)}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// Campos del lead SIN cambios (mismos name/defaultValue que antes del
// PR-030) — sólo extraídos a componente nombrado (gate Lizard CCN≤8).
function LeadFields({ init }: { init: Partial<LeadInput> }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nombre" name="nombre" defaultValue={init.nombre} required />
        <Field label="Empresa" name="empresa" defaultValue={init.empresa} />
        <Field label="CUIT" name="cuit" defaultValue={init.cuit} />
        <Field label="Email" name="email" type="email" defaultValue={init.email} />
        <Field label="Teléfono" name="telefono" defaultValue={init.telefono} />
        <EnumSelect
          label="Fuente"
          name="fuente"
          defaultValue={init.fuente ?? "ORGANICO"}
          options={LEAD_FUENTES}
        />
        <EnumSelect
          label="Estado"
          name="estado"
          defaultValue={init.estado ?? "NUEVO"}
          options={LEAD_ESTADOS}
        />
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>Notas</span>
        <textarea
          name="notas"
          defaultValue={init.notas ?? ""}
          rows={3}
          className="rounded-md border px-3 py-2"
        />
      </label>
    </>
  );
}

type FieldProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
};

function Field({ label, name, defaultValue, type, required }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>
        {label}
        {required ? <span className="text-red-700"> *</span> : null}
      </span>
      <input
        type={type ?? "text"}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="rounded-md border px-3 py-2"
      />
    </label>
  );
}
