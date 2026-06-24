"use client";

/**
 * Abas internas (PR-002 Global Shell) — FUNDAÇÃO mínima e segura.
 *
 * O `InternalTabsProvider` vive no nível do shell (`AppShell`), logo o estado
 * sobrevive à navegação client-side (o layout do App Router não remonta). A
 * navegação continua sendo roteamento Next normal (`<Link>`/`router`); este
 * componente **não intercepta** nem altera comportamento de página/rota — só
 * mantém um registro em memória das abas abertas e qual está ativa.
 *
 * Suporta o futuro `open-record-in-tab`: `openTab()` é exposto p/ o `EntityLink`
 * (PR-003+) abrir registros em aba; o modelo já carrega `dirty`/`locked` p/ os
 * indicadores `*`/cadeado.
 *
 * DIFERIDO (não nesta PR): persistência (sessionStorage), confirmação de
 * descarte ao fechar aba `dirty` (depende de forms/DirtyFooter — PR-004) e
 * trava real (`locked`).
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { deriveTabLabel } from "@/components/layout/nav-model";

export type InternalTab = {
  href: string;
  label: string;
  /** Edição pendente (não confirmada). Pinta o indicador `*`. Wiring → PR-004. */
  dirty?: boolean;
  /** Registro bloqueado/somente leitura. Pinta o cadeado. Wiring → PR-004. */
  locked?: boolean;
};

/** Teto de abas simultâneas; ao exceder, despeja a mais antiga não-ativa. */
const MAX_TABS = 8;

type InternalTabsContextValue = {
  tabs: readonly InternalTab[];
  activeHref: string;
  openTab: (tab: InternalTab) => void;
  closeTab: (href: string) => void;
};

const InternalTabsContext = React.createContext<InternalTabsContextValue | null>(null);

export function useInternalTabs(): InternalTabsContextValue {
  const ctx = React.useContext(InternalTabsContext);
  if (!ctx) {
    throw new Error("useInternalTabs deve ser usado dentro de <InternalTabsProvider>.");
  }
  return ctx;
}

/**
 * Variante não-quebrante de {@link useInternalTabs}: retorna `null` quando NÃO
 * há `<InternalTabsProvider>` na árvore (ex.: shell legado com `TOP_NAV_ENABLED`
 * OFF). Permite que consumidores opcionais — como o `EntityLink` (PR-003) —
 * abram registros em aba quando o top-nav está ligado e degradem para navegação
 * normal quando está desligado, sem lançar erro. Aditivo: não altera nenhum
 * contrato existente do PR-002.
 */
export function useInternalTabsOptional(): InternalTabsContextValue | null {
  return React.useContext(InternalTabsContext);
}

export function InternalTabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = React.useState<readonly InternalTab[]>([]);

  const openTab = React.useCallback((tab: InternalTab) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.href === tab.href);
      if (existing) {
        // Atualiza rótulo/flags preservando posição.
        return prev.map((t) => (t.href === tab.href ? { ...t, ...tab } : t));
      }
      const next = [...prev, tab];
      if (next.length <= MAX_TABS) return next;
      // Despeja a aba mais antiga que não seja a recém-aberta.
      const evictable = next.find((t) => t.href !== tab.href);
      return evictable ? next.filter((t) => t.href !== evictable.href) : next;
    });
  }, []);

  const closeTab = React.useCallback(
    (href: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.href === href);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.href !== href);
        // Se fechou a aba ativa, navega para a vizinha (ou /dashboard).
        if (href === pathname) {
          const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
          router.push(fallback?.href ?? "/dashboard");
        }
        return next;
      });
    },
    [pathname, router],
  );

  // Auto-registra a rota atual como aba ativa (fundação p/ QA do strip).
  React.useEffect(() => {
    if (!pathname) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync da lista de abas com o router/URL (sistema externo); openTab é idempotente por href
    openTab({ href: pathname, label: deriveTabLabel(pathname) });
  }, [pathname, openTab]);

  const value = React.useMemo<InternalTabsContextValue>(
    () => ({ tabs, activeHref: pathname, openTab, closeTab }),
    [tabs, pathname, openTab, closeTab],
  );

  return <InternalTabsContext.Provider value={value}>{children}</InternalTabsContext.Provider>;
}

export function TabStrip() {
  const { tabs, activeHref, closeTab } = useInternalTabs();
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Pestañas abiertas"
      className="flex items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/30 px-2 scrollbar-thin"
    >
      {tabs.map((tab) => {
        const isActive = tab.href === activeHref;
        return (
          <div
            key={tab.href}
            className={cn(
              "group/tab flex max-w-56 shrink-0 items-center gap-1.5 border-b-2 py-1.5 pr-1 pl-2.5 text-[12px]",
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.locked ? (
              <HugeiconsIcon
                icon={SquareLock02Icon}
                strokeWidth={2}
                className="size-3 shrink-0 text-muted-foreground"
              />
            ) : null}
            <Link
              href={tab.href}
              className="truncate"
              title={tab.label}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
              {tab.dirty ? <span className="ml-0.5 text-warning">*</span> : null}
            </Link>
            <button
              type="button"
              aria-label={`Cerrar ${tab.label}`}
              onClick={() => closeTab(tab.href)}
              className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
