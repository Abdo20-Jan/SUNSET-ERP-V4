"use client";

/**
 * EntityLink (PR-003 — Worklist Infra). Identificador clicável com **chevron**
 * de drill-down, conforme a baseline (PAGE-STD-01): a 1ª/2ª coluna da worklist
 * abre a ficha/registro relacionado.
 *
 * Integração com abas internas (decisão do dono): usa `useInternalTabsOptional()`
 * — quando o `<InternalTabsProvider>` existe (top-nav `TOP_NAV_ENABLED=ON`), o
 * clique pré-registra a aba via `openTab()` e navega; quando NÃO existe (shell
 * legado/sidebar), degrada para navegação normal sem erro. Ctrl/Cmd/clique do
 * meio abrem nova aba do navegador (âncora nativa).
 *
 * **Route-safe:** quando não há `href` (entidade sem rota de ficha — ex.: o
 * piloto de produtos edita por diálogo), usa `onOpen` e nunca aponta para uma
 * rota inexistente.
 */

import * as React from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { useInternalTabsOptional } from "@/components/layout/internal-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type EntityLinkMenuItem = {
  label: string;
  /** Ação ao selecionar (sem navegação). */
  onSelect?: () => void;
  /** Rota de destino (renderiza o item como link). */
  href?: string;
  disabled?: boolean;
  /** Texto auxiliar à direita (ex.: "Pronto" p/ itens futuros). */
  hint?: string;
};

export type EntityLinkProps = {
  label: React.ReactNode;
  /** Rota de destino do drill-down. Ausente → usa apenas `onOpen`. */
  href?: string;
  /** Ação primária quando não há rota (ex.: abrir diálogo de edição). */
  onOpen?: () => void;
  /** Rótulo da aba interna (default = `label`, se for string). */
  tabLabel?: string;
  /** Itens do menu do chevron (drill-down). */
  menu?: EntityLinkMenuItem[];
  className?: string;
};

export function EntityLink({ label, href, onOpen, tabLabel, menu, className }: EntityLinkProps) {
  const tabs = useInternalTabsOptional();
  const resolvedTabLabel = tabLabel ?? (typeof label === "string" ? label : undefined);

  const handlePrimaryClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Modificadores → deixa o navegador abrir em nova aba/janela (âncora nativa).
    if (e.metaKey || e.ctrlKey || e.button !== 0) return;
    if (href && tabs && resolvedTabLabel) {
      tabs.openTab({ href, label: resolvedTabLabel });
    }
  };

  const identifierClass =
    "truncate font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:underline outline-none";

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {href ? (
        <Link
          href={href}
          onClick={handlePrimaryClick}
          className={identifierClass}
          title={resolvedTabLabel}
        >
          {label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className={cn(identifierClass, "cursor-pointer bg-transparent p-0")}
        >
          {label}
        </button>
      )}

      {menu && menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Más acciones de la entidad"
                className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
              />
            }
          >
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {menu.map((item) =>
              item.href && !item.disabled ? (
                <DropdownMenuItem key={item.label} render={<Link href={item.href} />}>
                  {item.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={item.label} disabled={item.disabled} onClick={item.onSelect}>
                  <span>{item.label}</span>
                  {item.hint ? (
                    <span className="ml-auto pl-3 text-[10px] tracking-wide text-muted-foreground uppercase">
                      {item.hint}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  );
}
