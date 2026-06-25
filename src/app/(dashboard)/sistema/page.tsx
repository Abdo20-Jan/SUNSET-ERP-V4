import Link from "next/link";

import { PERMISOS, requirePermissionPage } from "@/lib/permisos";
import { Card } from "@/components/ui/card";

import { AdminPageGate } from "./admin-page-gate";

export const dynamic = "force-dynamic";

const SECCIONES = [
  {
    href: "/sistema/usuarios",
    title: "Usuarios",
    desc: "Alta, edición y desactivación de usuarios; asignación de perfiles y overrides individuales.",
  },
  {
    href: "/sistema/permisos",
    title: "Permisos",
    desc: "Matriz perfil × recurso; crear/copiar perfiles; editar grants; exportar la matriz.",
  },
] as const;

export default async function SistemaPage() {
  await requirePermissionPage(PERMISOS.ADMIN_ACCESO);

  return (
    <AdminPageGate>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Sistema</h1>
          <p className="text-sm text-muted-foreground">
            Administración de usuarios y permisos (solo Master/admin).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {SECCIONES.map((s) => (
            <Link key={s.href} href={s.href}>
              <Card className="flex h-full flex-col gap-1 p-4 transition hover:border-primary/40">
                <span className="text-sm font-semibold">{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.desc}</span>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AdminPageGate>
  );
}
