import {
  DashboardSquare01Icon,
  Invoice01Icon,
  CreditCardIcon,
  CargoShipIcon,
  UserGroupIcon,
  ChartLineData01Icon,
} from "@hugeicons/core-free-icons";

export type NavItem = {
  label: string;
  href: string;
  icon: typeof DashboardSquare01Icon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardSquare01Icon },
  { label: "Contabilidad", href: "/contabilidad", icon: Invoice01Icon },
  { label: "Tesorería", href: "/tesoreria", icon: CreditCardIcon },
  { label: "Comex", href: "/comex", icon: CargoShipIcon },
  { label: "Maestros", href: "/maestros", icon: UserGroupIcon },
  { label: "Reportes", href: "/reportes", icon: ChartLineData01Icon },
] as const;
