"use client";

/**
 * Botón "Exportar día" del Cockpit Operacional Comex (CX-01 §9-funcional 9 ·
 * PR-022d). Lee los filtros activos (vista/proveedor/ETA/estado/moneda) de la URL
 * y delega en la server action `exportarCockpitDia` (que re-lee, serializa, gatea
 * el costo y audita). El menú surfacea el límite: exporta la vista/filtros de
 * SERVIDOR, no la búsqueda rápida en pantalla. La visibilidad del botón la decide
 * el server (`puedeExportar` en `page.tsx`); el gate real vive en la acción.
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
import { exportarCockpitDia } from "@/lib/actions/comex-cockpit-export";

function descargarBase64(base64: string, mime: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CockpitExportDia() {
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const run = (formato: "csv" | "xlsx") => {
    const params = {
      vista: searchParams.get("vista") ?? undefined,
      proveedor: searchParams.get("proveedor") ?? undefined,
      eta_desde: searchParams.get("eta_desde") ?? undefined,
      eta_hasta: searchParams.get("eta_hasta") ?? undefined,
      estado: searchParams.get("estado") ?? undefined,
      moneda: searchParams.get("moneda") ?? undefined,
    };
    start(async () => {
      try {
        const res = await exportarCockpitDia({ params, formato });
        if (res.ok) {
          descargarBase64(res.base64, res.mime, res.filename);
          toast.success("Briefing del día exportado.");
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("No se pudo exportar el briefing.");
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
        Exportar día
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="max-w-60 px-3 py-2 text-[11px] text-muted-foreground">
          Exporta el briefing (indicadores, pendencias, agenda del día y alertas) según la vista y
          filtros del servidor; la búsqueda rápida en pantalla no se aplica.
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("xlsx")}>Excel (XLSX)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
