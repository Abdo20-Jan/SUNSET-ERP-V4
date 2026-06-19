"use client";

import { useEffect } from "react";

// Boundary de último recurso: cubre errores que rompen el root layout. Acá NO
// aplican los estilos globales / Tailwind (este componente REEMPLAZA al root
// layout y renderiza su propio <html>/<body>), así que usamos estilos inline
// mínimos y NO el componente <RouteError>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] route error", error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div
          style={{
            fontFamily: "system-ui, sans-serif",
            maxWidth: "640px",
            margin: "0 auto",
            padding: "2rem",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>No se pudo cargar la aplicación</h1>
          <p style={{ marginTop: "1rem", color: "#555" }}>Detalle: {error.message}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              border: "1px solid #ccc",
              borderRadius: "0.375rem",
              background: "#f5f5f5",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
