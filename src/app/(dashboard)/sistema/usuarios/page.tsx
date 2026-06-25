import { listarUsuarios } from "@/lib/actions/usuarios";
import { listarPerfiles } from "@/lib/actions/permisos-admin";
import { PERMISOS, requirePermissionPage } from "@/lib/permisos";
import { Card } from "@/components/ui/card";

import { AdminPageGate } from "../admin-page-gate";
import { UsuariosTable } from "./usuarios-table";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  // BE: gate al tope (redirige a quien no tenga admin.acceso). Con RBAC OFF
  // (default) delega en requireAdminPage() ⇒ sólo el Master alcanza.
  await requirePermissionPage(PERMISOS.ADMIN_ACCESO);

  const [usuarios, perfiles] = await Promise.all([listarUsuarios(), listarPerfiles()]);

  return (
    <AdminPageGate>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Usuarios y permisos</h1>
          <p className="text-sm text-muted-foreground">
            {usuarios.length} usuario{usuarios.length === 1 ? "" : "s"}. Gestioná accesos, perfiles
            y permisos individuales.
          </p>
        </div>

        <Card className="py-0">
          <UsuariosTable usuarios={usuarios} perfiles={perfiles} />
        </Card>
      </div>
    </AdminPageGate>
  );
}
