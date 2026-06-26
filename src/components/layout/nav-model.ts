/**
 * Modelo hierárquico do top-nav (PR-002 Global Shell).
 *
 * Fonte de dados PURA (sem JSX) do `ModuleMegaMenu`, `GlobalSearch` e
 * `InternalTabs`. Deriva dos page_codes canônicos (SHELL-01) e das rotas
 * **reais** do `(dashboard)`. Só re-rotula/agrupa rotas existentes — **não**
 * cria, move nem renomeia rota alguma (Q5 Finanças×Tesouraria fica diferido;
 * por isso CxC/CxP/Flujo seguem apontando às rotas atuais `/tesoreria/*` e
 * `/reportes/*`).
 *
 * Páginas ainda inexistentes (COM-05, CLI-02, FIN-03, FIN-04, AUTO-01) entram
 * como `status: "future"` → renderizadas desabilitadas ("Pronto"), nunca
 * navegam. Editar SÓ este arquivo para ajustar o menu.
 *
 * Coexiste com `nav-config.ts` (fonte do shell legado), mantido um release
 * atrás do kill-switch `TOP_NAV_ENABLED=false`; ambos serão unificados quando o
 * legado for removido (PR-015b).
 *
 * `permission` (PR-007, opcional) gateia o item pelo snapshot do PR-006 via
 * `useVisibleModules`/`filterModulesByPermission`. Ausente ⇒ sempre visível
 * (sem gating). Com RBAC OFF o snapshot chega `undefined` e nada é filtrado.
 */

import type { PermisoKey } from "@/lib/permisos-catalog";
import { PERMISOS } from "@/lib/permisos-catalog";

export type ShellNavStatus = "active" | "future";

export type ShellNavItem = {
  label: string;
  href?: string;
  status: ShellNavStatus;
  /** page_code canônico (referência/documentação). */
  pageCode?: string;
  /** Permissão (PR-007) que gateia o item. Ausente ⇒ sempre visível. */
  permission?: PermisoKey;
};

export type ShellModule = {
  label: string;
  /** Quando o módulo é folha (link direto, sem submenu). */
  href?: string;
  /** Quando o módulo é pai (abre submenu textual). */
  items?: readonly ShellNavItem[];
};

