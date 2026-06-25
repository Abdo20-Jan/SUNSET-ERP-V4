import {
  DashboardSquare01Icon,
  Analytics01Icon,
  CustomerService01Icon,
  ShoppingBag03Icon,
  TruckDeliveryIcon,
  ShoppingBasket03Icon,
  CargoShipIcon,
  PackageIcon,
  CreditCardIcon,
  ReceiptDollarIcon,
  Calendar03Icon,
  Invoice01Icon,
  ChartLineData01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { PERMISOS, type PermisoKey } from "@/lib/permisos-catalog";

export type CenterId =
  | "inicio"
  | "comercial"
  | "abastecimiento"
  | "comex"
  | "inventario"
  | "finanzas"
  | "contabilidad"
  | "configuracion";

// `permission` (PR-007, opcional) gateia o item pelo snapshot do PR-006. Ausente ⇒ sempre
// visível (sem gating). Filtragem em `nav-permissions.ts`; consumo via `useVisibleCenters`.
export type NavItem = {
  label: string;
  href: string;
  icon: typeof DashboardSquare01Icon;
  permission?: PermisoKey;
};
export type NavSection = { label: string; items: readonly NavItem[] };
export type NavCenter = {
  id: CenterId;
  label: string;
  icon: typeof DashboardSquare01Icon;
  overviewHref: string;
  routePrefixes: readonly string[];
  sections: readonly NavSection[];
  crossLinks?: readonly NavItem[];
  inUserMenu?: boolean;
};

export const CENTERS: readonly NavCenter[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: DashboardSquare01Icon,
    overviewHref: "/dashboard",
    routePrefixes: ["/dashboard", "/bi"],
    sections: [
      {
        label: "General",
        items: [
          { label: "Dashboard", href: "/dashboard", icon: DashboardSquare01Icon },
          { label: "BI", href: "/bi", icon: Analytics01Icon },
        ],
      },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    icon: CustomerService01Icon,
    overviewHref: "/ventas",
    routePrefixes: ["/ventas", "/crm", "/entregas"],
    sections: [
      {
        label: "Ventas",
        items: [
          { label: "Ventas", href: "/ventas", icon: ShoppingBag03Icon },
          { label: "Pedidos", href: "/ventas/pedidos", icon: ShoppingBag03Icon },
          { label: "Entregas", href: "/entregas", icon: TruckDeliveryIcon },
        ],
      },
      {
        label: "CRM",
        items: [
          { label: "CRM", href: "/crm", icon: CustomerService01Icon },
          { label: "Leads", href: "/crm/leads", icon: CustomerService01Icon },
          { label: "Oportunidades", href: "/crm/oportunidades", icon: CustomerService01Icon },
          { label: "Contactos", href: "/crm/contactos", icon: UserGroupIcon },
          { label: "Actividades", href: "/crm/actividades", icon: Calendar03Icon },
        ],
      },
    ],
    crossLinks: [{ label: "Clientes", href: "/maestros/clientes", icon: UserGroupIcon }],
  },
  {
    id: "abastecimiento",
    label: "Abastecimiento",
    icon: ShoppingBasket03Icon,
    overviewHref: "/compras",
    routePrefixes: ["/compras"],
    sections: [
      {
        label: "Compras",
        items: [
          { label: "Compras", href: "/compras", icon: ShoppingBasket03Icon },
          { label: "Pedidos de compra", href: "/compras/pedidos", icon: ShoppingBasket03Icon },
        ],
      },
    ],
    crossLinks: [{ label: "Proveedores", href: "/maestros/proveedores", icon: TruckDeliveryIcon }],
  },
  {
    id: "comex",
    label: "Comex",
    icon: CargoShipIcon,
    overviewHref: "/comex",
    routePrefixes: ["/comex"],
    sections: [
      {
        label: "Operación",
        items: [
          { label: "Embarques", href: "/comex/embarques", icon: CargoShipIcon },
          { label: "Simulaciones", href: "/comex/simulaciones", icon: Analytics01Icon },
        ],
      },
      {
        label: "Gestión",
        items: [{ label: "Proveedores", href: "/comex/proveedores", icon: TruckDeliveryIcon }],
      },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    icon: PackageIcon,
    overviewHref: "/inventario",
    routePrefixes: ["/inventario"],
    sections: [
      {
        label: "Stock",
        items: [
          { label: "Inventario", href: "/inventario", icon: PackageIcon },
          { label: "Transferencias", href: "/inventario/transferencias", icon: TruckDeliveryIcon },
        ],
      },
    ],
    crossLinks: [
      { label: "Productos", href: "/maestros/productos", icon: PackageIcon },
      { label: "Depósitos", href: "/maestros/depositos", icon: PackageIcon },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    icon: CreditCardIcon,
    overviewHref: "/tesoreria",
    routePrefixes: ["/tesoreria", "/gastos", "/gastos-fijos"],
    sections: [
      {
        label: "Tesorería",
        items: [
          { label: "Tesorería", href: "/tesoreria", icon: CreditCardIcon },
          { label: "Cuentas", href: "/tesoreria/cuentas", icon: CreditCardIcon },
          { label: "Movimientos", href: "/tesoreria/movimientos", icon: ReceiptDollarIcon },
          { label: "Transferencias", href: "/tesoreria/transferencias", icon: ReceiptDollarIcon },
          { label: "Préstamos", href: "/tesoreria/prestamos", icon: CreditCardIcon },
          { label: "Anticipos", href: "/tesoreria/anticipos", icon: ReceiptDollarIcon },
          { label: "Extractos", href: "/tesoreria/extractos", icon: Invoice01Icon },
        ],
      },
      {
        label: "Cuentas corrientes",
        items: [
          { label: "Cuentas a pagar", href: "/tesoreria/cuentas-a-pagar", icon: ReceiptDollarIcon },
          {
            label: "Cuentas a cobrar",
            href: "/tesoreria/cuentas-a-cobrar",
            icon: ReceiptDollarIcon,
          },
          {
            label: "Saldos por proveedor",
            href: "/tesoreria/saldos-proveedores",
            icon: TruckDeliveryIcon,
          },
        ],
      },
      {
        label: "Gastos",
        items: [
          { label: "Gastos", href: "/gastos", icon: ReceiptDollarIcon },
          { label: "Gastos fijos", href: "/gastos-fijos", icon: Calendar03Icon },
        ],
      },
    ],
    crossLinks: [
      { label: "Cotizaciones", href: "/maestros/cotizaciones", icon: ChartLineData01Icon },
    ],
  },
  {
    id: "contabilidad",
    label: "Contabilidad",
    icon: Invoice01Icon,
    overviewHref: "/contabilidad",
    routePrefixes: ["/contabilidad", "/reportes"],
    sections: [
      {
        label: "Registro",
        items: [
          { label: "Asientos", href: "/contabilidad", icon: Invoice01Icon },
          { label: "Cuentas", href: "/contabilidad/cuentas", icon: Invoice01Icon },
          { label: "Períodos", href: "/contabilidad/periodos", icon: Calendar03Icon },
        ],
      },
      {
        label: "Reportes",
        items: [
          {
            label: "Balance General",
            href: "/reportes/balance-general",
            icon: ChartLineData01Icon,
          },
          {
            label: "Estado de Resultados",
            href: "/reportes/estado-resultados",
            icon: ChartLineData01Icon,
          },
          { label: "Flujo de Caja", href: "/reportes/flujo-caja", icon: ChartLineData01Icon },
          { label: "Libro Diario", href: "/reportes/libro-diario", icon: Invoice01Icon },
          { label: "Libro Mayor", href: "/reportes/libro-mayor", icon: Invoice01Icon },
          {
            label: "Balance de sumas y saldos",
            href: "/contabilidad/reportes/balance",
            icon: ChartLineData01Icon,
          },
        ],
      },
    ],
  },
  {
    id: "configuracion",
    label: "Configuración",
    icon: UserGroupIcon,
    overviewHref: "/maestros",
    routePrefixes: ["/maestros", "/admin", "/perfil"],
    inUserMenu: true,
    sections: [
      {
        label: "Maestros",
        items: [
          { label: "Clientes", href: "/maestros/clientes", icon: UserGroupIcon },
          { label: "Proveedores", href: "/maestros/proveedores", icon: TruckDeliveryIcon },
          { label: "Productos", href: "/maestros/productos", icon: PackageIcon },
          { label: "Depósitos", href: "/maestros/depositos", icon: PackageIcon },
          { label: "Cotizaciones", href: "/maestros/cotizaciones", icon: ChartLineData01Icon },
          {
            label: "Jurisdicciones IIBB",
            href: "/maestros/jurisdicciones-iibb",
            icon: Invoice01Icon,
          },
        ],
      },
      {
        label: "Sistema",
        items: [
          {
            label: "Admin",
            href: "/admin",
            icon: UserGroupIcon,
            permission: PERMISOS.ADMIN_ACCESO,
          },
          { label: "Mi perfil", href: "/perfil", icon: UserGroupIcon },
        ],
      },
    ],
  },
];

const _allNavItemsRaw: NavItem[] = CENTERS.flatMap((c) => [
  ...c.sections.flatMap((s) => s.items),
  ...(c.crossLinks ?? []),
]);
const _seenHrefs = new Set<string>();
export const ALL_NAV_ITEMS: readonly NavItem[] = _allNavItemsRaw.filter((item) => {
  if (_seenHrefs.has(item.href)) return false;
  _seenHrefs.add(item.href);
  return true;
});
