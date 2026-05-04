"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";

import {
  importarLeadsCsvAction,
  type ImportLeadResult,
  type ImportarLeadsCsvOpts,
} from "@/lib/actions/import-leads";

type DedupBy = "cuit" | "email" | "ninguno";

type FormState = {
  fileName: string | null;
  csvText: string;
  dryRun: boolean;
  dedupBy: DedupBy;
};

const INITIAL_STATE: FormState = {
  fileName: null,
  csvText: "",
  dryRun: false,
  dedupBy: "ninguno",
};

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Error leyendo archivo."));
    reader.readAsText(file, "utf-8");
  });
}

export function ImportForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportLeadResult | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setState((s) => ({ ...s, fileName: null, csvText: "" }));
      return;
    }
    try {
      const text = await readFileAsText(file);
      setState((s) => ({ ...s, fileName: file.name, csvText: text }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error leyendo archivo.");
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!state.csvText) {
      setError("Subí un archivo CSV primero.");
      return;
    }
    const opts: ImportarLeadsCsvOpts = {
      dryRun: state.dryRun,
      dedupBy: state.dedupBy,
    };
    start(async () => {
      const res = await importarLeadsCsvAction(state.csvText, opts);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data);
      if (!state.dryRun && res.data.insertados > 0) {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <label className="flex flex-col gap-1 text-sm">
        <span>Archivo CSV</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="rounded-md border px-3 py-2"
          required
        />
        {state.fileName ? (
          <span className="text-xs text-muted-foreground">{state.fileName}</span>
        ) : null}
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Deduplicar por</span>
          <select
            value={state.dedupBy}
            onChange={(e) => setState((s) => ({ ...s, dedupBy: e.target.value as DedupBy }))}
            className="rounded-md border px-3 py-2"
          >
            <option value="ninguno">Ninguno (insertar todo)</option>
            <option value="cuit">CUIT (omitir si ya existe)</option>
            <option value="email">Email (omitir si ya existe)</option>
          </select>
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={state.dryRun}
            onChange={(e) => setState((s) => ({ ...s, dryRun: e.target.checked }))}
          />
          <span>Modo simulación (sin escribir en DB)</span>
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending || !state.csvText}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Procesando..." : state.dryRun ? "Simular" : "Importar"}
        </button>
      </div>

      {result ? <ImportResultView result={result} dryRun={state.dryRun} /> : null}
    </form>
  );
}

function ImportResultView({ result, dryRun }: { result: ImportLeadResult; dryRun: boolean }) {
  return (
    <section className="space-y-3 rounded-md border bg-muted/30 p-4">
      <header>
        <h2 className="text-lg font-semibold">
          {dryRun ? "Resultado simulación" : "Resultado importación"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Total filas: {result.total} · Insertados: {result.insertados} · Ignorados:{" "}
          {result.ignorados} · Errores: {result.errores.length}
        </p>
      </header>

      {result.errores.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left">Línea</th>
                <th className="px-3 py-2 text-left">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {result.errores.map((e, idx) => (
                <tr key={`${e.linha}-${idx}`} className="border-t">
                  <td className="px-3 py-2 font-mono">{e.linha}</td>
                  <td className="px-3 py-2">{e.mensaje}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
