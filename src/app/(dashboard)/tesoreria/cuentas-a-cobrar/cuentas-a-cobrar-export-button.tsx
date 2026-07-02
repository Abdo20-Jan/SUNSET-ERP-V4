"use client";

/**
 * Botón de exportación AUDITADA de la worklist de cuentas a cobrar
 * (TES-03 · PR-025c). Espejo de `auditoria-export-button.tsx`/PR-020: toma
 * `filtro`/`moneda` de la URL y delega en la server action
 * `exportarCuentasACobrar` (que re-lee server-side con los MISMOS filtros,
 * re-chequea `VER_SALDO` y registra el evento EXPORTACION antes de entregar).
 * La máscara FE es sólo reflejo — la página entera ya llega gateada.
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
import { useHasPermission } from "@/components/auth/permissions-provider";
import { PERMISOS } from "@/lib/permisos-catalog";
import { exportarCuentasACobrar } from "@/lib/actions/cuentas-a-cobrar-export";

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

export function CuentasACobrarExportButton() {
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  // Máscara FE; el BE revalida `VER_SALDO` en la server action.
  const canExport = useHasPermission(PERMISOS.VER_SALDO);

  const run = (formato: "csv" | "xlsx") => {
    const params = Object.fromEntries(searchParams.entries());
    start(async () => {
      const res = await exportarCuentasACobrar({ params, formato });
      if (res.ok) {
        descargarBase64(res.base64, res.mime, res.filename);
        toast.success("Cuentas a cobrar exportadas.");
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={!canExport || pending} />}>
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