export const SHELL_MODULES: readonly ShellModule[] = [
  { label: "Dashboard", href: "/dashboard" },
  {
    label: "Comercial",
    items: [
      { label: "Documentos", href: "/ventas/documentos", status: "active", pageCode: "COM-01" },
      { label: "Ventas", href: "/ventas", status: "active", pageCode: "COM-02" },
      { label: "Pedidos", href: "/ventas/pedidos", status: "active", pageCode: "COM-03" },
      {
        label: "Presupuestos",
        href: "/maestros/cotizaciones",
        status: "active",
        pageCode: "COM-04",
      },
      { label: "Autorizaciones", status: "future", pageCode: "COM-05" },
    ],
  },
  {
    label: "Clientes",
    items: [
      { label: "Ficha general", href: "/maestros/clientes", status: "active", pageCode: "CLI-01" },
      { label: "Ficha financiera", status: "future", pageCode: "CLI-02" },
    ],
  },
  {
    label: "Maestros",
    items: [
      {
        label: "Productos",
        href: "/maestros/productos",
        status: "active",
        pageCode: "MAE-PROD-01",
      },
      { label: "Proveedores", href: "/maestros/proveedores", status: "active" },
      { label: "Depósitos", href: "/maestros/depositos", status: "active" },
      { label: "Jurisdicciones IIBB", href: "/maestros/jurisdicciones-iibb", status: "active" },
    ],
  },
  {
    label: "Comex",
    items: [
      { label: "Cockpit", href: "/comex", status: "active", pageCode: "CX-01" },
      { label: "Embarques", href: "/comex/embarques", status: "active", pageCode: "CX-02" },
      { label: "Simulaciones", href: "/comex/simulaciones", status: "active", pageCode: "CX-06" },
      { label: "Proveedores Comex", href: "/comex/proveedores", status: "active" },
    ],
  },
  {
    label: "Inventario",
    items: [
      { label: "Stock general", href: "/inventario", status: "active", pageCode: "INV-01" },
      { label: "Transferencias", href: "/inventario/transferencias", status: "active" },
    ],
  },
  { label: "Logística", href: "/entregas" },
  {
    label: "Finanzas",
    items: [
      {
        label: "Cuentas a cobrar",
        href: "/tesoreria/cuentas-a-cobrar",
        status: "active",
        pageCode: "FIN-01",
      },
      {
        label: "Cuentas a pagar",
        href: "/tesoreria/cuentas-a-pagar",
        status: "active",
        pageCode: "FIN-02",
      },
      { label: "Saldos por proveedor", href: "/tesoreria/saldos-proveedores", status: "active" },
      {
        label: "Flujo de caja",
        href: "/reportes/flujo-caja",
        status: "active",
        pageCode: "FIN-05",
      },
      { label: "Gastos", href: "/gastos", status: "active" },
      { label: "Gastos fijos", href: "/gastos-fijos", status: "active" },
      { label: "Crédito y cobranza", status: "future", pageCode: "FIN-03" },
      { label: "Programación financiera", status: "future", pageCode: "FIN-04" },
    ],
  },
  {
    label: "Tesorería",
    items: [
      { label: "Bancos y cajas", href: "/tesoreria/cuentas", status: "active", pageCode: "TES-01" },
      {
        label: "Movimientos / Pagos",
        href: "/tesoreria/movimientos",
        status: "active",
        pageCode: "TES-02",
      },
      { label: "Historial de pagos", href: "/tesoreria/pagos-historial", status: "active" },
      { label: "Conciliación", href: "/tesoreria/extractos", status: "active", pageCode: "TES-04" },
      { label: "Anticipos", href: "/tesoreria/anticipos", status: "active" },
      { label: "Préstamos", href: "/tesoreria/prestamos", status: "active" },
      { label: "Transferencias", href: "/tesoreria/transferencias/nuevo", status: "active" },
    ],
  },
  {
    label: "Contabilidad",
    items: [
      { label: "Asientos", href: "/contabilidad/asientos", status: "active", pageCode: "CONT-01" },
      {
        label: "Plan de cuentas",
        href: "/contabilidad/cuentas",
        status: "active",
        pageCode: "CONT-02",
      },
      { label: "Períodos", href: "/contabilidad/periodos", status: "active" },
      {
        label: "Estado de resultados",
        href: "/reportes/estado-resultados",
        status: "active",
        pageCode: "CONT-03",
      },
      {
        label: "Balance general",
        href: "/reportes/balance-general",
        status: "active",
        pageCode: "CONT-04",
      },
      { label: "Libro diario", href: "/reportes/libro-diario", status: "active" },
      { label: "Libro mayor", href: "/reportes/libro-mayor", status: "active" },
      {
        label: "Balance de sumas y saldos",
        href: "/contabilidad/reportes/balance",
        status: "active",
      },
    ],
  },
  {
    label: "Compras",
    items: [
      { label: "Órdenes de compra", href: "/compras", status: "active", pageCode: "COMP-01" },
      { label: "Pedidos de compra", href: "/compras/pedidos", status: "active" },
    ],
  },
  {
    label: "CRM",
    items: [
      { label: "Panel", href: "/crm", status: "active", pageCode: "CRM-01" },
      { label: "Leads", href: "/crm/leads", status: "active" },
      { label: "Oportunidades", href: "/crm/oportunidades", status: "active" },
      { label: "Pipeline", href: "/crm/oportunidades/pipeline", status: "active" },
      { label: "Contactos", href: "/crm/contactos", status: "active" },
      { label: "Actividades", href: "/crm/actividades", status: "active" },
    ],
  },
  { label: "BI", href: "/bi" },
  {
    label: "Sistema",
    items: [
      {
        label: "Permisos",
        href: "/sistema/usuarios",
        status: "active",
        pageCode: "PERM-01",
        permission: PERMISOS.ADMIN_ACCESO,
      },
      {
        label: "Auditoría",
        href: "/sistema/auditoria",
        status: "active",
        pageCode: "AUD-01",
        permission: PERMISOS.AUDITORIA_VER,
      },
      {
        label: "Aprobaciones",
        href: "/sistema/aprobaciones",
        status: "active",
        permission: PERMISOS.APROBACIONES_VER,
      },
      { label: "Automatizaciones", status: "future", pageCode: "AUTO-01" },
      {
        label: "Herramientas admin",
        href: "/admin/recalcular-percepcion-iibb",
        status: "active",
        permission: PERMISOS.ADMIN_ACCESO,
      },
      { label: "Mi perfil", href: "/perfil", status: "active" },
    ],
  },
] as const;

