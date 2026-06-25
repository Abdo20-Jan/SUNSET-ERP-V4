# PR-009 — PERM-01: UI Admin de Usuarios y Permisos

Superfície de administração do RBAC. **Consome** PR-006 (modelo + motor), PR-007 (PermissionGate FE)
e PR-008 (auditoria rica) de forma **aditiva**: não toca `schema.prisma`, o motor RBAC, a forma do
JWT/sessão, nem o comportamento de qualquer página não-admin.

## Decisões (aprovadas pelo dono)

1. **Catálogo & perfis = híbrido.** UI catalog-driven sobre as 13 claves + 10 dimensões já existentes
   (PR-006) **+ seed aditivo idempotente** dos 11 perfis canônicos restantes como *shells*
   (`esSistema=false`, **sem grants**; Master ≈ perfil de sistema `ADMIN`). Não expande
   `permisos-catalog.ts`. O Master configura grants pela própria UI.
2. **Gating = `PERMISOS.ADMIN_ACCESO`.** Com `RBAC_ENABLED` OFF (default) delega a `requireAdmin()` →
   `role===ADMIN` ⇒ só o Master alcança. Zero vocabulário novo; não toca o catálogo.
3. **Data scope = só por-usuário** (`UsuarioPermiso.ambito`). Escopo por-perfil (ANEXO A.4) **não é
   modelado** no PR-006 (`Perfil` não tem `ambito`) → limitação conhecida, sem migration.

## Mapeamento PERM-01 → modelo PR-006

| Requisito | Modelo PR-006 | Status |
|---|---|---|
| 10 dimensões | enum `DimensionPermiso` | ✅ 1:1 |
| 12 perfis canônicos | linhas `Perfil` (Master=ADMIN; 11 via seed) | ✅ dado |
| Matriz perfil×recurso | grants `PerfilPermiso` (binário) | ✅ |
| Override (conceder/revogar) | `UsuarioPermiso.concedido` | ✅ |
| Escopo de dados | `UsuarioPermiso.ambito` (JSON, por-usuário) | ⚠️ por-perfil não modelado |
| Permissão temporária / vence | `UsuarioPermiso.expiraEn`; motor já filtra vencidos | ✅ (sem tocar motor) |
| Histórico de permissões | `AuditLog` (PR-008) | ✅ |
| ⚠ condicional / 🔒 master override | grant binário; 🔒 = fast-path ADMIN do motor | ⚠️ binário; condicional fora do modelo |

## Rotas (todas gated: BE `requirePermissionPage(ADMIN_ACCESO)` + FE `<AdminPageGate>` → PermissionGate "page")

- `/sistema` — índice (Usuarios · Permisos).
- `/sistema/usuarios` — worklist (EnterpriseDataGrid: freeze + filtros rol/perfil + saved-views + EntityLink).
- `/sistema/usuarios/[id]` — ficha (RecordLayout; tabs **General · Permisos · Historial**).
- `/sistema/permisos` — matriz global perfil×clave (10 dimensões); editar grants por perfil em
  FloatingWorkWindow; criar/copiar/renomear perfil; **Exportar matriz** (CSV).

## Arquivos novos

**Backend (`src/lib/`)**
- `services/admin-guard.ts` — `requireAdminAction()` (gate ADMIN_ACCESO), `contarMastersActivos`,
  `validarNoQuitarUltimoMaster` (lockout), `getRequestIp` (IP p/ auditoria sensível).
- `actions/usuarios.ts` — `listarUsuarios`, `obtenerUsuarioPorId`, `crearUsuarioAction`,
  `actualizarUsuarioAction`, `desactivarUsuarioAction`, `asignarPerfilAction`.
- `actions/permisos-admin.ts` — `listarPerfiles`, `listarCatalogoPermisos`, `getMatrizPerfiles`,
  `getOverridesUsuario`, `guardarPermisosPerfilAction`, `crearPerfilAction`, `copiarPerfilAction`,
  `actualizarPerfilAction`, `setPerfilActivoAction`, `setOverrideUsuarioAction`,
  `quitarOverrideUsuarioAction`, `previewPermisosEfectivosAction`, `exportarMatrizAction`.

**UI (`src/app/(dashboard)/sistema/`)**
- `admin-page-gate.tsx`, `permisos-labels.ts` (10 dimensões + agrupamento).
- `usuarios/{page,usuarios-table,usuarios-columns,usuario-form-dialog}.tsx`.
- `usuarios/[id]/{page,usuario-edit-window,usuario-permisos-tab}.tsx`.
- `permisos/{page,permisos-matriz}.tsx`.

**Testes** — `test/usuarios-admin.test.ts`, `test/permisos-admin.test.ts`.

## Arquivos modificados (aditivo)

- `prisma/seed.ts` — `seedPerfilesCanonicos()` (11 shells idempotentes, `update: {}`).
- `src/components/layout/nav-config.ts` — item "Usuarios y permisos" gated por `ADMIN_ACCESO` +
  prefixo `/sistema`.

## Admin actions — chave + auditoria

Toda action: `requireAdminAction()` (gate `ADMIN_ACCESO`) → mutação em `db.$transaction` +
`registrarAuditoria(tx, …)` **dentro** da tx (`origen: MANUAL`, `ip`). `motivo` obrigatório nas
destrutivas.

| Action | tabla | accion | motivo |
|---|---|---|---|
| crear/actualizar/desactivar/asignarPerfil Usuario | `User` | CREATE/UPDATE | desactivar = obrigatório; role/estado = obrigatório |
| guardarPermisosPerfil | `Perfil` | UPDATE | opcional |
| crear/copiar/actualizar/setActivo Perfil | `Perfil` | CREATE/UPDATE | opcional |
| set/quitar override | `UsuarioPermiso` | CREATE/UPDATE/DELETE | **obrigatório** |
| preview (Simular) | `User` | VISUALIZACION_SENSIBLE | — |
| exportar matriz | `Perfil` | EXPORTACION | — |

## Lockout + "Simular"

- **Não rebaixar/desativar o último Master** (`validarNoQuitarUltimoMaster`: conta `role=ADMIN &
  activo`); **não auto-rebaixar/auto-desativar** o próprio Master. Destrutivas exigem confirmação +
  motivo no FE.
- **"Simular" = preview read-only** (`previewPermisosEfectivosAction`): usa o **mesmo** resolver real
  (`loadUserForPermiso` + `resolveEffectivePermisos`), retorna o Set efetivo de claves e o renderiza
  agrupado por dimensão. **Não** é impersonation/login-as; não mexe na sessão/JWT. Auditado como
  `VISUALIZACION_SENSIBLE`. Reflete a configuração RBAC independente do valor atual de `RBAC_ENABLED`.

## Não-objetivos

Sem tocar schema/migrations · sem alterar o motor RBAC ou JWT · sem expandir `permisos-catalog.ts` ·
sem impersonation · sem motor de aprovações (PR-012) · sem página global de auditoria AUD-01 (PR-010)
· sem herança/hierarquia de perfis, alertas de master-override ou automação de expiração (só
armazenamos `expiraEn`; o motor já o respeita) · sem escopo por-perfil · sem mudar comportamento de
páginas não-admin (RBAC_ENABLED segue OFF; nenhum usuário perde acesso; seed dos perfis é inerte).

## Validação

`pnpm prisma generate` · `pnpm typecheck` · `pnpm build` · `pnpm biome:ci` · `pnpm test`.
Testes novos cobrem: gating ADMIN, lockout (último Master / auto-degradação / auto-desativação),
proteção de perfis de sistema, motivo obrigatório em overrides, auditoria do happy path e o preview
read-only.
