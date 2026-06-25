// Helpers de permissão no cliente (PR-007). Puro e node-testável — SEM "use client".
//
// Consome o snapshot de permissões exposto pelo PR-006 (`session.user.permisos`). Garantia de
// backward-compat: com o RBAC OFF (ou token legacy) o snapshot chega `undefined` e TUDO é
// permitido — idêntico ao comportamento atual. A máscara no FE é reflexo de UX; o backend
// sempre revalida (regra G-06 / PERM-01 §6).

import type { NavCenter, NavItem, NavSection } from "@/components/layout/nav-config";

/**
 * Predicado base do FE. `permisos === undefined` (RBAC OFF / token legacy) ⇒ libera tudo.
 * Caso contrário exige a chave no snapshot. Nunca é a única proteção.
 */
export function hasClientPermission(permisos: readonly string[] | undefined, key: string): boolean {
  return permisos === undefined || permisos.includes(key);
}

function isItemAllowed(item: NavItem, permisos: readonly string[] | undefined): boolean {
  return item.permission === undefined || hasClientPermission(permisos, item.permission);
}

/** Filtra os itens de uma seção; retorna `null` se a seção ficar vazia. */
function filterSection(
  section: NavSection,
  permisos: readonly string[] | undefined,
): NavSection | null {
  const items = section.items.filter((item) => isItemAllowed(item, permisos));
  return items.length > 0 ? { ...section, items } : null;
}

/** Filtra seções + crossLinks de um center; retorna `null` se ele ficar totalmente vazio. */
function filterCenter(
  center: NavCenter,
  permisos: readonly string[] | undefined,
): NavCenter | null {
  const sections = center.sections
    .map((section) => filterSection(section, permisos))
    .filter((section): section is NavSection => section !== null);
  const crossLinks = center.crossLinks?.filter((item) => isItemAllowed(item, permisos));
  if (sections.length === 0 && (crossLinks === undefined || crossLinks.length === 0)) {
    return null;
  }
  return { ...center, sections, crossLinks };
}

/**
 * Aplica as permissões ao nav (CENTERS). Com `permisos === undefined` devolve a mesma árvore
 * (zero regressão e referência estável). Caso contrário remove itens/crossLinks sem permissão,
 * seções vazias e centers que ficaram totalmente vazios.
 */
export function filterCentersByPermission(
  centers: readonly NavCenter[],
  permisos: readonly string[] | undefined,
): readonly NavCenter[] {
  if (permisos === undefined) return centers;
  return centers
    .map((center) => filterCenter(center, permisos))
    .filter((center): center is NavCenter => center !== null);
}
