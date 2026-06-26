"use client";

/**
 * Abas internas (PR-002 Global Shell → cutover PR-015).
 *
 * O `InternalTabsProvider` vive no nível do shell (`AppShell`), logo o estado
 * sobrevive à navegação client-side (o layout do App Router não remonta). A
 * navegação continua sendo roteamento Next normal (`<Link>`/`router`); este
 * componente **não intercepta** nem altera comportamento de página/rota — só
 * mantém o registro das abas abertas e qual está ativa.
 *
 * Suporta `open-record-in-tab`: `openTab()` é exposto p/ o `EntityLink` abrir
 * registros em aba; o `DirtyFooter` marca `dirty` enquanto há mudanças não
 * salvas (indicador `*`).
 *
 * PR-015 (este PR):
 *  - **Persistência** em `sessionStorage` (por janela, padrão SSR-safe via
 *    `useSyncExternalStore`, igual ao `shell-provider`). Flags transitórias
 *    (`dirty`/`locked`/`alert`) são removidas ao persistir → uma aba restaurada
 *    após reload nunca mostra indicador fantasma (o form recarrega limpo).
 *  - **Confirmação de descarte** ao fechar aba `dirty` (Dialog).
 *  - Indicadores `!` (alerta) / `*` (dirty) / cadeado (locked).
 *
 * IMPORTANTE (arquitetura): o **contexto carrega só as AÇÕES** (`openTab`/
 * `closeTab`), com identidade estável; a **lista de abas** é lida do store de
 * módulo via `useSyncExternalStore` (hook separado), de modo que consumidores
 * de ação (`DirtyFooter`/`EntityLink`) NÃO re-disparam seus effects a cada
 * mudança da lista — evita o loop "Maximum update depth" quando o `DirtyFooter`
 * sincroniza `dirty` por effect.
 *
 * DIFERIDO: trava real (`locked`) e origem do `alert` dependem de forms/Record
 * avançado (PR-004) — os campos existem e renderizam, mas ninguém os seta ainda.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { deriveTabLabel } from "@/components/layout/nav-model";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type InternalTab = {
  href: string;
  label: string;
  /** Edição pendente (não confirmada). Pinta o indicador `*`. Setado pelo `DirtyFooter`. */
  dirty?: boolean;
  /** Registro bloqueado/somente leitura. Pinta o cadeado. Wiring → PR-004. */
  locked?: boolean;
  /** Alerta/pendência. Pinta o indicador `!`. Wiring → PR-004. */
  alert?: boolean;
};

/** Teto de abas simultâneas; ao exceder, despeja a mais antiga não-ativa. */
const MAX_TABS = 8;
const STORAGE_KEY = "sunset-erp:tabs";
const EMPTY: InternalTab[] = [];

// ───────────────────────────────────────────────────────────────────────────
// Store de módulo respaldado em sessionStorage, lido via useSyncExternalStore
// (sem setState-em-effect, à prova de SSR/hidratação). Persistência por janela
// (sessionStorage NÃO dispara o evento `storage` p/ o mesmo documento, então
// não há listener cross-tab). Não toca o backend.
// ───────────────────────────────────────────────────────────────────────────
let cache: readonly InternalTab[] | null = null;
let cacheRaw: string | null = null;
const listeners = new Set<() => void>();

function isTabShape(value: unknown): value is InternalTab {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as InternalTab).href === "string" &&
    typeof (value as InternalTab).label === "string"
  );
}

/** Versão persistível: só href+label (descarta flags transitórias dirty/locked/alert). */
function persistable(tab: InternalTab): InternalTab {
  return { href: tab.href, label: tab.label };
}

/** Lê do sessionStorage com cache pela string crua → referência estável entre renders. */
function read(): readonly InternalTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === cacheRaw && cache) return cache;
    cacheRaw = raw;
    if (!raw) {
      cache = EMPTY;
      return cache;
    }
    const parsed: unknown = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed.filter(isTabShape) : EMPTY;
    return cache;
  } catch {
    cache = EMPTY;
    return cache;
  }
}

function emit() {
  for (const l of listeners) l();
}

