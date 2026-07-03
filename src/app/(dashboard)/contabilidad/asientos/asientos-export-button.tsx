"use client";

/**
 * Botón de exportación AUDITADA de la worklist de asientos (CONT-01 · PR-028).
 * Espejo de `fin-cxc-export-button.tsx`: toma los presets de la URL y delega
 * en la server action `exportarAsientos` (que re-lee server-side con los
 * MISMOS filtros y registra el evento EXPORTACION antes de entregar). La
 * superficie no tiene clave de permiso propia (semántica actual = sesión) —
 * sin máscara FE; sólo `pending`.
 */

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
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
import { exportarAsientos } from "@/lib/actions/asientos-export";

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

export function AsientosExportButton() {
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const run = (formato: "csv" | "xlsx") => {
    const params = Object.fromEntries(searchParams.entries());
    start(async () => {
      const res = await exportarAsientos({ params, formato });
      if (res.ok) {
        descargarBase64(res.base64, res.mime, res.filename);
        toast.success("Asientos exportados.");
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
