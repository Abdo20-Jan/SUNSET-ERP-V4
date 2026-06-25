"use client";

import type { ReactNode } from "react";

import { PERMISOS } from "@/lib/permisos-catalog";
import { PermissionGate } from "@/components/auth/permission-gate";

/*
 * Refuerzo de gating en el frontend (CRIT-10 / G-06: permiso en FE *y* BE) para
 * las páginas de Sistema. El servidor ya redirige con `requirePermissionPage`
 * (defensa real); este wrapper client enmascara el contenido vía PermissionGate
 * "page" leyendo el snapshot del PR-006. Con RBAC OFF (default) renderiza todo
 * (el snapshot es undefined ⇒ allowed). NO redefine sesión/JWT.
 */
export function AdminPageGate({ children }: { children: ReactNode }) {
  return (
    <PermissionGate permission={PERMISOS.ADMIN_ACCESO} variant="page">
      {children}
    </PermissionGate>
  );
}
