# NS-3 PR-3 · SavedView (vistas salvas pessoais) — Implementation Plan

> **For agentic workers:** execução inline (executing-plans). Trabalho acoplado/sequencial.

**Goal:** vistas salvas pessoais (filtros `q`+filtro próprio, `sort`/`dir`, `columnVisibility`) por rota, com uma marcável como padrão (auto-aplicada ao abrir a rota sem filtros). Aplicado aos 3 maestros (productos/clientes/proveedores).

**Architecture:** model `SavedView` novo via **Prisma Migrate** (1º NS-3 que toca o DB). Helper puro (TDD) serializa/desserializa a config. Server actions escopadas a `requireSessionUser()`. Componente client `SavedViews` no toolbar lê/grava a URL + `columnVisibility`. Vista padrão aplicada via `router.replace` no mount do `SavedViews`.

**Tech Stack:** Prisma 7.8 (generator `prisma-client` → `src/generated/prisma`), Next 16 RSC, @tanstack/react-table v8, @base-ui/react, vitest (node-only).

## Global Constraints
- Migration via `prisma migrate dev` (NUNCA `db push`); gerar num `postgres:18-alpine` descartável; commit → `migrate-deploy.yml` aplica em prod. Baseline `0_init` já resolvido em prod.
- Client Prisma é `db` (Proxy de `@/lib/db`); usuário logado = `requireSessionUser()` de `@/lib/auth-guard` (retorna `string`).
- `no-explicit-any` é ERRO de eslint. Helper puro sem dep de react-table (usar `Record<string,boolean>`).
- Rodar `pnpm build` antes do PR (actions em arquivo `"use server"` só podem exportar async; sem route handler novo neste PR, mas confirmar).
- Toolbar dos 3 maestros: `DataTableSearch` + `Select`(filtro) + `ColumnsToggle` + `ExportButton` + `Button`(novo). `SavedViews` entra entre `ColumnsToggle` e `ExportButton`.

---

### Task 1: Schema + migration
**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<ts>_add_saved_views/migration.sql`.

```prisma
model SavedView {
  id               String   @id @default(uuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ruta             String
  nombre           String
  config           Json
  esPredeterminada Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([userId, ruta, nombre])
  @@index([userId, ruta])
}
```
+ em `model User`: `savedViews SavedView[]`.

Gerar: subir `postgres:18-alpine` descartável, `DATABASE_URL=... pnpm prisma migrate dev --name add_saved_views`. Verificar o SQL (CREATE TABLE + FK ON DELETE CASCADE + 2 índices). Derrubar o container.

### Task 2: Helper puro `src/lib/saved-views.ts` (TDD)
`SavedViewConfig = { params: Record<string,string>; columns: Record<string,boolean> }`.
- `buildViewConfig(searchParams, columnVisibility)` → descarta `page`/`perPage`/`formato` e valores vazios.
- `viewConfigToSearchParams(config)` → `URLSearchParams` (mesma exclusão).
- `hayParamsDeVista(searchParams)` → bool (algum param que não seja paginação/formato).
- `coerceViewConfig(value: unknown)` → SavedViewConfig defensivo (Json malformado → vazio).
Testes em `test/saved-views.test.ts` (round-trip, exclusão de page/perPage, coerce de lixo).

### Task 3: Server actions `src/lib/actions/saved-views.ts`
`listarVistas(ruta)` · `guardarVista({ruta,nombre,config,esPredeterminada})` (upsert no unique; tx desmarca outras padrão) · `eliminarVista(id)` (deleteMany scoped userId) · `definirPredeterminada(id,valor)` (tx). `revalidatePath` nas mutações.

### Task 4: Componente `src/components/ui/saved-views.tsx`
Props `{ ruta, vistas, columnVisibility, onApplyColumns }`. Dropdown "Vistas" (Layers01Icon): lista (aplicar=push URL+setColumns; toggle padrão=StarIcon; excluir=Delete02Icon) + "Guardar vista actual…" (dialog: Input nombre + Checkbox padrão). Auto-padrão: `useEffect` once → se `!hayParamsDeVista` e existe padrão → `router.replace` + `onApplyColumns`.

### Task 5: Fiação nos 3 maestros
Em cada `page.tsx`: `const vistas = await listarVistas("/maestros/<x>")` e passar `vistas` à tabela. Em cada `*-table.tsx`: receber `vistas`, renderizar `<SavedViews ruta={pathname} vistas={vistas} columnVisibility={columnVisibility} onApplyColumns={setColumnVisibility} />` no toolbar.

### Gates
typecheck · eslint · biome (só arquivos do escopo) · vitest · `pnpm build`. Review adversarial opus whole-branch → PR → auto-merge.

### Limitação conhecida
Vista padrão aplica via `replace` no mount → flash breve no 1º load (set de dados igual; só muda sort/colunas/filtro). Variante flashless server-side fica para depois.
