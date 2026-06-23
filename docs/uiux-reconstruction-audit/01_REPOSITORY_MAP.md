# 01 — Mapa do Repositório (`sunset-erp-v4`)

## Framework & toolchain

| Item | Valor |
|---|---|
| Framework | **Next.js 16** (App Router, Turbopack em dev e build) |
| Linguagem | TypeScript 5 (strict), alias `@/*` → `./src/*` ([tsconfig.json](../../tsconfig.json)) |
| Gerenciador de pacotes | **pnpm 10.32.x** (`pnpm-lock.yaml`) |
| UI runtime | React 19.2 |
| Component system | **shadcn/ui** (`base-maia`), ícones **Hugeicons** ([components.json](../../components.json)) |
| Styling | **Tailwind CSS 4** + `@tailwindcss/postcss`; tokens OKLCH |
| Tabelas | `@tanstack/react-table` 8 + `@tanstack/react-virtual` 3 |
| Forms | React Hook Form 7 + Zod 4 |
| Auth | **NextAuth v5** (Credentials, JWT session) |
| ORM | **Prisma 7.8** + `@prisma/adapter-pg` (PostgreSQL) |
| Money | `decimal.js` |
| PDF | `pdf-lib` (certificados de retención) |
| Charts | `recharts` |
| Toaster | `sonner` |
| Lint/format | ESLint 9 (`eslint-config-next`) + **Biome 2.5** (100 col) |
| Testes | **Vitest 3** (unit/integração, Testcontainers Postgres) + **Playwright 1.61** (e2e service-level) |
| Hooks | Husky + lint-staged |
| Deploy | Vercel (Analytics, Speed Insights, Blob) |

## Comandos (package.json scripts)

| Ação | Comando |
|---|---|
| Dev | `pnpm dev` (`next dev --turbopack`) |
| Build | `pnpm build` (`next build --turbopack`) |
| Lint | `pnpm lint` (eslint) · `pnpm biome:check` · `pnpm biome:ci` |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| Testes unit | `pnpm test` (`vitest run`) · `pnpm test:watch` |
| Testes e2e | `pnpm test:e2e` (`NODE_OPTIONS="--import tsx" playwright test`) |
| DB | `pnpm db:push` · `db:migrate` · `db:seed` · `db:backup:prod` · etc. |

> ⚠️ **`vitest run` NÃO executa os e2e Playwright.** Após mexer no motor COMEX/contábil, rodar `pnpm test:e2e` separadamente (requer Docker). Confirmado em scripts e em memória de projeto.

## Estrutura de pastas (níveis relevantes)

```
src/
├── app/
│   ├── layout.tsx                      # root: fontes (Figtree/Geist Mono), Analytics, Sonner
│   ├── globals.css                     # tokens OKLCH, tema warm-light, --radius 0.4rem
│   ├── page.tsx                        # redirect
│   ├── (auth)/layout.tsx + login/      # grupo de auth
│   ├── (dashboard)/layout.tsx          # SidebarProvider + AppSidebar + AppHeader (← G-02)
│   │   ├── dashboard/ bi/ crm/ ventas/ entregas/ compras/ inventario/
│   │   ├── comex/ tesoreria/ gastos/ gastos-fijos/ contabilidad/ reportes/
│   │   ├── maestros/ perfil/ admin/
│   │   └── <módulo>/_components/        # componentes co-localizados por rota
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── comex/divergencia/upload/route.ts
│       ├── cron/cleanup-despachos-borrador/route.ts
│       └── retenciones/[id]/certificado/route.ts
├── components/
│   ├── layout/                         # app-sidebar, app-header, nav-items, breadcrumb, user-menu, page-header
│   ├── ui/                             # ~35 primitivos shadcn (button, dialog, sheet, table, data-table, command, chart, sidebar…)
│   └── form/                           # field-error
├── lib/
│   ├── actions/                        # ~54 server actions ("use server") — camada de mutação
│   ├── services/                       # ~44 serviços de negócio (motor contábil, comex, tesouraria, reportes)
│   ├── auth.ts · auth.config.ts · auth-guard.ts   # autenticação/autorização
│   ├── db.ts                           # Prisma client com retry (proxy)
│   └── empresa.ts
├── generated/prisma/                   # client Prisma gerado
├── hooks/  · types/                    # hooks e tipos (next-auth.d.ts)
prisma/schema.prisma                    # ~2.495 linhas, ~72 models
test/                                   # ~80 specs Vitest
e2e/                                    # 5 specs Playwright (service-level) + tsconfig próprio
```

