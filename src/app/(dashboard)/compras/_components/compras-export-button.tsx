"use client";

/**
 * Botón de exportación AUDITADA de la worklist de compras. Espejo de
 * `fin-cxc-export-button.tsx` (PR-026): toma `page`/`perPage`/`moneda` de la
 * URL y delega en la server action `exportarCompras`, que re-lee server-side
 * la MISMA página visible (`listarCompras` con los mismos params) y registra
 * el evento EXPORTACION antes de entregar. Sin máscara de permiso: la página
 * de compras no está gateada (y crear permisos nuevos está fuera de alcance).
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
import { exportarCompras } from "@/lib/actions/compras-export";

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

export function ComprasExportButton() {
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const run = (formato: "csv" | "xlsx") => {
    const params = {
      page: searchParams.get("page") ?? undefined,
      perPage: searchParams.get("perPage") ?? undefined,
      moneda: searchParams.get("moneda") ?? undefined,
    };
    start(async () => {
      const res = await exportarCompras({ params, formato });
      if (res.ok) {
        descargarBase64(res.base64, res.mime, res.filename);
        toast.success("Compras exportadas.");
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