/** Marca rota ativa: match exato ou prefixo de segmento (`/x` ⊂ `/x/...`). */
export function isHrefActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Um módulo está ativo se ele (folha) ou qualquer filho com href estiver ativo. */
export function isModuleActive(pathname: string, mod: ShellModule): boolean {
  if (mod.href && isHrefActive(pathname, mod.href)) return true;
  return (mod.items ?? []).some((it) => it.href != null && isHrefActive(pathname, it.href));
}

export type NavTarget = { moduleLabel: string; label: string; href: string };

/**
 * Alvos navegáveis (status active + href) achatados — fonte do GlobalSearch.
 * Aceita uma lista de módulos já filtrada por permissão (`useVisibleModules`);
 * default = `SHELL_MODULES` (sem filtro), mantendo a chamada legada.
 */
export function flattenNavTargets(modules: readonly ShellModule[] = SHELL_MODULES): NavTarget[] {
  const targets: NavTarget[] = [];
  for (const mod of modules) {
    if (mod.href) {
      targets.push({ moduleLabel: mod.label, label: mod.label, href: mod.href });
    }
    for (const item of mod.items ?? []) {
      if (item.status === "active" && item.href) {
        targets.push({ moduleLabel: mod.label, label: item.label, href: item.href });
      }
    }
  }
  return targets;
}

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  bi: "BI",
  crm: "CRM",
  leads: "Leads",
  oportunidades: "Oportunidades",
  pipeline: "Pipeline",
  contactos: "Contactos",
  actividades: "Actividades",
  ventas: "Ventas",
  pedidos: "Pedidos",
  entregas: "Entregas",
  compras: "Compras",
  inventario: "Inventario",
  transferencias: "Transferencias",
  comex: "Comex",
  embarques: "Embarques",
  simulaciones: "Simulaciones",
  contenedores: "Contenedores",
  despachos: "Despachos",
  desconsolidacion: "Desconsolidación",
  investigacion: "Investigación",
  tesoreria: "Tesorería",
  cuentas: "Cuentas",
  "cuentas-a-cobrar": "Cuentas a cobrar",
  "cuentas-a-pagar": "Cuentas a pagar",
  "saldos-proveedores": "Saldos por proveedor",
  movimientos: "Movimientos",
  "pagos-historial": "Historial de pagos",
  extracto: "Extracto",
  extractos: "Extractos",
  anticipos: "Anticipos",
  prestamos: "Préstamos",
  contabilidad: "Contabilidad",
  asientos: "Asientos",
  "mover-periodo": "Mover período",
  periodos: "Períodos",
  reportes: "Reportes",
  "balance-general": "Balance General",
  "estado-resultados": "Estado de Resultados",
  "flujo-caja": "Flujo de Caja",
  "libro-diario": "Libro Diario",
  "libro-mayor": "Libro Mayor",
  balance: "Balance",
  maestros: "Maestros",
  clientes: "Clientes",
  proveedores: "Proveedores",
  productos: "Productos",
  depositos: "Depósitos",
  "jurisdicciones-iibb": "Jurisdicciones IIBB",
  cotizaciones: "Cotizaciones",
  gastos: "Gastos",
  "gastos-fijos": "Gastos fijos",
  perfil: "Perfil",
  admin: "Admin",
  "recalcular-percepcion-iibb": "Recalcular percepción IIBB",
  configuracion: "Configuración",
  templates: "Plantillas",
  import: "Importar",
  nuevo: "Nuevo",
  nueva: "Nueva",
  editar: "Editar",
};

function looksLikeId(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[a-z0-9]{20,}$/i.test(seg)) return true;
  return false;
}

export type Crumb = { label: string; href?: string };

/** Constrói crumbs a partir do pathname (reusa o `Breadcrumb` presentacional). */
export function buildShellCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  const crumbs: Crumb[] = [];
  let acc = "";
  segments.forEach((seg, i) => {
    acc += `/${seg}`;
    const isLast = i === segments.length - 1;
    if (looksLikeId(seg)) {
      crumbs.push({ label: "Detalle" });
      return;
    }
    crumbs.push({ label: SEGMENT_LABELS[seg] ?? seg, href: isLast ? undefined : acc });
  });
  return crumbs;
}

/** Rótulo curto de uma aba interna derivado do pathname. */
export function deriveTabLabel(pathname: string): string {
  const crumbs = buildShellCrumbs(pathname);
  if (crumbs.length === 0) return "Inicio";
  const last = crumbs[crumbs.length - 1]!;
  if (last.label === "Detalle" && crumbs.length >= 2) {
    return `${crumbs[crumbs.length - 2]!.label} · Detalle`;
  }
  return last.label;
}