## Rotas (App Router)

- **Grupos:** `(auth)` (login) e `(dashboard)` (protegido por sessão no layout).
- **~94 `page.tsx`** sob `(dashboard)` — inventário completo em [02_CURRENT_ROUTE_PAGE_INVENTORY.md](02_CURRENT_ROUTE_PAGE_INVENTORY.md).
- **Shell global:** [src/app/(dashboard)/layout.tsx](<../../src/app/(dashboard)/layout.tsx>) monta `SidebarProvider` + [app-sidebar.tsx](../../src/components/layout/app-sidebar.tsx) + [app-header.tsx](../../src/components/layout/app-header.tsx). Navegação definida em [nav-items.ts](../../src/components/layout/nav-items.ts) (4 grupos: General, Operación, Contabilidad, Maestros). **É um sidebar lateral — diverge de SHELL-01/G-02.**

## Backend / camada de dados

- **Server Actions** (`src/lib/actions/*.ts`, `"use server"`) são a camada de mutação primária; chamam serviços e fazem `revalidatePath`/`revalidateTag`.
- **Server Components** consultam Prisma direto via `db` (proxy com retry em [src/lib/db.ts](../../src/lib/db.ts)).
- **API Routes** apenas para NextAuth, upload de divergência, cron e download de certificado PDF.
- Sem REST/GraphQL público; contratos = assinaturas das actions/serviços.

## Banco / ORM

- Prisma 7.8 → PostgreSQL. Schema em [prisma/schema.prisma](../../prisma/schema.prisma) (~72 models).
- Grupos de domínio: **Contabilidad** (`CuentaContable`, `PeriodoContable`, `Asiento`, `LineaAsiento`), **Tesorería** (`CuentaBancaria`, `MovimientoTesoreria`, `PrestamoExterno`, `AnticipoProveedor`), **Comex** (`Embarque`, `EmbarqueCosto`, `Despacho`, `Contenedor`, `Desconsolidacion`, `DivergenciaInvestigacion`), **Compras/Ventas** (`Compra`, `Venta`, `PedidoVenta`, `EntregaVenta`), **Inventario** (`Producto`, `Deposito`, `StockPorDeposito`, `MovimientoStock`), **Maestros/Fiscal** (`Cliente`, `Proveedor`, `ParametroRetencion`, `RetencionPracticada`, `JurisdiccionIIBB`), **Auditoría** (`AuditLog`).

## Styling / tema

- Tokens em [src/app/globals.css](../../src/app/globals.css) (OKLCH, paleta warm-light/"paper", `--radius: 0.4rem`, `--chart-1..5`, vars de sidebar).
- Sem pasta dedicada de design tokens fora do `globals.css`; densidade/linha não parametrizadas como tokens (gap vs DESIGN-SYSTEM 32px linha / 13px fonte / 28-30 linhas em 1080p).
- shadcn `base-maia` + Hugeicons. Não há componentes canônicos da baseline (`EnterpriseDataGrid`, `FloatingWorkWindow`, etc.).

## Estado

- Sem store global (sem Redux/Zustand). `useState`/`useTransition` locais + React Hook Form; cache de servidor via `revalidate*`.

## Testes

- **Vitest:** ~80 specs em [test/](../../test/) (motor contábil, stock, despacho parcial, contenedor, divergencia D9, flujo-caja, guards de período/anulação). Config: [vitest.config.ts](../../vitest.config.ts), Testcontainers Postgres por suite, `server-only` stubado.
- **Playwright (e2e):** 5 specs em [e2e/](../../e2e/) — **service-level, sem browser** (exercitam actions/serviços contra Postgres efêmero). Config: [playwright.config.ts](../../playwright.config.ts), serial, 1 worker.
- **Sem testes de UI/visuais/snapshot** e **sem testes de permissão de campo** — gaps em [09_TESTING_QA_AUDIT.md](09_TESTING_QA_AUDIT.md).

## Configs relevantes

`next.config.ts` · `tsconfig.json` · `biome.json` · `eslint.config.mjs` · `postcss.config.mjs` · `components.json` · `vitest.config.ts` · `playwright.config.ts` · `prisma/schema.prisma` · `e2e/tsconfig.json`.
