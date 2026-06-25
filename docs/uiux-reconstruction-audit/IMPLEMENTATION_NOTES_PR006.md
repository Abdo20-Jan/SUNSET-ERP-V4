# PR-006 — RBAC Foundation · Notas de implementação

> Fundação bloqueante (Wave 0). Cria o **modelo de dados de permissões**, o **motor de
> autorização no backend** e o **wiring de sessão**, de forma **aditiva e backward-compatible**.
> Com os perfis default semeados **e** a flag `RBAC_ENABLED` OFF (default), o sistema se comporta
> **exatamente como hoje**. Não toca nenhum motor de cálculo (Comex, finanças, contabilidade,
> margem, custeio). Regras-fonte: **G-06 / CRIT-10** ("tudo depende de permissão" no FE **e** no BE).

## Por que existe
A autorização hoje é binária (`enum Role { ADMIN USER }` + guards `requireSessionUser`/
`requireAdmin`/`requireAdminPage`). A baseline exige permissões granulares por módulo/página/ação/
campo/informação/documento/relatório/exportação/escopo. Este PR entrega a fundação reutilizável;
PR-007 (PermissionGate FE), PR-009 (página PERM-01), PR-011 (máscara custo/margem) e PR-012
(aprovações) constroem em cima — são PRs separados e **não** fazem parte daqui.

## Modelo de dados (aditivo) — `prisma/schema.prisma`
Migration: **`add_rbac_foundation`** (Prisma Migrate via `pnpm db:migrate`). Apenas
`CREATE TYPE` + 4 `CREATE TABLE` + `ALTER TABLE "User" ADD COLUMN "perfilId"` (nullable) + FK.
Sem DROP, sem NOT NULL novo, sem mudança de tipo → não-destrutivo em prod populada, sem backfill.

- **`enum DimensionPermiso`** — vocabulário das 10 dimensões do spec (`MODULO PAGINA ACCION CAMPO
  INFORMACION DOCUMENTO REPORTE EXPORTACION ESCOPO APROBACION`).
- **`Perfil`** — `codigo` (`@unique`, "ADMIN"/"USER"), `nombre`, `descripcion?`, `esSistema`
  (protege os perfis de sistema de delete/rename na futura UI), `activo`.
- **`Permiso`** — `clave` (`@unique`, ex. `asientos.anular`) + `dimension`. Semeado a partir do
  registry em código (nunca à mão).
- **`PerfilPermiso`** — junção M:N (`@@id([perfilId, permisoId])`, cascade nos dois lados).
- **`UsuarioPermiso`** — override por usuário: `concedido` (true=grant / false=revoke),
  `ambito Json?` (data scope opcional), `expiraEn DateTime?` (permissão temporária),
  `@@unique([usuarioId, permisoId])`.
- **`User`** ganha `perfilId String?` (nullable → sem backfill; null = cai no `role` legacy),
  relação `perfil` (`onDelete: SetNull`) e `usuarioPermisos`. **`enum Role` e `User.role` intactos.**

## Catálogo de permissões — `src/lib/permisos-catalog.ts` (sem `server-only`)
Fonte única da verdade, importada **tanto** pelo engine (server) **quanto** pelo seed (tsx/Node) —
por isso fica **fora** de `server-only`. Exporta `PERMISOS` (refs simbólicas), `PermisoKey`,
`PERMISSION_CATALOG` (clave+dimension+descrição) e `USER_BASE_CLAVES = ["app.acceso"]`.

Catálogo curado (~13 chaves) espelhando os call sites atuais de `requireAdmin` + `app.acceso`
(base/USER) + `admin.acceso` (pilot): `app.acceso`, `admin.acceso`, `asientos.{anular,mover,
cambiarFecha,autoCorregirFecha}`, `periodos.{crear,cerrar,reabrir,cerrarEjercicio,destinarResultado}`,
`percepcionIibb.{recalcular,anularYLiberar}`. Apenas `admin.acceso` é efetivamente aplicado neste
PR (no pilot); as demais são seed-rows + constantes que preparam o PR-008.

## Motor de autorização
Dividido em dois módulos para **quebrar o ciclo de imports** `auth → permisos → auth`:

- **`src/lib/permisos-resolver.ts`** (server-only, **sem** dependência de `@/lib/auth`) — resolução
  pura contra a DB: `loadUserBase` (flag-OFF, só `User`), `loadUserForPermiso` (flag-ON, perfil+
  grants+overrides em nested select), `isAdminScopedKey`, `isAdminFastPath`, `resolveEffectivePermisos`
  e `resolvePermisosParaToken` (usado no login). Importado por `@/lib/auth` **e** por `@/lib/permisos`.
