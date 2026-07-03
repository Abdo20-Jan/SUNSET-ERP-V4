"use client";

/**
 * Botón de exportación AUDITADA del Plan de Cuentas (CONT-02 · PR-028).
 * Espejo de `fin-cxc-export-button.tsx`: delega en la server action
 * `exportarPlanDeCuentas` (re-lee server-side la misma proyección y registra
 * el evento EXPORTACION antes de entregar). Sin máscara de permiso (la
 * superficie no tiene clave propia — semántica actual = sesión).
 */

import { useTransition } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportarPlanDeCuentas } from "@/lib/actions/plan-cuentas-export";

// Descarga un archivo base64 (CSV/XLSX) generado por la server action.
function descargarBase64(base64: string, mime: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CuentasExportButton() {
  const [pending, start] = useTransition();

  const run = (formato: "csv" | "xlsx") => {
    start(async () => {
      const res = await exportarPlanDeCuentas({ formato });
      if (res.ok) {
        descargarBase64(res.base64, res.mime, res.filename);
        toast.success("Plan de cuentas exportado.");
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={pending} />}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
        Exportar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run("csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("xlsx")}>Excel (XLSX)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
