"use client";

import type { ReactNode } from "react";

import { PermissionGate } from "@/components/auth/permission-gate";
import { PERMISOS } from "@/lib/permisos-catalog";

// Máscara FE de la página (defensa en profundidad; el BE ya gatea con
// `requirePermissionPage` en el server component). Con RBAC ON, perfiles sin
// `auditoria.ver` ven el mensaje de acceso restringido.
export function AuditoriaPageGate({ children }: { children: ReactNode }) {
  return (
    <PermissionGate
      permission={PERMISOS.AUDITORIA_VER}
      variant="page"
      message="Sólo perfiles de auditoría (auditor/Master/Diretor) pueden ver la auditoría del sistema."
    >
      {children}
    </PermissionGate>
  );
}
