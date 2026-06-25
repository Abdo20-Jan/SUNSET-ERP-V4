import { Card } from "@/components/ui/card";
import { PERMISOS, requirePermissionPage } from "@/lib/permisos";
import { parseFiltros } from "@/lib/services/auditoria-filtros";
import {
  CAP_WORKLIST,
  listarAuditoria,
  listarUsuariosParaFiltro,
} from "@/lib/services/auditoria-query";

import { AuditoriaPageGate } from "./auditoria-page-gate";
import { AuditoriaWorklist } from "./auditoria-worklist";

type SearchParams = Promise<{
  vista?: string;
  desde?: string;
  hasta?: string;
  usuario?: string;
  tabla?: string;
  accion?: string;
  origen?: string;
  motivo?: string;
}>;

export const dynamic = "force-dynamic";

// AUD-01 — worklist GLOBAL de auditoría (Sistema > Auditoría). Server component:
// gateado en el BACKEND por `auditoria.ver`, parsea los filtros de la URL y
// consulta AuditLog (sólo-lectura). El filtrado real es server-driven; el grid
// resuelve display/quick-search/sort/expansión/paginación en el cliente.
export default async function AuditoriaPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermissionPage(PERMISOS.AUDITORIA_VER);

  const params = await searchParams;
  const filtros = parseFiltros(params);
  const [rows, usuarios] = await Promise.all([
    listarAuditoria(filtros),
    listarUsuariosParaFiltro(),
  ]);

  const topeAlcanzado = rows.length >= CAP_WORKLIST;

  return (
    <AuditoriaPageGate>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Auditoría</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} evento{rows.length === 1 ? "" : "s"} (más recientes primero
            {topeAlcanzado ? `, tope ${CAP_WORKLIST} — refiná los filtros` : ""}). Exportá para el
            detalle completo.
          </p>
        </div>

        <Card className="py-0">
          <AuditoriaWorklist rows={rows} usuarios={usuarios} />
        </Card>
      </div>
    </AuditoriaPageGate>
  );
}
