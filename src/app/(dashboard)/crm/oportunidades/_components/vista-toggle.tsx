import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

import type { OportunidadesVista } from "./oportunidades-presentacion";

/*
 * VistaToggle (CRM-01 · PR-030) — presentacional y server-safe: dos Links
 * («Lista» / «Tablero») que conmutan el preset `?vista=` de la worklist
 * unificada de oportunidades. Los hrefs los arma la page con
 * `buildOportunidadesHref` (preservando moneda y filtros donde corresponda).
 */

function claseVista(activa: boolean): string {
  if (activa) return buttonVariants({ variant: "default", size: "sm" });
  return buttonVariants({ variant: "outline", size: "sm" });
}

export function VistaToggle({
  vista,
  hrefLista,
  hrefTablero,
}: {
  vista: OportunidadesVista;
  hrefLista: string;
  hrefTablero: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Link href={hrefLista} className={claseVista(vista === "lista")}>
        Lista
      </Link>
      <Link href={hrefTablero} className={claseVista(vista === "tablero")}>
        Tablero
      </Link>
    </div>
  );
}
