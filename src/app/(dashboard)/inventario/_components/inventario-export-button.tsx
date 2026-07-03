"use client";

/**
 * Botón de exportación AUDITADA de la worklist de inventario (INV-01 ·
 * PR-027). Espejo de `fin-cxc-export-button.tsx` (PR-026): toma los presets
 * (`vista`/`agrupar`/`dias`) de la URL y delega en la server action
 * `exportarInventarioWorklist`, que re-lee server-side con los MISMOS
 * presets, re-chequea `VER_COSTO_STOCK` (strip de la columna de costo) y
 * registra el evento EXPORTACION antes de entregar. La página no tiene gate
 * de acceso propio (cantidades visibles a toda sesión) → el botón queda
 * habilitado; el costo jamás depende del cliente.
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
import { exportarInventarioWorklist } from "@/lib/actions/inventario-export";

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

export function InventarioExportButton() {
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const run = (formato: "csv" | "xlsx") => {
    const params = Object.fromEntries(searchParams.entries());
    start(async () => {
      const res = await exportarInventarioWorklist({ params, formato });
      if (res.ok) {
        descargarBase64(res.base64, res.mime, res.filename);
        toast.success("Inventario exportado.");
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
