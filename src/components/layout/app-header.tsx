"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/components/layout/nav-items";

type Crumb = { label: string; href?: string };

const SEGMENT_LABELS: Record<string, string> = {
  embarques: "Embarques",
  asientos: "Asientos",
  cuentas: "Cuentas",
  movimientos: "Movimientos",
  transferencias: "Transferencias",
  prestamos: "Préstamos",
  "cuentas-a-pagar": "Cuentas a pagar",
  "saldos-proveedores": "Saldos por proveedor",
  extractos: "Extractos",
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
  nuevo: "Nuevo",
  nueva: "Nueva",
};

function looksLikeId(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[a-z0-9]{20,}$/i.test(seg)) return true;
  return false;
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  const crumbs: Crumb[] = [];
  const navMatch = NAV_ITEMS.find((n) => `/${segments[0]}` === n.href);
  if (navMatch) {
    crumbs.push({ label: navMatch.label, href: navMatch.href });
  } else {
    crumbs.push({
      label: SEGMENT_LABELS[segments[0]!] ?? segments[0]!,
      href: `/${segments[0]}`,
    });
  }

  let acc = `/${segments[0]}`;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    acc += `/${seg}`;
    if (looksLikeId(seg)) {
      crumbs.push({ label: "Detalle" });
      continue;
    }
    crumbs.push({
      label: SEGMENT_LABELS[seg] ?? seg,
      href: i === segments.length - 1 ? undefined : acc,
    });
  }
  return crumbs;
}

export function AppHeader() {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md">
      <SidebarTrigger className="-ml-1 size-7" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <nav
        aria-label="breadcrumb"
        className="flex min-w-0 items-center gap-1 text-[12px]"
      >
        {crumbs.map((c, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <span key={`${c.label}-${idx}`} className="flex items-center gap-1">
              {c.href && !isLast ? (
                <Link
                  href={c.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                  aria-current={isLast ? "page" : undefined}
                >
                  {c.label}
                </span>
              )}
              {!isLast && (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-3 text-muted-foreground/50"
                />
              )}
            </span>
          );
        })}
      </nav>
    </header>
  );
}
