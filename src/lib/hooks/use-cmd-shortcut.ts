"use client";

import { useEffect } from "react";

/**
 * Listener global de Cmd/Ctrl+S que dispara el callback. Solo activo si
 * el evento NO viene de un textarea/input editor con Cmd+S nativo.
 * Llama preventDefault para no abrir el "Guardar página" del navegador.
 */
export function useCmdShortcut(
  key: string,
  callback: () => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        callback();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, callback, enabled]);
}
