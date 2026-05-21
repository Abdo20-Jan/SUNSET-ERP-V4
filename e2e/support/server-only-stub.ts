// Stub vacío para neutralizar `import "server-only"` bajo Playwright.
//
// El paquete real (lo provee Next) lanza en tiempo de import fuera del runtime
// server de Next. Los specs e2e ejercen los services directamente contra la BD
// efímera (sin frontera server/client), así que acá no hace nada. Es el análogo
// de `test/stubs/server-only.ts` usado por la suite vitest.
export {};
