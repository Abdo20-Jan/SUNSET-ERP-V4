"use client";

/**
 * AppShell (PR-002 Global Shell → cutover PR-015) — chrome DEFAULT do top-nav (G-02).
 *
 * Renderizado pela `(dashboard)/layout.tsx` por padrão. O kill-switch
 * `TOP_NAV_ENABLED=false` restaura o shell legado (`AppTopnav`) por um release.
 *
 * Composição: barra superior (logo + `ShellNavDrawer` mobile + `ModuleMegaMenu`
 * + `GlobalSearch` + `ShellUserMenu`) → faixa de abas internas (`TabStrip`) →
 * breadcrumb (+ estrela de favorito) → barra de favoritos → banner modo
 * retroactivo → `<main>`. Hospeda `InternalTabsProvider` (abas) e `ShellProvider`
 * (favoritos) no topo p/ o estado sobreviver à navegação client-side.
 */

import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { TireIcon } from "@hugeicons/core-free-icons";

import { Breadcrumb } from "@/components/layout/breadcrumb";
import { FavoritesBar, FavoriteToggle } from "@/components/layout/favorites-bar";
import { GlobalSearch } from "@/components/layout/global-search";
import { InternalTabsProvider, TabStrip } from "@/components/layout/internal-tabs";
import { ModuleMegaMenu } from "@/components/layout/module-mega-menu";
import { buildShellCrumbs } from "@/components/layout/nav-model";
import { ShellNavDrawer } from "@/components/layout/shell-nav-drawer";
import { ShellProvider } from "@/components/layout/shell-provider";
import { ShellUserMenu } from "@/components/layout/shell-user-menu";

type AppShellProps = {
  user: { nombre: string; username: string; role: string };
  modoRetroactivo: boolean;
  children: React.ReactNode;
};

export function AppShell({ user, modoRetroactivo, children }: AppShellProps) {
  return (
    <InternalTabsProvider>
      <ShellProvider>
        <div className="flex min-h-svh flex-col">
          <header className="sticky top-0 z-20 bg-background/90 backdrop-blur-md">
            <div className="flex h-12 items-center gap-3 border-b border-border px-3">
              <ShellNavDrawer />
              <Link
                href="/dashboard"
                className="flex shrink-0 items-center gap-2"
                aria-label="Inicio · Sunset Tires ERP"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
                  <HugeiconsIcon icon={TireIcon} className="size-4" />
                </span>
                <span className="hidden flex-col leading-tight md:flex">
                  <span className="text-[13px] font-semibold tracking-tight">Sunset Tires</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    ERP · v4
                  </span>
                </span>
              </Link>
              <ModuleMegaMenu />
              <GlobalSearch />
              <ShellUserMenu user={user} />
            </div>

            <TabStrip />

            <ShellBreadcrumb />

            <FavoritesBar />
          </header>

          {modoRetroactivo ? (
            <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
              Modo retroactivo activo · las fechas no se autocompletan ·{" "}
              <Link href="/perfil" className="underline hover:text-amber-950">
                ajustar en perfil
              </Link>
            </div>
          ) : null}

          <main className="flex-1 px-4 py-3">{children}</main>
        </div>
      </ShellProvider>
    </InternalTabsProvider>
  );
}

function ShellBreadcrumb() {
  const pathname = usePathname();
  const crumbs = buildShellCrumbs(pathname);
  if (crumbs.length === 0) return null;
  const favLabel = crumbs.map((c) => c.label).join(" · ");
  return (
    <div className="flex h-8 items-center justify-between gap-2 border-b border-border/60 px-3">
      <Breadcrumb crumbs={crumbs} />
      <FavoriteToggle href={pathname} label={favLabel} />
    </div>
  );
}
