# 06 — Auditoria da Camada de Permissão

> Baseline: G-06 / CRIT-10 / `07_PERMISSIONS_AUDIT_SECURITY.md` / PERM-01. **Permissão sempre no FE (`PermissionGate`) E no BE (validação real).** 10 dimensões, 12 perfis, permissão de campo/coluna/export/escopo.

## Mecanismo atual (resumo)

| Camada | Implementação atual | Arquivo |
|---|---|---|
| Autenticação | NextAuth v5 Credentials, sessão **JWT** | [src/lib/auth.ts](../../src/lib/auth.ts), [auth.config.ts](../../src/lib/auth.config.ts) |
| Modelo de papel | **`Role` binário: `ADMIN` \| `USER`** (enum no schema) | `prisma/schema.prisma` (User) |
| Gate de rota (proxy) | `auth.config.authorized()` — bloqueia `/login` logado e gate `/admin` p/ ADMIN | [auth.config.ts](../../src/lib/auth.config.ts) |
| Guard de Server Action | `requireAdmin(): {ok,error}` — revalida role na **DB** a cada chamada | [auth-guard.ts:68](../../src/lib/auth-guard.ts#L68) |
| Guard de página | `requireAdminPage()` — redirect se não-ADMIN (defesa em profundidade) | [auth-guard.ts:98](../../src/lib/auth-guard.ts#L98) |
| Guard de sessão | `requireSessionUser()` — valida user existe/ativo antes de escrever FK | [auth-guard.ts:31](../../src/lib/auth-guard.ts#L31) |
| Campos do JWT | id, username, nombre, role, monedaPreferida, modoRetroactivo | [types/next-auth.d.ts](../../src/types/next-auth.d.ts) |

### Pontos fortes (preservar)
- ✅ Guards **revalidam o papel contra a DB** a cada chamada (JWT fica congelado na cookie; isto evita papel obsoleto após reseed) — bom padrão de defesa em profundidade.
- ✅ `requireSessionUser` evita `P2003` ao escrever FKs (`AuditLog.usuarioId`, etc.).
- ✅ Gate duplo: proxy (`authorized`) **+** guard de página/action.

## Gaps vs baseline

| dimensão canônica (G-06 / PERM-01) | estado atual | gap | severidade |
|---|---|---|---|
| **Permissão de módulo** | implícita (rota) | sem matriz módulo×perfil (ANEXO A.1) | 🔴 |
| **Permissão de página** | só `/admin` gated | demais páginas sem gate por perfil | 🟠 |
| **Permissão de ação** (emitir/cancelar/reabrir/aprovar/exportar/contabilizar/ajustar) | só ADMIN/não-ADMIN | sem granularidade por ação | 🔴 |
| **Permissão de campo** (custo, margem, saldo, limite) | **inexistente** | nada mascara campo sensível | 🔴 |
| **Permissão de coluna** (margem na grade) | inexistente | coluna deve **ocultar** (não `—`) p/ vendedor (CRIT-02/ C.4 #5) | 🔴 |
| **Permissão de informação sensível** | inexistente | sem classe de info sensível | 🔴 |
| **Permissão de documento/relatório** | inexistente | sem `generate_pdf_external/internal` | 🟠 |
| **Permissão de exportação** (`export_excel` / `export_full`) | inexistente | export não é permissão autônoma nem auditada | 🔴 |
| **Escopo de dados** (carteira/depósito/processo) | inexistente | Vendedor vê tudo; sem escopo por carteira (ANEXO A.4) | 🔴 |
| **12 perfis canônicos** | 2 papéis | faltam Master, Diretor, Financeiro, Tesouraria, Contabilidade, Comex, Com.gestor, Vendedor, Estoque, Logística, Compras, Consulta | 🔴 |
| **`PermissionGate` (FE)** | **não existe** | sem componente de gating FE | 🔴 |
| Override individual / herança / "simular como" / temporárias | não existe | recursos de PERM-01 | 🟠 |

## Frontend gates
- **Hoje:** nenhum `PermissionGate`; visibilidade depende só de rota e de `role` no JSX ad-hoc.
- **Alvo:** `PermissionGate` (oculta/mascarará campo, coluna, bloco, página, botão) com **layout estável** (PAGE-STD-02: campo→`—`+tooltip, bloco→oculto, coluna→não renderizada, botão→desabilitado+tooltip).

## Backend guards
- **Hoje:** `requireAdmin`/`requireAdminPage`/`requireSessionUser` — bom para o eixo ADMIN, **insuficiente** para ação/campo/escopo.
- **Alvo:** helper de permissão server-side (`requirePermission(userId, 'ver_costo' | 'export_full' | …, scope)`) chamado no topo de cada action/serviço sensível. **UI masking nunca basta** (G-06/CRIT-10).

## Field-level / export / leitura sensível
- **Field-level:** ausente. Margem/custo/saldo/limite precisam de gating FE **+** exclusão real no payload BE (não enviar o número ao cliente sem permissão).
- **Export:** sem permissão autônoma nem auditoria. Baseline exige `export_excel`/`export_full` + evento de auditoria (usuário, filtros, colunas, nº linhas, IP; alerta >1.000 linhas em módulo sensível).
- **Leitura sensível auditada:** ausente (ver [07_AUDIT_HISTORY_AUDIT.md](07_AUDIT_HISTORY_AUDIT.md)).

## Prioridade de correção (antes de Comercial / Financeiro / Comex)
1. **PR-005 (Fundação de permissão+auditoria)** — modelo de permissão (perfis + dimensões + flags sensíveis: `ver_costo`, `ver_margen`, `ver_saldo`, `ver_limite`, `export_excel`, `export_full`, escopo), `PermissionGate` (FE) e `requirePermission` (BE). **Bloqueante** para qualquer página com custo/margem/saldo.
2. **Margem (G-10/CRIT-01/02)** só pode ir ao ar **depois** do gating de campo/coluna.
3. **Export auditado** antes de habilitar exportação nas worklists.
4. **PERM-01 (UI)** depois do modelo (PR dedicado).

> ⚠️ Decisão de modelagem (questão ao dono em [13_OPEN_QUESTIONS_FOR_OWNER.md](13_OPEN_QUESTIONS_FOR_OWNER.md)): manter `Role` binário + tabela de permissões/flags, ou migrar para perfis nomeados. **Não** é uma mudança de UI — toca schema/sessão e exige aprovação.
