// Helpers de permissão no cliente (PR-007). Puro e node-testável — SEM "use client".
//
// Consome o snapshot de permissões exposto pelo PR-006 (`session.user.permisos`). Garantia de
// backward-compat: com o RBAC OFF (ou token legacy) o snapshot chega `undefined` e TUDO é
// permitido — idêntico ao comportamento atual. A máscara no FE é reflexo de UX; o backend
// sempre revalida (regra G-06 / PERM-01 §6).

import type { NavCenter, NavItem, NavSection } from "@/components/layout/nav-config";
import type { ShellModule, ShellNavItem } from "@/components/layout/nav-model";

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

// ───────────────────────────────────────────────────────────────────────────
// Top-nav (SHELL_MODULES) — mesma máscara aplicada ao shell novo (PR-015).
// ───────────────────────────────────────────────────────────────────────────

function isModuleItemAllowed(item: ShellNavItem, permisos: readonly string[] | undefined): boolean {
  return item.permission === undefined || hasClientPermission(permisos, item.permission);
}

/**
 * Filtra um módulo do top-nav. Módulo-folha (sem `items`, ex.: Dashboard/BI) passa intacto.
 * Módulo-pai tem os itens filtrados por permissão; se ficar sem itens, retorna `null`.
 */
function filterModule(
  mod: ShellModule,
  permisos: readonly string[] | undefined,
): ShellModule | null {
  if (!mod.items) return mod;
  const items = mod.items.filter((item) => isModuleItemAllowed(item, permisos));
  return items.length > 0 ? { ...mod, items } : null;
}

/**
 * Aplica as permissões ao top-nav (SHELL_MODULES). Com `permisos === undefined` devolve a mesma
 * árvore (zero regressão e referência estável). Caso contrário remove itens sem permissão e
 * módulos-pais que ficaram vazios.
 */
export function filterModulesByPermission(
  modules: readonly ShellModule[],
  permisos: readonly string[] | undefined,
): readonly ShellModule[] {
  if (permisos === undefined) return modules;
  return modules
    .map((mod) => filterModule(mod, permisos))
    .filter((mod): mod is ShellModule => mod !== null);
}
