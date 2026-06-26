# Triagem de Implementação — PR-001 → PR-012 (2026-06-25)

> Estado real da reconstrução UI/UX + RBAC/Auditoria/Aprovações depois da **Onda 0/1**.
> Cruza `IMPLEMENTATION_NOTES_PRxxx.md` + histórico git + presença em `main`. **Read-only**:
> não toca a baseline congelada do vault (`reports/BASELINE_LOCK`, specs, `REQUIREMENTS_TRACEABILITY_SEED`).
> Companheiro de [12_TRACEABILITY_MATRIX_AUDITED.md](12_TRACEABILITY_MATRIX_AUDITED.md) (status por requisito) e
> [10_PR_ROADMAP.md](10_PR_ROADMAP.md) (próximas ondas).

## 1. Estado da DB — "onde paramos de atualizar ela"

**Prod está SINCRONIZADA.** A última migration aplicada é `20260625221138_add_approvals_engine` (PR-012).
O Action `migrate-deploy.yml` (dispara em `push` para `main` quando muda `prisma/migrations/**`) rodou
**success** para todos os PRs de schema. Não há nada pendente de aplicar.

| # | Migration | PR / commit | migrate-deploy |
|---|---|---|---|
| 1 | `0_init` (baseline E13) | #244 | ✅ (baseline via `migrate resolve --applied 0_init`) |
| 2 | `20260618020446_add_anticipo_proveedor` | #251 | ✅ |
| 3 | `20260619031437_add_plan_de_cuentas_9_clases` | #269 | ✅ |
| 4 | `20260619212002_add_saved_views` | #294 (NS-3) | ✅ |
| 5 | `20260625002332_add_rbac_foundation` | **PR-006** #332 | ✅ |
| 6 | `20260625030638_add_audit_metadata` | **PR-008** #334 | ✅ |
| 7 | `20260625221138_add_approvals_engine` | **PR-012** #338 | ✅ (2026-06-25, 25s) |

Notas:
- Só **PR-006 / PR-008 / PR-012** tocaram o schema. **PR-007/009/010/011** são FE / dados de
  catálogo / mascaramento → **sem migration**.
