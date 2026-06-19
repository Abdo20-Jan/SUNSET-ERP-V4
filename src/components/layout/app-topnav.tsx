"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { TireIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { CENTERS } from "@/components/layout/nav-config";
import { getCenterActivo, getBreadcrumb } from "@/lib/nav/center-activo";
import { CenterMegaMenu } from "@/components/layout/center-mega-menu";
import { TopnavUserMenu } from "@/components/layout/topnav-user-menu";
import { NavDrawer } from "@/components/layout/nav-drawer";
import { CommandMenu } from "@/components/layout/command-menu";
import { Menubar } from "@/components/ui/menubar";

export function AppTopnav({ user }: { user: { nombre: string; username: string; role: string } }) {
  const pathname = usePathname();
  const activeId = getCenterActivo(pathname);
  const crumbs = getBreadcrumb(pathname);
  const barCenters = CENTERS.filter((c) => !c.inUserMenu);
  const config = CENTERS.find((c) => c.id === "configuracion")!;

  return (
    <header className="sticky top-0 z-20 flex shrink-0 flex-col border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex h-11 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <NavDrawer />
          <Link href="/dashboard" className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HugeiconsIcon icon={TireIcon} className="size-3.5" />
            </span>
            <span className="hidden text-[13px] font-semibold tracking-tight sm:inline">
              Sunset
            </span>
          </Link>
          <Menubar className="ml-1 hidden md:flex" aria-label="Centers">
            {barCenters.map((center) => (
              <CenterMegaMenu key={center.id} center={center} active={center.id === activeId} />
            ))}
          </Menubar>
        </div>
        <div className="flex items-center gap-2">
          <CommandMenu />
          <TopnavUserMenu user={user} config={config} />
        </div>
      </div>
      {crumbs.length > 0 ? (
        <nav
          aria-label="breadcrumb"
          className="flex h-8 items-center gap-1 border-t border-border/60 px-3 text-[12px]"
        >
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={`${c.label}-${c.href ?? ""}`} className="flex items-center gap-1">
                {c.href && !isLast ? (
                  <Link
                    href={c.href}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    className={isLast ? "font-medium text-foreground" : "text-muted-foreground"}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {c.label}
                  </span>
                )}
                {!isLast ? (
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                    className="size-3 text-muted-foreground/50"
                  />
                ) : null}
              </span>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
