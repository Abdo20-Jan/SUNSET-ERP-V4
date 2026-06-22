"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

export type Favorite = { href: string; label: string };

const STORAGE_KEY = "sunset-erp:favoritos";
const MAX_FAVORITES = 12;
const EMPTY: Favorite[] = [];

// Store de módulo respaldado em localStorage, lido via useSyncExternalStore
// (sem setState-em-effect, à prova de SSR/hidratação). Não toca o backend.
let cache: Favorite[] | null = null;
let cacheRaw: string | null = null;
const listeners = new Set<() => void>();

function isFavoriteShape(value: unknown): value is Favorite {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Favorite).href === "string" &&
    typeof (value as Favorite).label === "string"
  );
}

/** Lê do localStorage com cache pela string crua → referência estável entre renders. */
function read(): Favorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cacheRaw && cache) return cache;
    cacheRaw = raw;
    if (!raw) {
      cache = EMPTY;
      return cache;
    }
    const parsed: unknown = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed.filter(isFavoriteShape) : EMPTY;
    return cache;
  } catch {
    cache = EMPTY;
    return cache;
  }
}

function emit() {
  for (const l of listeners) l();
}

function write(next: Favorite[]) {
  cache = next;
  try {
    cacheRaw = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, cacheRaw);
  } catch {
    // ignora erros de quota/privacidade
  }
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      cacheRaw = null;
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Favorite[] {
  return read();
}

function getServerSnapshot(): Favorite[] {
  return EMPTY;
}

type ShellContextValue = {
  /** Favoritos persistidos por usuário (localStorage). */
  favorites: Favorite[];
  isFavorite: (href: string) => boolean;
  /** Alterna o favorito: adiciona se ausente, remove se presente. */
  toggleFavorite: (fav: Favorite) => void;
  removeFavorite: (href: string) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell deve ser usado dentro de <ShellProvider>");
  return ctx;
}

/**
 * Estado de shell compartilhado pelo dashboard. Hoje guarda os Favoritos
 * (localStorage, sem tocar o backend). Ponto de extensão para abas internas /
 * janelas flutuantes / moeda de apresentação nas próximas fases do rebuild.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<ShellContextValue>(
    () => ({
      favorites,
      isFavorite: (href) => favorites.some((f) => f.href === href),
      toggleFavorite: (fav) =>
        write(
          favorites.some((f) => f.href === fav.href)
            ? favorites.filter((f) => f.href !== fav.href)
            : [...favorites, fav].slice(-MAX_FAVORITES),
        ),
      removeFavorite: (href) => write(favorites.filter((f) => f.href !== href)),
    }),
    [favorites],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
