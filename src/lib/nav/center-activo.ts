import {
  CENTERS,
  ALL_NAV_ITEMS,
  type CenterId,
  type NavCenter,
} from "@/components/layout/nav-config";

export function findCenterByPrefix(pathname: string): NavCenter | undefined {
  let best: { center: NavCenter; len: number } | undefined;
  for (const center of CENTERS) {
    for (const prefix of center.routePrefixes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.len) best = { center, len: prefix.length };
      }
    }
  }
  return best?.center;
}

export function getCenterActivo(pathname: string): CenterId {
  return findCenterByPrefix(pathname)?.id ?? "inicio";
}

export type Crumb = { label: string; href?: string };

const SEGMENT_LABELS: Record<string, string> = {
  embarques: "Embarques",
  asientos: "Asientos",
  cuentas: "Cuentas",
  movimientos: "Movimientos",
  transferencias: "Transferencias",
  prestamos: "Préstamos",
  "cuentas-a-pagar": "Cuentas a pagar",
  "cuentas-a-cobrar": "Cuentas a cobrar",
  "saldos-proveedores": "Saldos por proveedor",
  extractos: "Extractos",
  anticipos: "Anticipos",
  pedidos: "Pedidos",
  clientes: "Clientes",
  proveedores: "Proveedores",
  productos: "Productos",
  depositos: "Depósitos",
  cotizaciones: "Cotizaciones",
  periodos: "Períodos",
  reportes: "Reportes",
  "balance-general": "Balance General",
  "estado-resultados": "Estado de Resultados",
  "flujo-caja": "Flujo de Caja",
  "libro-diario": "Libro Diario",
  "libro-mayor": "Libro Mayor",
  balance: "Balance",
  simulaciones: "Simulaciones",
  entregas: "Entregas",
  leads: "Leads",
  oportunidades: "Oportunidades",
  contactos: "Contactos",
  actividades: "Actividades",
  "jurisdicciones-iibb": "Jurisdicciones IIBB",
  nuevo: "Nuevo",
  nueva: "Nueva",
};

function looksLikeId(seg: string): boolean {
  return /^\d+$/.test(seg) || /^[a-z0-9]{20,}$/i.test(seg);
}

function findNavItemByLongestHref(pathname: string): { label: string; href: string } | undefined {
  let best: { label: string; href: string; len: number } | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.len) best = { ...item, len: item.href.length };
    }
  }
  return best ? { label: best.label, href: best.href } : undefined;
}

export function getBreadcrumb(pathname: string): Crumb[] {
  const center = findCenterByPrefix(pathname);
  if (!center) return [];

  const crumbs: Crumb[] = [];
  const onHub = pathname === center.overviewHref;
  crumbs.push({ label: center.label, href: onHub ? undefined : center.overviewHref });
  if (onHub) return crumbs;

  const moduleItem = findNavItemByLongestHref(pathname);
  let consumed = center.overviewHref;
  if (moduleItem && moduleItem.href !== center.overviewHref) {
    const onModule = pathname === moduleItem.href;
    crumbs.push({ label: moduleItem.label, href: onModule ? undefined : moduleItem.href });
    consumed = moduleItem.href;
  }

  const rest = pathname.slice(consumed.length).split("/").filter(Boolean);
  let acc = consumed;
  rest.forEach((seg, i) => {
    acc += `/${seg}`;
    const isLast = i === rest.length - 1;
    if (looksLikeId(seg)) {
      crumbs.push({ label: "Detalle" });
      return;
    }
    crumbs.push({ label: SEGMENT_LABELS[seg] ?? seg, href: isLast ? undefined : acc });
  });
  return crumbs;
}
