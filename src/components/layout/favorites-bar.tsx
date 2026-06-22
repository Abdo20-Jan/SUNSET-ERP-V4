"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon, Cancel01Icon } from "@hugeicons/core-free-icons";

import { useShell } from "@/components/layout/shell-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botão de favoritar/desfavoritar a página atual. Renderizado ao lado do
 * breadcrumb. Inativo quando não há rótulo derivável para a rota.
 */
export function FavoriteToggle({ href, label }: { href: string; label: string }) {
  const { isFavorite, toggleFavorite, hydrated } = useShell();
  const active = isFavorite(href);
  const disabled = !label;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-pressed={active}
      aria-label={active ? "Quitar de favoritos" : "Agregar a favoritos"}
      title={active ? "Quitar de favoritos" : "Agregar a favoritos"}
      disabled={disabled}
      onClick={() => label && toggleFavorite({ href, label })}
      className={cn(
        "shrink-0",
        // evita flash antes de hidratar o estado persistido
        hydrated && active ? "text-amber-500 hover:text-amber-500" : "text-muted-foreground",
      )}
    >
      <HugeiconsIcon icon={StarIcon} className="size-3.5" />
    </Button>
  );
}

/**
 * Barra de favoritos: chips navegáveis das páginas marcadas pelo usuário.
 * Só aparece quando há favoritos (após hidratar do localStorage).
 */
export function FavoritesBar() {
  const { favorites, hydrated, removeFavorite } = useShell();
  const pathname = usePathname();

  if (!hydrated || favorites.length === 0) return null;

  return (
    <nav
      aria-label="Favoritos"
      className="scrollbar-thin flex h-7 items-center gap-1 overflow-x-auto border-t border-border/60 px-3 text-[12px]"
    >
      <span className="flex shrink-0 items-center gap-1 pr-1 text-muted-foreground/70">
        <HugeiconsIcon icon={StarIcon} className="size-3" />
        <span className="hidden sm:inline">Favoritos</span>
      </span>
      {favorites.map((fav) => {
        const active = pathname === fav.href;
        return (
          <span
            key={fav.href}
            className={cn(
              "group/fav flex shrink-0 items-center rounded-sm",
              active ? "bg-accent text-foreground" : "bg-muted/50 text-muted-foreground",
            )}
          >
            <Link
              href={fav.href}
              className="max-w-[16rem] truncate py-0.5 pl-1.5 pr-1 transition-colors hover:text-foreground"
              aria-current={active ? "page" : undefined}
            >
              {fav.label}
            </Link>
            <button
              type="button"
              aria-label={`Quitar ${fav.label} de favoritos`}
              onClick={() => removeFavorite(fav.href)}
              className="mr-0.5 flex size-4 items-center justify-center rounded-sm text-muted-foreground/50 opacity-0 transition-opacity hover:bg-border hover:text-foreground focus-visible:opacity-100 group-hover/fav:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
