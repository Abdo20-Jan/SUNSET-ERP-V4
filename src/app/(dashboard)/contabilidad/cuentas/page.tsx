import { Card } from "@/components/ui/card";
import { getPlanDeCuentasConSaldo } from "@/lib/services/plan-cuentas-arbol";

import { CuentasExportButton } from "./cuentas-export-button";
import { CuentasTreeTable } from "./cuentas-tree-table";

/*
 * Plan de Cuentas (CONT-02 · PR-028): árbol canónico de 7 columnas con saldo
 * (proyección `getPlanDeCuentasConSaldo` — el armado del árbol se movió al
 * servicio VERBATIM; el saldo sale de `getBalanceSumasYSaldos`, reuso
 * read-only) + búsqueda/niveles + Libro Mayor embebido + export auditado.
 * READ-ONLY: sin CRUD de cuentas (el plan ULTRA es catálogo/seed).
 */

export const dynamic = "force-dynamic";

export default async function CuentasPage() {
  const { roots, flat } = await getPlanDeCuentasConSaldo();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Plan de Cuentas</h1>
          <p className="text-sm text-muted-foreground">
            {flat.length} cuentas contables · saldo acumulado en ARS (paridad con Balance de sumas y
            saldos)
          </p>
        </div>
        <CuentasExportButton />
      </div>
      <Card className="py-3">
        <CuentasTreeTable data={roots} />
      </Card>
    </div>
  );
}