function write(next: readonly InternalTab[]) {
  cache = next;
  try {
    cacheRaw = JSON.stringify(next.map(persistable));
    sessionStorage.setItem(STORAGE_KEY, cacheRaw);
  } catch {
    // ignora erros de quota/privacidade
  }
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getServerSnapshot(): readonly InternalTab[] {
  return EMPTY;
}

/** `true` se a aba existente já tem exatamente os mesmos campos do alvo. */
function sameTab(a: InternalTab, b: InternalTab): boolean {
  return a.label === b.label && a.dirty === b.dirty && a.locked === b.locked && a.alert === b.alert;
}

/**
 * Aplica a abertura/atualização de uma aba (idempotente por href) com teto MAX_TABS.
 * Retorna a MESMA referência `prev` quando nada muda — assim `openTab` evita um
 * `write`/`emit` redundante (e re-render) quando o `DirtyFooter` reenvia o mesmo estado.
 */
function applyOpen(prev: readonly InternalTab[], tab: InternalTab): readonly InternalTab[] {
  const existing = prev.find((t) => t.href === tab.href);
  if (existing) {
    if (sameTab(existing, tab)) return prev;
    return prev.map((t) => (t.href === tab.href ? { ...t, ...tab } : t));
  }
  const next = [...prev, tab];
  if (next.length <= MAX_TABS) return next;
  // Despeja a aba mais antiga que não seja a recém-aberta.
  const evictable = next.find((t) => t.href !== tab.href);
  return evictable ? next.filter((t) => t.href !== evictable.href) : next;
}

/** Só as AÇÕES (identidade estável). A lista de abas vem do store, não daqui. */
type InternalTabsActions = {
  openTab: (tab: InternalTab) => void;
  closeTab: (href: string) => void;
};

const InternalTabsContext = React.createContext<InternalTabsActions | null>(null);

export function useInternalTabs(): InternalTabsActions {
  const ctx = React.useContext(InternalTabsContext);
  if (!ctx) {
    throw new Error("useInternalTabs deve ser usado dentro de <InternalTabsProvider>.");
  }
  return ctx;
}

/**
 * Variante não-quebrante de {@link useInternalTabs}: retorna `null` quando NÃO
 * há `<InternalTabsProvider>` na árvore (ex.: shell legado com `TOP_NAV_ENABLED=false`).
 * Permite que consumidores opcionais — como o `EntityLink`/`DirtyFooter` — usem
 * `openTab` quando o top-nav está ligado e degradem para navegação normal quando
 * está desligado, sem lançar erro. As ações têm identidade estável (ver doc do topo).
 */
export function useInternalTabsOptional(): InternalTabsActions | null {
  return React.useContext(InternalTabsContext);
}

/** Lê a lista de abas do store (reativo). Usado só pela `TabStrip`. */
function useTabsSnapshot(): readonly InternalTab[] {
  return React.useSyncExternalStore(subscribe, read, getServerSnapshot);
}

export function InternalTabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const openTab = React.useCallback((tab: InternalTab) => {
    const prev = read();
    const next = applyOpen(prev, tab);
    if (next !== prev) write(next);
  }, []);

  const closeTab = React.useCallback(
    (href: string) => {
      const prev = read();
      const idx = prev.findIndex((t) => t.href === href);
      if (idx === -1) return;
      const next = prev.filter((t) => t.href !== href);
      write(next);
      // Se fechou a aba ativa, navega para a vizinha (ou /dashboard).
      if (href === pathname) {
        const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
        router.push(fallback?.href ?? "/dashboard");
      }
    },
    [pathname, router],
  );

  // Auto-registra a rota atual como aba ativa. `openTab` escreve no store de módulo
  // (não é um setState do React) e o provider NÃO assina o store, então isto não
  // re-renderiza a árvore nem dispara react-hooks/set-state-in-effect.
  React.useEffect(() => {
    if (!pathname) return;
    openTab({ href: pathname, label: deriveTabLabel(pathname) });
  }, [pathname, openTab]);

  // Identidade estável: muda só quando `closeTab` muda (pathname/router), nunca
  // quando a lista de abas muda. É o que quebra o loop com o `DirtyFooter`.
  const actions = React.useMemo<InternalTabsActions>(
    () => ({ openTab, closeTab }),
    [openTab, closeTab],
  );

  return <InternalTabsContext.Provider value={actions}>{children}</InternalTabsContext.Provider>;
}

export function TabStrip() {
  const tabs = useTabsSnapshot();
  const activeHref = usePathname();
  const { closeTab } = useInternalTabs();
  const [pendingCloseHref, setPendingCloseHref] = React.useState<string | null>(null);

  // Fechar aba `dirty` exige confirmação (SHELL-01 / 05_WORKLIST_PATTERN); senão fecha direto.
  const requestClose = React.useCallback(
    (tab: InternalTab) => {
      if (tab.dirty) {
        setPendingCloseHref(tab.href);
        return;
      }
      closeTab(tab.href);
    },
    [closeTab],
  );

  const confirmClose = React.useCallback(() => {
    if (pendingCloseHref) closeTab(pendingCloseHref);
    setPendingCloseHref(null);
  }, [pendingCloseHref, closeTab]);

  if (tabs.length === 0) return null;

  return (
    <>
      <nav
        aria-label="Pestañas abiertas"
        className="flex items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/30 px-2 scrollbar-thin"
      >
        {tabs.map((tab) => (
          <TabStripItem
            key={tab.href}
            tab={tab}
            isActive={tab.href === activeHref}
            onRequestClose={requestClose}
          />
        ))}
      </nav>

      <Dialog
        open={pendingCloseHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCloseHref(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Descartar cambios?</DialogTitle>
            <DialogDescription>
              Esta pestaña tiene cambios sin guardar. Si la cierras, se perderán.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingCloseHref(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmClose}>
              Descartar y cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TabStripItem({
  tab,
  isActive,
  onRequestClose,
}: {
  tab: InternalTab;
  isActive: boolean;
  onRequestClose: (tab: InternalTab) => void;
}) {
  return (
    <div
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
        {tab.alert ? <span className="ml-0.5 text-destructive">!</span> : null}
        {tab.dirty ? <span className="ml-0.5 text-warning">*</span> : null}
      </Link>
      <button
        type="button"
        aria-label={`Cerrar ${tab.label}`}
        onClick={() => onRequestClose(tab)}
        className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
      </button>
    </div>
  );
}
