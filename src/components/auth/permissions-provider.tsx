"use client";

import { createContext, useContext, useMemo } from "react";

import type { PermisoKey } from "@/lib/permisos-catalog";
import { CENTERS, type NavCenter } from "@/components/layout/nav-config";
import {
  filterCentersByPermission,
  hasClientPermission,
} from "@/components/layout/nav-permissions";

type PermissionsContextValue = {
  /**
   * Snapshot de permissões do PR-006 (`session.user.permisos`). `undefined` = RBAC OFF ou
   * token legacy ⇒ tudo liberado. Somente leitura — o backend sempre revalida.
   */
  permisos?: readonly string[];
};

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions deve ser usado dentro de <PermissionsProvider>");
  return ctx;
}

/** `true` se o usuário tem a chave — ou se não há RBAC resolvido (flag OFF / token legacy). */
export function useHasPermission(key: PermisoKey): boolean {
  const { permisos } = usePermissions();
  return hasClientPermission(permisos, key);
}

/** CENTERS já filtrado pelas permissões atuais. Com RBAC OFF devolve o nav completo. */
export function useVisibleCenters(): readonly NavCenter[] {
  const { permisos } = usePermissions();
  return useMemo(() => filterCentersByPermission(CENTERS, permisos), [permisos]);
}

/**
 * Provider client fino que LÊ o snapshot exposto pelo PR-006 — passado como prop pela
 * `(dashboard)/layout.tsx`, que roda `await auth()` no servidor. Não redefine sessão/JWT;
 * apenas disponibiliza o conjunto de permissões para o gating de UI (G-06).
 */
export function PermissionsProvider({
  permisos,
  children,
}: {
  permisos?: readonly string[];
  children: React.ReactNode;
}) {
  const value = useMemo<PermissionsContextValue>(() => ({ permisos }), [permisos]);
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}
