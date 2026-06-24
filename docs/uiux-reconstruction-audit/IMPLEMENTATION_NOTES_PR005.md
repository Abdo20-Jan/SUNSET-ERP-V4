# IMPLEMENTATION NOTES — PR-005 Record Page Foundation (piloto Clientes)

Data: 2026-06-24 · Branch: `pr-005-permissions-foundation` (base = `pr-004-record-page-pattern`) · **Não commitado.**

> Aplica a **fundação de Record Page já entregue no PR-004** (`RecordLayout`, `RecordSection`/`RecordFieldGrid`/`RecordField`, `RecordActionBar`, `DirtyFooter`, `FloatingWorkWindow`, `useDirtyState`, reusando `RecordHeader` de NS-4) a um **segundo piloto de baixo risco — Clientes** (`/maestros/clientes/[id]`). Tudo **aditivo**; reusa a server action `actualizarClienteAction` JÁ EXISTENTE (intocada). Não recria nenhuma primitiva.

## Observação sobre o nome ("Permissions Foundation")

O título do PR e a linha "leitura/guards" não correspondem ao escopo aprovado. A fundação real de **permissões/auditoria** dos docs (PermissionGate + `requirePermission` + extensão do `AuditLog` + AuditTimeline) **exige** alterar `schema.prisma`/auth/sessão — o que as **restrições estritas deste PR proíbem** (não tocar schema, migrations, auth/JWT/session, modelo de permissões). Portanto o entregável seguro foi estritamente o **escopo aprovado**: primitivas de Record Page aplicadas a um piloto. A "PR-005 real" (permissões/auditoria) fica para um PR dedicado quando o schema/auth puderem ser tocados (ver `06_PERMISSION_AUDIT.md`, `07_AUDIT_HISTORY_AUDIT.md`, `13_OPEN_QUESTIONS_FOR_OWNER.md` Q1/Q2).

## Decisões do dono (confirmadas em Plan Mode)

- **Base:** branch `pr-004` (reusar as primitivas já commitadas; sem recriar nem cherry-pick).
- **Piloto:** **Clientes** — `actualizarClienteAction` já existe; espelha exatamente o padrão de Depósitos (PR-004). Depósitos sozinho seria redundante (já 100% migrado); não há infra de teste de componente (sem `jsdom`/`@testing-library`), então "consolidar via testes" ficou fora.

## Achado decisivo (de risco)

`actualizarClienteAction` **revalida o payload completo server-side com o `clienteBaseSchema` canônico** ([src/lib/actions/clientes.ts](../../src/lib/actions/clientes.ts)). O schema do form na janela de edição é apenas **UX/erros inline** — não pode corromper dados. Por isso a janela autocontida (espelhando `deposito-edit-window.tsx`, **sem tocar** `cliente-form-dialog.tsx` nem o fluxo da lista) é a opção de menor risco e consistente com o precedente do PR-004. O campo `tipo` (não editável neste form) viaja como **passthrough** para não ser resetado no update.

## Arquivos novos

| arquivo | tipo | conteúdo |
|---|---|---|
| `src/app/(dashboard)/maestros/clientes/[id]/page.tsx` | novo | Server Component read-only (`force-dynamic`): `RecordLayout` + `RecordHeader` + `RecordActionBar` (Volver + ilha de edição) + seções `Datos generales` / `Datos fiscales` / `Cuenta contable` / `Referencias` (ventas count). |
| `src/app/(dashboard)/maestros/clientes/[id]/cliente-edit-window.tsx` | novo | Client island: `FloatingWorkWindow` + `DirtyFooter` + `useDirtyState` + `Dialog` de descarte; form RHF/Zod espelhando o diálogo (modo edit), reusando `CuentaCombobox`; chama `actualizarClienteAction`. |
| `docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR005.md` | novo | este arquivo. |

## Arquivos editados (aditivo, comportamento intacto)

| arquivo | tipo | mudança |
|---|---|---|
| `src/lib/actions/clientes.ts` | editado (+10) | **adiciona** `obtenerClientePorId(id)` read-only, reusando `CLIENTE_ROW_SELECT` + `mapClienteRow`. Nenhuma action/validação existente alterada. |
| `src/app/(dashboard)/maestros/clientes/clientes-table.tsx` | editado | célula "Nombre" vira `Link` para `/maestros/clientes/[id]` (+ `import Link`). Dialog criar/editar, delete, filtros, export, colunas e SavedViews **intactos** (mesma mudança aditiva de 1 célula do PR-004 em `depositos-table.tsx`). |

## O que foi implementado