- **`src/lib/permisos.ts`** (server-only) — guards ligados à sessão: `hasPermission`,
  `requirePermission` (irmão de `requireAdmin`, contrato `{ok,error}`), `requirePermissionPage`
  (irmão de `requireAdminPage`, redireciona). Re-exporta `PERMISOS`/`PermisoKey`/`resolvePermisosParaToken`.

### Semântica
- **Flag OFF (default):** reproduz os dois níveis de hoje — chave em `USER_BASE_CLAVES` → qualquer
  usuário ativo; qualquer outra → exige `role === ADMIN`. Usa **só** `db.user.findUnique({select:
  {activo,role}})` (não toca tabelas novas). `requirePermission`/`requirePermissionPage` com chave
  admin **delegam** aos guards legacy → comportamento **byte-idêntico** (mesmos redirects, mesmas
  leituras). Como os guards legacy, o BE **sempre revalida na DB**; nunca confia no JWT.
- **Flag ON:** set efetivo = (grants do perfil) ∪ (overrides `concedido` não-vencidos) − (revokes),
  com **fast-path ADMIN** (role ADMIN **ou** perfil `esSistema` "ADMIN" ⇒ tudo; ADMIN nunca trancado)
  e **fallback por role** quando `perfilId` é null (usuários pré-RBAC seguem idênticos a hoje).
  Perfil inativo não aporta grants; usuário inativo é negado mesmo no fast-path.
- Complexidade ciclomática ≤ 8 por função (helpers extraídos) — gate Codacy.

## Feature flag — `src/lib/features.ts`
`isRbacEnabled()` → `process.env.RBAC_ENABLED === "true"` (default OFF), mesmo padrão dos flags
existentes.

## Wiring de sessão (backward-compatible; campos OPCIONAIS)
- `src/lib/auth.ts` — `authorize()` chama `resolvePermisosParaToken(user.id)` (flag-gated, envolto
  em try/catch no resolver → **nunca quebra o login**) e anexa `permisos?`/`perfilCodigo?` ao retorno.
- `src/lib/auth.config.ts` — `jwt` copia `token.permisos`/`token.perfilCodigo` do `user` (no login);
  `session` copia para `session.user.*`. **`authorized` (gate edge `/admin` por role) inalterado** —
  `auth.config.ts` continua edge-safe (não importa Prisma/`@/lib/permisos`).
- `src/types/next-auth.d.ts` — `permisos?: string[]` e `perfilCodigo?: string` (OPCIONAIS) em `User`,
  `Session.user`, `JWT`. A opcionalidade tolera tokens antigos (campo `undefined`; o BE nunca depende).

## Seed — `prisma/seed.ts`
`seedRbacFoundation()` (idempotente, após `seedAdmin()`): upsert do catálogo (`Permiso` por `clave`),
upsert dos perfis de sistema `ADMIN`/`USER` (`esSistema:true`), grants (ADMIN → todas; USER →
`USER_BASE_CLAVES`), e `user.update` do `admin` → perfil ADMIN. Helpers `upsertPerfilSistema`/
`grantClaves` extraídos. Resultado: acesso **idêntico** ao de hoje out-of-the-box.

## Pilot proof-point
`src/app/(dashboard)/admin/recalcular-percepcion-iibb/page.tsx`: `requireAdminPage()` →
`requirePermissionPage(PERMISOS.ADMIN_ACCESO)`. Flag OFF → delega → idêntico; flag ON + perfis
semeados → ADMIN entra (fast-path), USER vai a `/dashboard`. É o **único** guard religado neste PR.

## Testes — `test/permisos.test.ts`
Espelha `test/auth-guard.test.ts` (mocks `vi.hoisted` de auth/findUnique/redirect; flag via
`process.env.RBAC_ENABLED`). Cobre: flag OFF (dois níveis), delegação flag-OFF, flag ON (fast-path
por role e por perfil, fallback por role, grant via perfil, override expirado/ativo, revoke, perfil
inativo, usuário inativo) e tolerância a tokens antigos nos callbacks. `auth-guard.test.ts` e
`auth-config-authorized.test.ts` permanecem intocados.

## Fora de escopo (PRs seguintes)
PermissionGate FE (PR-007), troca `requireAdmin`→`requirePermission` nas server actions (PR-008),
UI PERM-01 (PR-009), máscara custo/margem (PR-011), engine de aprovações (PR-012), e atualização do
gate edge `/admin` para considerar permissões (hoje segue por role; um USER com `admin.acceso` em
flag-ON ainda é barrado no edge — intencional para este PR de fundação).

## Como ativar (futuro, fora deste PR)
1. Aplicar a migration `add_rbac_foundation` + rodar o seed (perfis/­catálogo).
2. Setar `RBAC_ENABLED=true` (primeiro em staging). Rollback = apagar a flag.
