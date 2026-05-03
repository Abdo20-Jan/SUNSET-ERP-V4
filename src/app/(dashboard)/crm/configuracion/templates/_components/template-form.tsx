"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  crearTemplateAction,
  editarTemplateAction,
  eliminarTemplateAction,
  type TemplateInput,
} from "@/lib/actions/templates";

type Props = {
  mode: "create" | "edit";
  templateId?: string;
  initial?: Partial<TemplateInput>;
};

export function TemplateForm({ mode, templateId, initial }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const input: TemplateInput = {
      nombre: String(formData.get("nombre") ?? ""),
      asunto: String(formData.get("asunto") ?? ""),
      cuerpo: String(formData.get("cuerpo") ?? ""),
      activo: formData.get("activo") === "on",
    };

    start(async () => {
      const r =
        mode === "create"
          ? await crearTemplateAction(input)
          : await editarTemplateAction(templateId as string, input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/crm/configuracion/templates");
      router.refresh();
    });
  }

  function handleEliminar() {
    if (!templateId) return;
    if (!confirm("¿Eliminar este template?")) return;
    setError(null);
    start(async () => {
      const r = await eliminarTemplateAction(templateId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/crm/configuracion/templates");
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>Nombre <span className="text-red-700">*</span></span>
        <input
          name="nombre"
          defaultValue={initial?.nombre ?? ""}
          required
          className="rounded-md border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Asunto <span className="text-red-700">*</span></span>
        <input
          name="asunto"
          defaultValue={initial?.asunto ?? ""}
          required
          className="rounded-md border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Cuerpo <span className="text-red-700">*</span></span>
        <textarea
          name="cuerpo"
          defaultValue={initial?.cuerpo ?? ""}
          rows={8}
          required
          className="rounded-md border px-3 py-2 font-mono text-xs"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={initial?.activo ?? true}
        />
        Activo
      </label>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Guardando..." : mode === "create" ? "Crear template" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          Cancelar
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleEliminar}
            disabled={pending}
            className="ml-auto rounded-md border border-red-300 px-4 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Eliminar
          </button>
        )}
      </div>
    </form>
  );
}
