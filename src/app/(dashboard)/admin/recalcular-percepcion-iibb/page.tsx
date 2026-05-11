import { Card } from "@/components/ui/card";

import { listarVentasParaRecalculo } from "@/lib/actions/admin-percepcion-iibb";

import { RecalculoPercepcionPanel } from "./recalculo-panel";

export const dynamic = "force-dynamic";

export default async function RecalculoPercepcionIIBBPage() {
  const ventas = await listarVentasParaRecalculo();

  const totalEmitidas = ventas.length;
  const conCheques = ventas.filter((v) => v.chequesActivos > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Recálculo de Percepción IIBB en vendas
        </h1>
        <p className="text-sm text-muted-foreground">
          Anula todas las vendas EMITIDAS y libera para recreación con autocálculo de Percepción
          IIBB. <strong>Operación destructiva</strong>: revierte asientos contables y anula cheques
          recibidos. Ejecutar solo una vez después del deploy de Percepción IIBB.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Vendas EMITIDAS
          </span>
          <span className="font-mono text-2xl font-semibold tabular-nums">{totalEmitidas}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Con cheques activos
          </span>
          <span className="font-mono text-2xl font-semibold tabular-nums">{conCheques}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Sin cheques</span>
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {totalEmitidas - conCheques}
          </span>
        </Card>
      </div>

      <Card className="py-0">
        <RecalculoPercepcionPanel ventas={ventas} />
      </Card>
    </div>
  );
}
