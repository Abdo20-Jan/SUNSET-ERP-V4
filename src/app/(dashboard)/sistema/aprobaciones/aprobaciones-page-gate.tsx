"use client";

import type { ReactNode } from "react";

import { PermissionGate } from "@/components/auth/permission-gate";
import { PERMISOS } from "@/lib/permisos-catalog";

// Máscara FE de la página (defensa en profundidad; el BE ya gatea con
// `requirePermissionPage` en el server component). Con RBAC ON, perfiles sin
// `aprobaciones.ver` ven el mensaje de acceso restringido.
export function AprobacionesPageGate({ children }: { children: ReactNode }) {
  return (
    <PermissionGate
      permission={PERMISOS.APROBACIONES_VER}
      variant="page"
      message="Sólo perfiles con acceso a aprobaciones pueden ver la central."
    >
      {children}
    </PermissionGate>
  );
}
