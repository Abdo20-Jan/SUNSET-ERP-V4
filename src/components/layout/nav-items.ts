import {
  DashboardSquare01Icon,
  Invoice01Icon,
  CreditCardIcon,
  CargoShipIcon,
  UserGroupIcon,
  ChartLineData01Icon,
  ShoppingBag03Icon,
  ShoppingBasket03Icon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";

export type NavItem = {
  label: string;
  href: string;
  icon: typeof DashboardSquare01Icon;
};

export type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "General",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: DashboardSquare01Icon },
    ],
  },
  {
    label: "Operación",
    items: [
      { label: "Ventas", href: "/ventas", icon: ShoppingBag03Icon },
      { label: "Compras", href: "/compras", icon: ShoppingBasket03Icon },
      { label: "Comex", href: "/comex", icon: CargoShipIcon },
      { label: "Tesorería", href: "/tesoreria", icon: CreditCardIcon },
      { label: "Gastos fijos", href: "/gastos-fijos", icon: Calendar03Icon },
    ],
  },
  {
    label: "Contabilidad",
    items: [
      { label: "Asientos", href: "/contabilidad", icon: Invoice01Icon },
      { label: "Reportes", href: "/reportes", icon: ChartLineData01Icon },
    ],
  },
  {
    label: "Maestros",
    items: [
      { label: "Maestros", href: "/maestros", icon: UserGroupIcon },
    ],
  },
] as const;

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (g) => g.items,
);