- ✅ Ficha read-only de Cliente usando **todas** as primitivas de leitura (`RecordLayout`/`RecordHeader`/`RecordActionBar`/`RecordSection`/`RecordFieldGrid`/`RecordField` + `StatusBadge`).
- ✅ Edição numa **`FloatingWorkWindow`** (movível/redimensionável/maximizável, sem backdrop) com **`DirtyFooter`** + **`useDirtyState`** + gate `onRequestClose` + confirmação de descarte.
- ✅ Reuso da action `actualizarClienteAction` (intocada) e de `CuentaCombobox`/`listarProvincias`/`listarCuentasContablesParaCliente`.
- ✅ Link aditivo da lista → ficha (Nombre).

## O que NÃO foi implementado (intencional — fora do escopo)

- **PermissionGate / `requirePermission` / extensão do `AuditLog` / AuditTimeline** — exigem schema/auth (proibido neste PR).
- **Refactor de `cliente-form-dialog.tsx`** — preservado; a janela de edição é autocontida (precedente do PR-004; evita risco ao fluxo da lista).
- **Migração de outros maestros/drawers de negócio** para `FloatingWorkWindow` — fica para PRs de módulo.
- **Testes de componente** — sem harness `jsdom`/RTL no projeto; introduzir um sairia do escopo de piloto de baixo risco.

## Comandos de validação e resultados

| comando | resultado |
|---|---|
| `pnpm prisma generate` | ✅ Prisma Client 7.8.0 gerado em `./src/generated/prisma`. |
| `pnpm typecheck` | ✅ exit 0 (limpo). |
| `pnpm build` | ✅ exit 0; rota `/maestros/clientes/[id]` registrada como dinâmica (ƒ). |
| `pnpm biome:ci` | ✅ exit 0 — 0 errors. (2 errors iniciais eram **de formato nos arquivos novos**, corrigidos com `biome check --write` **apenas nos meus arquivos**.) Restam 42 warnings **pré-existentes** em arquivos não relacionados (bi/comex/tesoreria/crm/…) — **não tocados** (restrição). |
| `pnpm test` | ◐→✅ ~896–899 passed / 6–9 skipped, **0 falhas de código**. Flake de port-binding do Testcontainers (`Timed out … waiting for container ports to be bound`): **2 execuções derrubaram suítes DIFERENTES e não relacionadas** — `test/cuentas-a-pagar-bonded.test.ts` e `test/contenedores-actions.test.ts` —, **ambas re-rodadas isoladas → ✅** (6/6 e 9/9). Suíte diferente a cada run + mesmo erro de infra ⇒ flake de containers concorrentes sob carga, sem relação com as mudanças de Clientes (ver `reference_test_gotcha_prisma_generate`). |

## QA visual (checklist manual — requer dev server + sessão)

QA local seguro (Postgres descartável + override `DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL=localhost`, login admin/admin123 — **não** apontar para PROD/Railway):

- [ ] `/maestros/clientes` → célula "Nombre" é link; lista (criar/editar via dialog, eliminar, filtros, export, colunas) **idêntica**.
- [ ] Abrir um cliente → ficha read-only: header (breadcrumb/título/subtítulo/status), seções Datos generales / Datos fiscales / Cuenta contable / Referencias, botão "Volver".
- [ ] "Editar" abre a `FloatingWorkWindow` (arrastar/redimensionar/maximizar; sem backdrop opaco; não fecha em clique-fora).
- [ ] Editar um campo → `DirtyFooter` mostra "cambios sin guardar"; fechar/ESC → confirmação de descarte.
- [ ] "Guardar cambios" → `actualizarClienteAction` persiste, toast, `router.refresh()`, ficha atualizada; campos não editados (incl. `tipo`, cuenta contable) preservados.
- [ ] Email/alícuota inválidos → erro inline (UX); servidor revalida de qualquer forma.

## Riscos / pontos para PR-006+

- A janela de edição duplica o **schema de UI** do diálogo (apenas UX). Se o diálogo mudar campos, manter ambos alinhados — ou, num PR futuro, extrair um `ClienteFormFields` compartilhado (fora do escopo de "baixo risco" aqui).
- Quando a fundação de **permissões** existir (PR de schema/auth), os campos sensíveis da ficha (ex.: cuenta contable, dados fiscais) devem passar por `PermissionGate` + a action por `requirePermission`.

## Rollback

- Remover os 2 arquivos novos em `maestros/clientes/[id]/` e este arquivo de notas.
- Reverter os 2 edits: `clientes.ts` (remover `obtenerClientePorId`) e `clientes-table.tsx` (célula Nombre volta a `<span>` + remover `import Link`).
- Efeito: zero em dados/comportamento (mudanças 100% aditivas).
