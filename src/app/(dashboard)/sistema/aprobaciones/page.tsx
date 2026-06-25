import { Card } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { isApprovalsEnabled } from "@/lib/features";
import { PERMISOS, requirePermissionPage } from "@/lib/permisos";
import { parseFiltros } from "@/lib/services/aprobaciones-filtros";
import {
  listarAprobaciones,
  listarSolicitantesParaFiltro,
} from "@/lib/services/aprobaciones-query";

import { AprobacionesPageGate } from "./aprobaciones-page-gate";
import { AprobacionesWorklist } from "./aprobaciones-worklist";

type SearchParams = Promise<{
  vista?: string;
  tipo?: string;
  estado?: string;
  solicitante?: string;
  sla?: string;
}>;

export const dynamic = "force-dynamic";

// AUTO-01 — Central de Aprobaciones (Sistema > Aprobaciones). Server component:
// gateado en el BACKEND por `aprobaciones.ver`, parsea los filtros de la URL y
// consulta el motor PR-012 (sólo-lectura). INERTE: con APPROVALS_ENABLED off no
// hay solicitudes → worklist vacía, cero cambio de comportamiento.
export default async function AprobacionesPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermissionPage(PERMISOS.APROBACIONES_VER);

  const params = await searchParams;
  const filtros = parseFiltros(params);
  const [rows, solicitantes, session] = await Promise.all([
    listarAprobaciones(filtros),
    listarSolicitantesParaFiltro(),
    auth(),
  ]);
  const esAdmin = session?.user?.role === Role.ADMIN;

  return (
    <AprobacionesPageGate>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Aprobaciones</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} solicitud{rows.length === 1 ? "" : "es"} (más urgentes primero, por SLA).
            {isApprovalsEnabled() ? "" : " El motor de aprobaciones está deshabilitado."}
          </p>
        </div>

        <Card className="py-0">
          <AprobacionesWorklist
            rows={rows}
            solicitantes={solicitantes}
            approvalsEnabled={isApprovalsEnabled()}
            esAdmin={esAdmin}
          />
        </Card>
      </div>
    </AprobacionesPageGate>
  );
}