- Pré-E13 (≤ #243) as mudanças de schema usavam `prisma db push` direto; o `0_init` capturou
  esse estado como baseline. Depois de E13 o fluxo é **sempre** `pnpm db:migrate` → merge →
  `migrate-deploy` aplica em prod (ver memória `feedback_schema_pr_requires_db_push_prod`).
- A migration do PR-012 foi gerada contra um **Postgres local descartável** (nunca prod).

## 2. Status por PR (PR-001 → PR-012)

Legenda: ✅ em `main` · ◐ parcial · 🚩 construído porém atrás de feature-flag (default OFF).

| PR | Entrega | Status | Evidência em `main` |
|---|---|---|---|
| **PR-001** Design Foundation | tokens densidade/cor/tipografia, dark mode, status-badge | ✅ (via **NS-1**: #276 ⌘K+dark, #277 status-badge, #281 paginação) | `globals.css`, `components/ui/status-badge` |
| **PR-002** Shell / Top-Nav | AppShell + top-nav textual + mega-menú + abas + ⌘K + overviews | ✅ (via **NS-2**: cutover topnav #267, overviews #268/271/272/275) | `components/layout/app-shell.tsx` |
| **PR-003** EnterpriseDataGrid | grid sort/colunas/export CSV-XLSX/vistas salvas | ✅ (via **NS-3**: #284/#287/#292/#294) | `components/data-grid/enterprise-data-grid.tsx` |
| **PR-004** Record Pattern / FWW | RecordLayout/Section/ActionBar/DirtyFooter/FloatingWorkWindow + audit-trail | ✅ (via **NS-4**: #295/#297/#300/#307/#308 + #330) | `components/record/*` (`floating-work-window.tsx`, `dirty-footer.tsx`…) |
| **PR-005** Piloto Clientes | record page + edit window (piloto Clientes) | ✅ (#331 "record page foundation pilot") | piloto Clientes record |
| **PR-006** RBAC (schema+motor) | `Perfil`/`Permiso`/`UsuarioPermiso` + `hasPermission`/`requirePermission` + snapshot na sessão | ✅ #332 · 🚩 `RBAC_ENABLED` OFF | migration `add_rbac_foundation` + `lib/permisos.ts` |
| **PR-007** PermissionGate FE | provider/hook + `PermissionGate` (máscara híbrida) + nav ciente de permissão | ✅ #333 · 🚩 OFF ⇒ mostra tudo | `components/PermissionGate`, `IMPLEMENTATION_NOTES_PR007` |
| **PR-008** AuditLog estendido | `motivo`/`origen`/`ip`/`documentoId` + enum rico + `registrarAuditoria` + piloto maestros | ✅ #334 | migration `add_audit_metadata` + `services/auditoria.ts` |
| **PR-009** PERM-01 (página) | UI admin usuários/permissões + matriz + seed dos 11 perfis canônicos (shells, sem grants) | ✅ #335 · gate `ADMIN_ACCESO` | `IMPLEMENTATION_NOTES_PR009` |
| **PR-010** AUD-01 (worklist) | `/sistema/auditoria` read-only sobre AuditLog + sub-vistas + export auditada | ✅ #336 | `app/(dashboard)/sistema/auditoria/*`, `services/auditoria-*` |
| **PR-011** Máscara custo/margem (G-10) | BE **strip** no payload (CRIT-10) + FE mask (`—`/oculto) em COM/BI/INV/export | ✅ #337 · 🚩 OFF ⇒ mostra tudo | `lib/permisos-masking.ts` + 5 suítes de máscara |
| **PR-012** Approvals Engine (AUTO-01) | motor genérico INERTE `Solicitud`/`Aprobacion` + SLA + escalonamento | ✅ #338 · 🚩 `APPROVALS_ENABLED` OFF | migration `add_approvals_engine` + `services/aprobaciones*` |

## 3. Feature-flags — o que está "construído mas desligado"

| Flag | Default | Efeito quando OFF (estado atual) | Quem liga |
|---|---|---|---|
| `RBAC_ENABLED` | **OFF** | Motor cai no legado ADMIN/USER; `hasPermission` libera o base; PermissionGate/máscara mostram tudo (zero regressão) | quando o Master configurar perfis/grants pela PERM-01 (PR-009) |
| `APPROVALS_ENABLED` | **OFF** | Motor de aprovações inerte; toda função pública lança; cron sem `schedule:` | **PR-014** (cabeamento de margem) |

> Consequência prática: **a fundação de segurança/aprovações existe e está testada, mas ainda
> não "morde"**. Habilitar é decisão operacional + os PRs de UI/cabeamento (PR-013/014).

## 4. Pendências por onda

**🔴 Bloqueante / alto valor**
- **PR-013** — Central de Aprobaciones UI (AUTO-01): worklist + bloco no Dashboard + aba `Autorizaciones`. Sem ela o motor PR-012 não tem como ser operado por humano.
- **PR-014** — Cabeamento de margem baixa (COM-05 / CRIT-03): primeira ação gateada; **liga `APPROVALS_ENABLED`**.

**🟠 Importante**
- Migração dos **5 drawers de negócio → FloatingWorkWindow** (Tesouraria/Contabilidade ainda usam `*-detalle-sheet.tsx`).
- **Golden files do Comex (CRIT-05)** antes de qualquer UI que exponha custo Comex.
- Habilitar `RBAC_ENABLED` em staging e o Master atribuir grants aos 11 perfis canônicos (hoje shells vazios).

**🟡 Desejável**
- Fase 2 de módulos (CLI/PROD/INV/COMEX/FIN/TES/CONT/COMP/CRM/BI) — ver roadmap.

**⚪ Informativo / dívida conhecida**
- Escopo de dados **por-perfil** (ANEXO A.4) não é modelado (`Perfil` sem `ambito`) — só por-usuário (`UsuarioPermiso.ambito`). Limitação registrada no PR-009.
- Branches `pr-001-design-foundation` / `pr-002-global-shell-topnav` / `pr-003-enterprise-datagrid`
  existem **não-mergeadas**: esforço de review à parte, **superado** pela série NS-* que entregou a
  fundação equivalente em `main`. **Não re-executar** (ver memória `project_uiux_reconstruction_audit_pr_series`).

## 5. Conclusão

- **DB:** em dia (`add_approvals_engine`/PR-012). Nada a aplicar.
- **Onda 0 (PR-006→010):** completa em `main` — fundação RBAC + auditoria + páginas PERM-01/AUD-01.
- **Onda 1 (PR-011→012):** completa em `main` — mascaramento custo/margem + motor de aprovações (inerte).
- **Próximo passo lógico:** **Onda 2** = PR-013 (UI de aprovações) + PR-014 (cabeamento de margem, que liga o motor).
