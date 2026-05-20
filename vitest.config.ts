import { resolve } from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Infra de teste de la Onda 2 (Comex ZPA).
//
// Los servicios y helpers que probamos importan `server-only` (asiento-automatico,
// stock, features). Ese módulo lanza fuera del runtime server de Next, así que lo
// aliasamos a un stub vacío. Los tests de integración levantan un Postgres real vía
// Testcontainers (ver `test/db.ts`) — requieren Docker corriendo en local; en CI el
// runner ubuntu ya trae Docker.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Levantar el contenedor + `prisma db push` puede tardar; damos margen.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
