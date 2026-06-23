# 13 — Questões Abertas para o Dono (bloqueiam implementação)

> Apenas decisões que **bloqueiam** a implementação e **não** foram resolvidas por OD-01..OD-15. Itens já decididos (colunas, estados, TES mapping, USD, plano ULTRA, page_codes, Recepción aba) **não** são reabertos. As 3 primeiras tocam **schema/sessão** e por isso exigem aprovação antes do PR-005.

## Q1 — Modelo de permissão (🔴 bloqueia PR-005 e todo dado sensível)
Hoje só existe `Role` binário (ADMIN/USER). A baseline exige **12 perfis** + **10 dimensões** + flags de campo/coluna/export/escopo.
- **Opção A (recomendada):** manter `Role` + adicionar tabela de **permissões/flags** (`ver_costo`, `ver_margen`, `ver_saldo`, `ver_limite`, `export_excel`, `export_full`, escopo) e perfis como agrupamento de flags. Menor ruptura; preserva os guards atuais.
- **Opção B:** migrar para perfis nomeados como enum/relacional substituindo o binário.
- **Bloqueio:** toca `schema.prisma` + sessão JWT (`auth.config.ts`). Precisa de aprovação do modelo antes de codar.

## Q2 — Extensão do `AuditLog` (🔴 bloqueia PR-005)
`AuditLog` não tem `motivo` nem `origen` (G-07/AUD-01 exigem). Proposta: adicionar `motivo String?`, `origen` (enum Manual/Importação/Automação/API/Master), `documentoId String?`, `ip String?`.
- **Bloqueio:** migração de schema + decisão de **imutabilidade forçada** (constraint/trigger vs convenção) e **retenção permanente**. Aprovar antes de migrar.

## Q3 — Estratégia de corte da navegação (🟠 bloqueia PR-002)
Sidebar atual (`AppSidebar`) é a navegação primária; baseline exige **top-nav, sem sidebar principal** (G-02).
- **Recomendado:** introduzir top-nav atrás de **feature-flag**, rodar em paralelo e remover o sidebar após validação por módulo.
- **Decisão necessária:** corte direto (big-bang) ou convivência temporária com flag? Afeta risco/rollback de PR-002.

## Q4 — Escopo das 7 páginas ausentes (🟠 planejamento)
**COM-05, CLI-02, FIN-03, FIN-04, PERM-01, AUD-01, AUTO-01** não existem. Confirmar se entram **nesta reconstrução** (com PRs próprios) ou ficam para milestone posterior. Impacta ordem/tamanho do roadmap.

## Q5 — Realocação de módulos (🟠 afeta rotas/PRs)
- **Finanças × Tesouraria:** CxC/CxP estão sob `/tesoreria/*`. Baseline separa **Finanças (programa)** de **Tesouraria (executa)** (ANEXO C.4 #7) e FIN-* são módulo Finanzas. Confirmar **mover** CxC/CxP para um módulo Finanzas (novas rotas) vs manter rotas e só re-rotular.
- **COM-04 Presupuesto** está em `/maestros/cotizaciones`. Confirmar realocação para **Comercial** (e se mantém compat. de rota antiga).

## Q6 — Casos de referência dos golden files Comex (🔴 bloqueia PR-COMEX / CX-06)
CRIT-05 exige golden files **antes** de tocar UI de custos. É preciso o PO/Diretor **designar os despachos/embarques de referência** (parcial, total direto plaza, cruzado, com arredondamento) a congelar como golden. Sem essa lista, não se inicia a UI de CX-05/CX-06.

## Q7 (parcial conhecido) — TES-03 Cobranzas: Q&A detalhado incompleto
> **Bloqueio parcial declarado.** As **respostas detalhadas do Q&A de Recebimentos (Cobranzas/TES-03)** não estavam no digest ingerido (item **B1**, OD-09) — apenas os **enunciados** foram realocados a TES-03. **Não bloqueia a auditoria global** nem os padrões de worklist/registro de TES-03, **mas bloqueia a implementação do Q&A detalhado de TES-03** até que o questionário-mãe respondido da v6 seja localizado **ou** o PO aprove preencher as lacunas com os padrões globais de Tesouraria. Até lá, valem os padrões globais.

## Itens explicitamente NÃO perguntados (já resolvidos por OD)
Colunas congeladas/contagens (OD-01/02/04/05/06/07), estados COM-04 (OD-03), visibilidade Cockpit por seção (OD-08), mapeamento TES (OD-09), page_code MAE-PROD-01 (OD-10/15), Recepción como aba (OD-11), DRE/Balance separados (OD-12), política USD (OD-13), plano ULTRA (OD-14), page_codes v6 (OD-15).
