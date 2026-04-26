"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { importarExtractoAction } from "@/lib/actions/extractos-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CuentaBancariaOption = {
  id: string;
  banco: string;
  moneda: "ARS" | "USD";
  numero: string | null;
};

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("no se pudo leer el archivo"));
        return;
      }
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

export function ExtractoUploadForm({
  cuentas,
}: {
  cuentas: CuentaBancariaOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const today = new Date();
  const [cuentaId, setCuentaId] = useState<string>(cuentas[0]?.id ?? "");
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [file, setFile] = useState<File | null>(null);

  const yearOptions = [today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cuentaId) {
      toast.error("Seleccioná una cuenta bancaria.");
      return;
    }
    if (!file) {
      toast.error("Subí un PDF.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("El archivo debe ser un PDF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El PDF supera 10 MB. Comprimilo o dividilo por mes.");
      return;
    }

    startTransition(async () => {
      try {
        const pdfBase64 = await readFileAsBase64(file);
        const result = await importarExtractoAction({
          cuentaBancariaId: cuentaId,
          periodoYear: year,
          periodoMonth: month,
          archivoNombre: file.name,
          pdfBase64,
        });

        if (!result.ok) {
          toast.error(result.error);
          return;
        }

        toast.success(`Extracto parseado: ${result.totalLineas} líneas. Revisá las sugerencias.`);
        router.push(`/tesoreria/extractos/${result.importacionId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        toast.error(`No se pudo importar: ${msg}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="cuenta">Cuenta bancaria</Label>
          <Select
            value={cuentaId}
            onValueChange={(v) => setCuentaId(v ?? "")}
          >
            <SelectTrigger id="cuenta">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {cuentas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {`${c.banco} · ${c.moneda}${c.numero ? ` · ${c.numero}` : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="mes">Mes</Label>
            <Select
              value={String(month)}
              onValueChange={(v) => v && setMonth(Number(v))}
            >
              <SelectTrigger id="mes">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESES.map((nombre, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="anio">Año</Label>
            <Select
              value={String(year)}
              onValueChange={(v) => v && setYear(Number(v))}
            >
              <SelectTrigger id="anio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pdf">Archivo PDF</Label>
        <Input
          id="pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">
          Máx. 10 MB. Solo el PDF del extracto del mes seleccionado.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          disabled={isPending || !file || !cuentaId}
        >
          {isPending ? "Procesando con IA…" : "Importar y parsear"}
        </Button>
      </div>
    </form>
  );
}
