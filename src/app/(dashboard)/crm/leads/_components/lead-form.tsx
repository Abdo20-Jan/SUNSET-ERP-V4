"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  crearLeadAction,
  editarLeadAction,
  type LeadInput,
} from "@/lib/actions/leads";
import { LEAD_ESTADOS, LEAD_FUENTES } from "@/lib/crm-enums";
import { fdString, fdStringOrUndefined } from "@/lib/form-data";
import type {
  LeadEstado,
  LeadFuente,
} from "@/generated/prisma/client";

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

export function LeadForm({ mode, leadId, initial }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const input = buildLeadInput(formData);

    start(async () => {
      const result =
        mode === "create"
          ? await crearLeadAction(input)
          : await editarLeadAction(leadId as string, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const targetId = mode === "create" ? result.data.id : leadId;
      router.push(`/crm/leads/${targetId}`);
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nombre" name="nombre" defaultValue={initial?.nombre} required />
        <Field label="Empresa" name="empresa" defaultValue={initial?.empresa} />
        <Field label="CUIT" name="cuit" defaultValue={initial?.cuit} />
        <Field label="Email" name="email" type="email" defaultValue={initial?.email} />
        <Field label="Teléfono" name="telefono" defaultValue={initial?.telefono} />
        <Select label="Fuente" name="fuente" defaultValue={initial?.fuente ?? "ORGANICO"}>
          {LEAD_FUENTES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
        <Select label="Estado" name="estado" defaultValue={initial?.estado ?? "NUEVO"}>
          {LEAD_ESTADOS.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </Select>
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

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Guardando..." : mode === "create" ? "Crear lead" : "Guardar cambios"}
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

function Select({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border px-3 py-2"
      >
        {children}
      </select>
    </label>
  );
}
