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
  const [cuentaId, setCuentaId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
          cuentaBancariaId: cuentaId || null,
          archivoNombre: file.name,
          pdfBase64,
        });

        if (!result.ok) {
          toast.error(result.error);
          return;
        }

        toast.success(
          `Detectado: ${result.bancoDetectado} · ${result.periodoDetectado} · ${result.totalLineas} líneas. Revisá las sugerencias.`,
        );
        router.push(`/tesoreria/extractos/${result.importacionId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        toast.error(`No se pudo importar: ${msg}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="pdf">Archivo PDF del extracto</Label>
        <Input
          id="pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">
          Máx. 10 MB. El sistema detecta el banco, número de cuenta y período
          automáticamente desde el PDF.
        </p>
      </div>

      <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Sobreescribir cuenta bancaria (opcional)
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Solo necesario si el PDF no se autodetecta o si tenés varias
            cuentas en el mismo banco que coinciden.
          </p>
          <Select
            value={cuentaId}
            onValueChange={(v) => setCuentaId(v ?? "")}
          >
            <SelectTrigger id="cuenta">
              <SelectValue placeholder="Auto-detectar del PDF">
                {(value) => {
                  if (!value) return "Auto-detectar del PDF";
                  const c = cuentas.find((c) => c.id === value);
                  return c
                    ? `${c.banco} · ${c.moneda}${c.numero ? ` · ${c.numero}` : ""}`
                    : "Auto-detectar del PDF";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {cuentas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {`${c.banco} · ${c.moneda}${c.numero ? ` · ${c.numero}` : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cuentaId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => setCuentaId("")}
            >
              Volver a auto-detección
            </Button>
          ) : null}
        </div>
      </details>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isPending || !file}>
          {isPending ? "Procesando con IA…" : "Importar y parsear"}
        </Button>
      </div>
    </form>
  );
}
