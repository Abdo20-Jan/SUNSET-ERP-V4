"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  crearOportunidadAction,
  editarOportunidadAction,
  type OportunidadInput,
} from "@/lib/actions/oportunidades";
import { MONEDAS } from "@/lib/crm-enums";
import type { Moneda } from "@/generated/prisma/client";

type StageOption = { id: string; nombre: string };
type LeadOption = { id: string; nombre: string; empresa: string | null };
type ClienteOption = { id: string; nombre: string };

type Props = {
  mode: "create" | "edit";
  opId?: string;
  initial?: Partial<OportunidadInput>;
  stages: StageOption[];
  leads: LeadOption[];
  clientes: ClienteOption[];
};

export function OportunidadForm({
  mode,
  opId,
  initial,
  stages,
  leads,
  clientes,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const input: OportunidadInput = {
      titulo: String(formData.get("titulo") ?? ""),
      monto: String(formData.get("monto") ?? ""),
      moneda: (formData.get("moneda") as Moneda) ?? "USD",
      stageId: String(formData.get("stageId") ?? ""),
      probabilidad: Number(formData.get("probabilidad") ?? 50),
      cierreEstimado:
        String(formData.get("cierreEstimado") ?? "") || undefined,
      leadId: String(formData.get("leadId") ?? "") || undefined,
      clienteId: String(formData.get("clienteId") ?? "") || undefined,
      notas: String(formData.get("notas") ?? "") || undefined,
    };

    start(async () => {
      const result =
        mode === "create"
          ? await crearOportunidadAction(input)
          : await editarOportunidadAction(opId as string, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const id = mode === "create" ? result.data.id : opId;
      router.push(`/crm/oportunidades/${id}`);
      router.refresh();
    });
  }

  const cierreInicial =
    typeof initial?.cierreEstimado === "string"
      ? initial.cierreEstimado.slice(0, 10)
      : initial?.cierreEstimado instanceof Date
      ? initial.cierreEstimado.toISOString().slice(0, 10)
      : "";

  return (
    <form action={handleSubmit} className="space-y-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>Título <span className="text-red-700">*</span></span>
        <input
          name="titulo"
          defaultValue={initial?.titulo ?? ""}
          required
          className="rounded-md border px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Monto <span className="text-red-700">*</span></span>
          <input
            name="monto"
            defaultValue={String(initial?.monto ?? "")}
            placeholder="0.00"
            required
            className="rounded-md border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Moneda</span>
          <select
            name="moneda"
            defaultValue={initial?.moneda ?? "USD"}
            className="rounded-md border px-3 py-2"
          >
            {MONEDAS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Probabilidad %</span>
          <input
            type="number"
            name="probabilidad"
            min={0}
            max={100}
            defaultValue={String(initial?.probabilidad ?? 50)}
            className="rounded-md border px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Stage <span className="text-red-700">*</span></span>
          <select
            name="stageId"
            defaultValue={initial?.stageId ?? stages[0]?.id ?? ""}
            required
            className="rounded-md border px-3 py-2"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Cierre estimado</span>
          <input
            type="date"
            name="cierreEstimado"
            defaultValue={cierreInicial}
            className="rounded-md border px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Lead</span>
          <select
            name="leadId"
            defaultValue={initial?.leadId ?? ""}
            className="rounded-md border px-3 py-2"
          >
            <option value="">—</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.empresa ?? l.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Cliente</span>
          <select
            name="clienteId"
            defaultValue={initial?.clienteId ?? ""}
            className="rounded-md border px-3 py-2"
          >
            <option value="">—</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </label>
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
          {pending ? "Guardando..." : mode === "create" ? "Crear oportunidad" : "Guardar cambios"}
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
