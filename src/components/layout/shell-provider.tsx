"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Favorite = { href: string; label: string };

const STORAGE_KEY = "sunset-erp:favoritos";
const MAX_FAVORITES = 12;

type ShellContextValue = {
  /** Favoritos persistidos por usuário (localStorage). */
  favorites: Favorite[];
  /** Indica se a já hidratamos do localStorage (evita flash/SSR mismatch). */
  hydrated: boolean;
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

function isFavoriteShape(value: unknown): value is Favorite {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Favorite).href === "string" &&
    typeof (value as Favorite).label === "string"
  );
}

/**
 * Estado de shell compartilhado pelo dashboard. Hoje guarda os Favoritos
 * (persistidos em localStorage, sem tocar o backend). Ponto de extensão
 * para abas internas / janelas flutuantes / moeda de apresentação nas
 * próximas fases do rebuild.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hidrata uma vez a partir do localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setFavorites(parsed.filter(isFavoriteShape));
      }
    } catch {
      // localStorage indisponível ou corrompido → começa vazio.
    }
    setHydrated(true);
  }, []);

  // Persiste a cada mudança (somente após hidratar, para não sobrescrever).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // ignora erros de quota/privacidade.
    }
  }, [favorites, hydrated]);

  const isFavorite = useCallback(
    (href: string) => favorites.some((f) => f.href === href),
    [favorites],
  );

  const toggleFavorite = useCallback((fav: Favorite) => {
    setFavorites((prev) => {
      if (prev.some((f) => f.href === fav.href)) return prev.filter((f) => f.href !== fav.href);
      return [...prev, fav].slice(-MAX_FAVORITES);
    });
  }, []);

  const removeFavorite = useCallback((href: string) => {
    setFavorites((prev) => prev.filter((f) => f.href !== href));
  }, []);

  return (
    <ShellContext.Provider
      value={{ favorites, hydrated, isFavorite, toggleFavorite, removeFavorite }}
    >
      {children}
    </ShellContext.Provider>
  );
}
