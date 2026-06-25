import { getMatrizPerfiles } from "@/lib/actions/permisos-admin";
import { PERMISOS, requirePermissionPage } from "@/lib/permisos";

import { AdminPageGate } from "../admin-page-gate";
import { PermisosMatriz } from "./permisos-matriz";

export const dynamic = "force-dynamic";

export default async function PermisosPage() {
  await requirePermissionPage(PERMISOS.ADMIN_ACCESO);

  const data = await getMatrizPerfiles();

  return (
    <AdminPageGate>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Matriz de permisos</h1>
          <p className="text-sm text-muted-foreground">
            Perfiles × recursos · {data.perfiles.length} perfiles · {data.permisos.length} claves.
            Editá los grants por perfil en ventana flotante.
          </p>
        </div>

        <PermisosMatriz data={data} />
      </div>
    </AdminPageGate>
  );
}
