"use client";

/**
 * Botón de exportación auditada (CSV/XLSX) de la worklist Comex (PR-020). Lee la
 * vista+moneda de la URL y delega en la server action `exportarEmbarques` (que
 * re-lee, serializa, gatea el costo y audita). El menú surfacea la leyenda del
 * límite: exporta la vista/filtros de SERVIDOR, no la búsqueda rápida en pantalla.
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportarEmbarques } from "@/lib/actions/embarques-export";

function descargarBase64(base64: string, mime: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function EmbarquesExportButton() {
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const run = (formato: "csv" | "xlsx") => {
    const params = {
      vista: searchParams.get("vista") ?? undefined,
      moneda: searchParams.get("moneda") ?? undefined,
    };
    start(async () => {
      try {
        const res = await exportarEmbarques({ params, formato });
        if (res.ok) {
          descargarBase64(res.base64, res.mime, res.filename);
          toast.success("Procesos exportados.");
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("No se pudo exportar.");
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
        <div className="max-w-60 px-3 py-2 text-[11px] text-muted-foreground">
          Exporta según la vista y filtros del servidor; la búsqueda rápida en pantalla no se
          aplica.
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("xlsx")}>Excel (XLSX)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
