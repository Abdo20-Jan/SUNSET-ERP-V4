"use client";

import { useRouter } from "next/navigation";

import { type LeadInput } from "@/lib/actions/leads";
import { LEAD_ESTADOS, LEAD_FUENTES } from "@/lib/crm-enums";
import { fdString, fdStringOrUndefined } from "@/lib/form-data";
import type {
  LeadEstado,
  LeadFuente,
} from "@/generated/prisma/client";

import { EnumSelect } from "./enum-select";
import { useLeadFormSubmit } from "./use-lead-form-submit";

type Props = {
  mode: "create" | "edit";
  leadId?: string;
  initial?: Partial<LeadInput>;
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

export function LeadForm({ mode, leadId, initial }: Props) {
  const router = useRouter();
  const { submit, pending, error } = useLeadFormSubmit(mode, leadId);

  function handleSubmit(formData: FormData) {
    submit(buildLeadInput(formData));
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nombre" name="nombre" defaultValue={initial?.nombre} required />
        <Field label="Empresa" name="empresa" defaultValue={initial?.empresa} />
        <Field label="CUIT" name="cuit" defaultValue={initial?.cuit} />
        <Field label="Email" name="email" type="email" defaultValue={initial?.email} />
        <Field label="Teléfono" name="telefono" defaultValue={initial?.telefono} />
        <EnumSelect
          label="Fuente"
          name="fuente"
          defaultValue={initial?.fuente ?? "ORGANICO"}
          options={LEAD_FUENTES}
        />
        <EnumSelect
          label="Estado"
          name="estado"
          defaultValue={initial?.estado ?? "NUEVO"}
          options={LEAD_ESTADOS}
        />
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>Notas</span>
        <textarea
          name="notas"
          defaultValue={initial?.notas ?? ""}
          rows={3}
          className="rounded-md border px-3 py-2"
        />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pickSubmitLabel(pending, mode)}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
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
